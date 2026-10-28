/**
 * The worker's push job: sends what is due in `push_outbox` to every phone the player has
 * notifications on, in their language. Pushes wait out quiet hours, other pushes stop at
 * four a day (FR-NOT-2), dead tokens are forgotten, and a failure is tried again a few times.
 * Rows are claimed with a short lock, so several workers can share the queue.
 */
import type { Platform } from '@whosabi/shared-types';
import type { JobDeps } from '../jobs/deps';
import { DAILY_CAP, renderPush, TURN_TYPES, type PushParams, type PushType } from './messages';
import { inQuietHours, nextSendTime, watDayStart } from './queue';
import { INVALID_TOKEN, PushRejected, type DeviceToken, type PushTransport } from './transport';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;
/** Kept this long for the daily cap and for support, then deleted. */
const KEEP_DAYS = 30;

interface Claimed {
  id: string;
  user_id: string;
  type: PushType;
  params: Record<string, unknown>;
  collapse_key: string | null;
  expires_at: Date;
  attempts: number;
  language: string;
  status: string;
  last_platform: Platform | null;
}

type Outcome = 'sent' | 'logged' | 'no_device' | 'capped' | 'expired' | 'failed';

export async function sendDuePushes(deps: JobDeps, transport: PushTransport, limit = 100): Promise<number> {
  const { pool, clock } = deps;
  const now = clock.now();
  const claimed = await pool.query<Claimed>(
    `WITH due AS (
       SELECT id FROM push_outbox
        WHERE sent_at IS NULL AND not_before <= $1 AND (locked_until IS NULL OR locked_until <= $1)
        ORDER BY not_before, id LIMIT $2 FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE push_outbox p SET attempts = attempts + 1, locked_until = $3
         FROM due WHERE p.id = due.id
       RETURNING p.id, p.user_id, p.type, p.params, p.collapse_key, p.expires_at, p.attempts
     )
     -- Oldest first, so the daily cap keeps the pushes queued earliest.
     SELECT c.*, u.language, u.status, u.last_platform
       FROM claimed c JOIN users u ON u.id = c.user_id ORDER BY c.id`,
    [new Date(now), limit, new Date(now + LOCK_MS)],
  );
  let sent = 0;
  for (const row of claimed.rows) {
    try {
      if ((await sendOne(deps, transport, row, now)) === 'sent') sent++;
    } catch (err) {
      deps.log.error({ err, push: row.id }, 'push job failed on one message');
    }
  }
  return sent;
}

async function sendOne(
  deps: JobDeps,
  transport: PushTransport,
  row: Claimed,
  now: number,
): Promise<Outcome | 'later'> {
  const { pool, log } = deps;
  const finish = async (outcome: Outcome) => {
    await pool.query('UPDATE push_outbox SET sent_at = $2, outcome = $3, locked_until = NULL WHERE id = $1', [
      row.id,
      new Date(now),
      outcome,
    ]);
    return outcome;
  };
  const later = async (at: number) => {
    await pool.query('UPDATE push_outbox SET not_before = $2, locked_until = NULL WHERE id = $1', [
      row.id,
      new Date(at),
    ]);
    return 'later' as const;
  };

  if (row.expires_at.getTime() <= now) return finish('expired');
  // Queued just before 22:00 and picked up just after: it waits for the morning too.
  if (inQuietHours(now)) return later(nextSendTime(now));
  if (row.status === 'banned' || row.status === 'deleted') return finish('no_device');

  const devices = (
    await pool.query<DeviceToken>(
      `SELECT id, platform, push_token AS token FROM devices
        WHERE user_id = $1 AND push_token IS NOT NULL ORDER BY token_updated_at DESC NULLS LAST LIMIT 10`,
      [row.user_id],
    )
  ).rows;
  if (devices.length === 0) {
    if (!transport.real) {
      const { title, body } = renderPush({ type: row.type, ...row.params } as PushParams, row.language);
      log.debug(
        { to: row.user_id, push: { type: row.type, title, body } },
        'push for a player with no phone',
      );
    }
    return finish('no_device');
  }

  if (!TURN_TYPES.has(row.type)) {
    const today = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM push_outbox
        WHERE user_id = $1 AND outcome = 'sent' AND sent_at >= $2 AND NOT (type = ANY($3))`,
      [row.user_id, new Date(watDayStart(now)), [...TURN_TYPES]],
    );
    if (today.rows[0]!.n >= DAILY_CAP) return finish('capped');
  }

  const rendered = renderPush({ type: row.type, ...row.params } as PushParams, row.language);
  const push = {
    ...rendered,
    collapseKey: row.collapse_key,
    ttlSeconds: (row.expires_at.getTime() - now) / 1000,
  };
  let delivered = 0;
  let retry = false;
  let refused = false;
  for (const device of devices) {
    try {
      if ((await transport.send(device, push)) === INVALID_TOKEN) {
        await pool.query('UPDATE devices SET push_token = NULL WHERE id = $1 AND push_token = $2', [
          device.id,
          device.token,
        ]);
      } else {
        delivered++;
      }
    } catch (err) {
      if (err instanceof PushRejected) {
        log.error({ err, push: row.id, device: device.id }, 'push refused');
        refused = true;
      } else {
        log.warn({ err, push: row.id, device: device.id }, 'push not sent; trying again later');
        retry = true;
      }
    }
  }

  if (delivered > 0) {
    if (!transport.real) return finish('logged');
    await deps.events.emit(
      'push_sent',
      { type: row.type },
      { userId: row.user_id, platform: row.last_platform ?? 'android' },
    );
    return finish('sent');
  }
  if (retry && row.attempts < MAX_ATTEMPTS) return later(now + 30_000 * 2 ** row.attempts);
  // Every token was dead, or the push service refused the message.
  return finish(retry || refused ? 'failed' : 'no_device');
}

/** Old rows go after a month; the daily cap only looks at today. */
export async function prunePushes(deps: JobDeps): Promise<number> {
  const cutoff = new Date(deps.clock.now() - KEEP_DAYS * 24 * 3_600_000);
  const result = await deps.pool.query('DELETE FROM push_outbox WHERE created_at < $1', [cutoff]);
  return result.rowCount ?? 0;
}
