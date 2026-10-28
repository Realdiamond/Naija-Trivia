/**
 * Turn reminders (GDD §2.1, FR-NOT-1): the player whose turn it is hears once at 24 hours left
 * and once at 4 hours left, never in quiet hours (FR-NOT-2), in their own language (FR-NOT-3).
 * A reminder is claimed by inserting its row first, so several workers never send it twice.
 * Tie-breaks have no single player whose turn it is (both answer), so they get none yet.
 */
import type { DuelState, Platform } from '@whosabi/shared-types';
import { ACTIVE_STATES } from '../duels/repo';
import { inQuietHours, type Notifier, type PushMessage } from '../notify';
import type { JobDeps } from './deps';

const HOUR = 3_600_000;

/** The 4 h reminder first: a turn already under 4 hours skips the 24 h one. */
const STAGES = [
  { stage: '4h', hours: 4, from: 0, to: 4 * HOUR },
  { stage: '24h', hours: 24, from: 4 * HOUR, to: 24 * HOUR },
] as const;

interface Claimed {
  duel_id: string;
  user_id: string;
  turn_deadline: Date;
  state: DuelState;
  language: string;
  last_platform: Platform | null;
  opponent: string | null;
}

export async function sendTurnReminders(deps: JobDeps, notifier: Notifier, limit = 200): Promise<number> {
  const now = deps.clock.now();
  if (inQuietHours(now)) return 0;
  let sent = 0;
  for (const s of STAGES) {
    const claimed = await deps.pool.query<Claimed>(
      `WITH due AS (
         SELECT id, turn_user_id, turn_deadline FROM duels
          WHERE state = ANY($1::duel_state[]) AND turn_user_id IS NOT NULL
            AND turn_deadline > $2 AND turn_deadline <= $3
          ORDER BY turn_deadline LIMIT $5
       ), claimed AS (
         INSERT INTO duel_reminders (duel_id, turn_deadline, stage, user_id, sent_at)
         SELECT id, turn_deadline, $4, turn_user_id, $6 FROM due
         ON CONFLICT DO NOTHING
         RETURNING duel_id, user_id, turn_deadline
       )
       SELECT c.duel_id, c.user_id, c.turn_deadline, d.state, u.language, u.last_platform, o.username AS opponent
         FROM claimed c
         JOIN duels d ON d.id = c.duel_id
         JOIN users u ON u.id = c.user_id
         LEFT JOIN users o ON o.id = CASE WHEN d.player_a = c.user_id THEN d.player_b ELSE d.player_a END`,
      [ACTIVE_STATES, new Date(now + s.from), new Date(now + s.to), s.stage, limit, new Date(now)],
    );
    for (const row of claimed.rows) {
      try {
        const delivered = await notifier.send(row.user_id, reminderMessage(row, s.hours));
        sent++;
        // Only real pushes count in the push metrics, not the stand-in's log lines.
        if (delivered) {
          await deps.events.emit(
            'push_sent',
            { type: 'duel_expiring' },
            { userId: row.user_id, platform: row.last_platform ?? 'android' },
          );
        }
      } catch (err) {
        // Give the reminder back so the next run tries again.
        deps.log.warn({ err, duelId: row.duel_id }, 'turn reminder not sent');
        await deps.pool.query(
          'DELETE FROM duel_reminders WHERE duel_id = $1 AND turn_deadline = $2 AND stage = $3',
          [row.duel_id, row.turn_deadline, s.stage],
        );
      }
    }
  }
  return sent;
}

/**
 * Copy from doc 05 §4: English, or Pidgin for players who chose it. A challenger who never
 * played their first turn loses nothing but the duel itself, which is cancelled (game-rules).
 */
function reminderMessage(row: Claimed, hours: number): PushMessage {
  const name = row.opponent ?? 'your opponent';
  const pidgin = row.language === 'pcm';
  const cancelled = row.state === 'created';
  const outcome = pidgin
    ? cancelled
      ? 'the duel go cancel'
      : `${name} go win am`
    : cancelled
      ? 'the duel is cancelled'
      : `${name} wins the duel`;
  return {
    type: 'duel_expiring',
    title: pidgin
      ? `Oya o! ${hours} hours remain for your duel with ${name}`
      : `${hours} hours left vs ${name}`,
    body: pidgin
      ? `Play your turn before time finish, or ${outcome}.`
      : `Play your turn before time runs out, or ${outcome}.`,
    data: { duel_id: row.duel_id },
  };
}
