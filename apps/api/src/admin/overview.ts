/**
 * Live numbers for the Staff tab (step 2.9a; the console's Overview, doc 18 §5, grows from it in
 * 2.7): players online now, and today so far (WAT) against yesterday up to the same time, so a
 * morning never looks worse than a whole day. Straight from Postgres; at launch volumes each
 * count is quick, and the analytics store takes over in M3.
 */
import type { AdminCount, AdminOverview } from '@whosabi/shared-types';
import type { Pool } from '../db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WAT_OFFSET_MS = HOUR;
const ONLINE_MS = 10 * 60_000;

/** One count for today so far and the same span of yesterday. */
async function count(pool: Pool, sql: string, today: number, now: number): Promise<AdminCount> {
  const result = await pool.query<{ today: number; yesterday: number }>(sql, [
    new Date(today - DAY),
    new Date(today),
    new Date(now - DAY),
    new Date(now),
  ]);
  return result.rows[0]!;
}

/** `ts` is the column or expression with the moment each row happened. */
const counted = (ts: string, from: string, where = 'true') => `
  SELECT count(*) FILTER (WHERE ${ts} >= $2 AND ${ts} <= $4)::int AS today,
         count(*) FILTER (WHERE ${ts} >= $1 AND ${ts} <= $3)::int AS yesterday
    FROM ${from} WHERE ${where} AND ${ts} >= $1`;

export async function liveNumbers(pool: Pool, now: number): Promise<AdminOverview> {
  const wat = new Date(now + WAT_OFFSET_MS);
  const today = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()) - WAT_OFFSET_MS;
  const [online, signups, newPlayers, duelsStarted, duelsFinished, dailyPlayers, waiting] = await Promise.all(
    [
      pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM users
        WHERE last_seen_at >= $1 AND status IN ('guest', 'active', 'restricted')`,
        [new Date(now - ONLINE_MS)],
      ),
      // A sign-up is a player's first account sign-in (Google, Apple or phone), not their guest start.
      count(
        pool,
        counted(
          'first',
          `(SELECT min(created_at) AS first FROM auth_identities
           WHERE provider <> 'guest_device' GROUP BY user_id) firsts`,
        ),
        today,
        now,
      ),
      count(pool, counted('created_at', 'users'), today, now),
      count(pool, counted('created_at', 'duels'), today, now),
      count(pool, counted('completed_at', 'duels', "state IN ('complete', 'forfeit')"), today, now),
      count(pool, counted('completed_at', 'daily_results'), today, now),
      pool.query<{ reported: number; in_review: number; approved: number }>(
        `SELECT (SELECT count(DISTINCT question_id) FROM question_reports WHERE resolution IS NULL)::int AS reported,
              (SELECT count(*) FROM questions WHERE status = 'in_review')::int AS in_review,
              (SELECT count(*) FROM questions WHERE status = 'approved')::int AS approved`,
      ),
    ],
  );
  const w = waiting.rows[0]!;
  return {
    at: new Date(now).toISOString(),
    online_now: online.rows[0]!.n,
    signups,
    new_players: newPlayers,
    duels_started: duelsStarted,
    duels_finished: duelsFinished,
    daily_players: dailyPlayers,
    waiting: { reported_questions: w.reported, in_review: w.in_review, approved: w.approved },
  };
}
