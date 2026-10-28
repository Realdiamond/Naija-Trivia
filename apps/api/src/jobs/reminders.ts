/**
 * Turn reminders (GDD §2.1, FR-NOT-1): the player whose turn it is hears once at 24 hours left
 * and once at 4 hours left, never in quiet hours (FR-NOT-2). A reminder is claimed by inserting
 * its row first, so several workers never queue it twice; the push job sends it, in the
 * player's language (FR-NOT-3). Tie-breaks have no single player whose turn it is (both answer),
 * so they get none.
 */
import type { DuelState } from '@whosabi/shared-types';
import { ACTIVE_STATES } from '../duels/repo';
import { duelKey, inQuietHours, queuePush } from '../push/queue';
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
  opponent: string | null;
}

/** Queues the reminders that are due; returns how many. */
export async function queueTurnReminders(deps: JobDeps, limit = 200): Promise<number> {
  const now = deps.clock.now();
  if (inQuietHours(now)) return 0;
  let queued = 0;
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
       SELECT c.duel_id, c.user_id, c.turn_deadline, d.state, o.username AS opponent
         FROM claimed c
         JOIN duels d ON d.id = c.duel_id
         LEFT JOIN users o ON o.id = CASE WHEN d.player_a = c.user_id THEN d.player_b ELSE d.player_a END`,
      [ACTIVE_STATES, new Date(now + s.from), new Date(now + s.to), s.stage, limit, new Date(now)],
    );
    for (const row of claimed.rows) {
      // A challenger who never played their first turn loses nothing but the duel, which is cancelled.
      await queuePush(deps.pool, {
        userId: row.user_id,
        params: {
          type: 'duel_expiring',
          duel_id: row.duel_id,
          opponent: row.opponent,
          hours: s.hours,
          cancelled: row.state === 'created',
        },
        collapseKey: duelKey(row.duel_id),
        expiresAt: row.turn_deadline.getTime(),
        now,
      });
      queued++;
    }
  }
  return queued;
}
