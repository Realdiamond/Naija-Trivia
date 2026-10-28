/**
 * "Daily #142 is live" (FR-NOT-1, daily_live): once a day at 09:00 WAT, to players who played a
 * Daily in the last week and haven't played today's yet, naming their streak if it is still
 * alive. It counts toward the four-a-day cap like any push that isn't about a turn.
 */
import { addDays, isoWeek, watDate } from '@whosabi/game-rules';
import { dailyByDate } from '../daily/repo';
import type { JobDeps } from './deps';

const HOUR = 3_600_000;
const WAT_OFFSET_MS = HOUR;
/** 09:00 WAT: the Daily has been up since midnight, and people are awake. */
export const DAILY_PUSH_HOUR = 9;
/** Players who played a Daily within this many days hear about the next one. */
const ACTIVE_DAYS = 7;

/** Queues today's reminders once, on the first run from 09:00 WAT. Returns how many. */
export async function queueDailyReminders(deps: JobDeps): Promise<number> {
  const { pool, redis, clock } = deps;
  const now = clock.now();
  if (new Date(now + WAT_OFFSET_MS).getUTCHours() < DAILY_PUSH_HOUR) return 0;
  const today = watDate(now);
  const daily = await dailyByDate(pool, today);
  if (!daily) return 0;
  // One run a day however many workers there are.
  const key = `push:daily-live:${today}`;
  if ((await redis.set(key, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK') return 0;
  const endOfDay = Date.parse(`${addDays(today, 1)}T00:00:00Z`) - WAT_OFFSET_MS;
  try {
    const result = await pool.query(
      `INSERT INTO push_outbox (user_id, type, params, collapse_key, not_before, expires_at, created_at)
       SELECT u.id, 'daily_live',
              jsonb_build_object('daily_id', $1::int, 'streak',
                CASE WHEN s.last_play_date >= $5::date - 1 THEN s.current
                     WHEN s.last_play_date = $5::date - 2
                          AND (s.freeze_week IS DISTINCT FROM $6 OR s.freezes_left > 0) THEN s.current
                     ELSE 0 END),
              'daily:' || $1, $2, $3, $2
         FROM streaks s
         JOIN users u ON u.id = s.user_id
        WHERE s.last_play_date >= $4::date AND s.last_play_date < $5::date
          AND u.status IN ('guest', 'active', 'restricted')
          AND EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.push_token IS NOT NULL)
       ON CONFLICT (user_id, collapse_key) WHERE sent_at IS NULL AND collapse_key IS NOT NULL DO NOTHING`,
      [daily.id, new Date(now), new Date(endOfDay), addDays(today, -ACTIVE_DAYS), today, isoWeek(today)],
    );
    return result.rowCount ?? 0;
  } catch (err) {
    await redis.del(key); // try again next run
    throw err;
  }
}
