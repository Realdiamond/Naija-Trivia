/**
 * Queuing a push. Callers queue inside the transaction that makes the change, so a push goes out
 * exactly when the change is saved, and never for one that was rolled back. The worker sends.
 */
import type { Pool, PoolClient } from '../db';
import type { PushParams } from './messages';

const HOUR = 3_600_000;
const WAT_OFFSET_MS = HOUR; // Africa/Lagos is UTC+1 all year
const QUIET_FROM = 22;
const QUIET_TO = 7;

/** FR-NOT-2: no pushes from 22:00 to 07:00 WAT. */
export function inQuietHours(now: number): boolean {
  const hour = new Date(now + WAT_OFFSET_MS).getUTCHours();
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

/** Now, or 07:00 WAT if now is in quiet hours. */
export function nextSendTime(now: number): number {
  if (!inQuietHours(now)) return now;
  const wat = new Date(now + WAT_OFFSET_MS);
  const seven = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate(), QUIET_TO) - WAT_OFFSET_MS;
  return wat.getUTCHours() >= QUIET_FROM ? seven + 24 * HOUR : seven;
}

/** The start of the WAT day `now` falls in, for the daily cap. */
export function watDayStart(now: number): number {
  const wat = new Date(now + WAT_OFFSET_MS);
  return Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()) - WAT_OFFSET_MS;
}

export interface QueuedPush {
  userId: string;
  params: PushParams;
  /** A waiting push with the same key is replaced, e.g. one per duel. */
  collapseKey: string | null;
  /** Not sent after this, e.g. the end of the turn it is about. */
  expiresAt: number;
  now: number;
}

/** The collapse key for anything about one duel: a newer "your turn" or result replaces the last. */
export const duelKey = (duelId: string) => `duel:${duelId}`;

export async function queuePush(db: Pool | PoolClient, push: QueuedPush): Promise<void> {
  const { type, ...params } = push.params;
  await db.query(
    `INSERT INTO push_outbox (user_id, type, params, collapse_key, not_before, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, collapse_key) WHERE sent_at IS NULL AND collapse_key IS NOT NULL
     DO UPDATE SET type = EXCLUDED.type, params = EXCLUDED.params, not_before = EXCLUDED.not_before,
                   expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at, attempts = 0`,
    [
      push.userId,
      type,
      JSON.stringify(params),
      push.collapseKey,
      new Date(nextSendTime(push.now)),
      new Date(push.expiresAt),
      new Date(push.now),
    ],
  );
}
