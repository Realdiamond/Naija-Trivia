/**
 * Daily rows in Postgres (doc 08 `daily_*`): picking a day's 7 questions, the Daily's number,
 * results and streaks.
 */
import type { FastifyBaseLogger } from 'fastify';
import { NEW_STREAK, pickDailyQuestions, type DailyCandidate, type StreakState } from '@whosabi/game-rules';
import type { Pool, PoolClient } from '../db';

type Db = Pool | PoolClient;

export interface DailyRow {
  id: number;
  play_date: string;
  question_ids: string[];
  locked: boolean;
}

export interface DailyResultRow {
  daily_id: number;
  user_id: string;
  correct_count: number;
  score: number;
  total_ms: number;
  grid: string;
  home_state: string | null;
  xp: number;
  coins: number;
  streak: number;
  used_freeze: boolean;
}

/** A Daily stays out of the pick for a year (FR-DAILY-1). */
const REUSE_AFTER_DAYS = 365;

const DAILY_COLUMNS = `id, to_char(play_date, 'YYYY-MM-DD') AS play_date, question_ids, locked`;

export async function dailyByDate(db: Db, date: string): Promise<DailyRow | null> {
  const result = await db.query<DailyRow>(
    `SELECT ${DAILY_COLUMNS} FROM daily_challenges WHERE play_date = $1`,
    [date],
  );
  return result.rows[0] ?? null;
}

export async function dailyById(db: Db, id: number): Promise<DailyRow | null> {
  const result = await db.query<DailyRow>(`SELECT ${DAILY_COLUMNS} FROM daily_challenges WHERE id = $1`, [
    id,
  ]);
  return result.rows[0] ?? null;
}

/**
 * The Daily for `date`, picked now if nobody has yet. Its number counts calendar days from the
 * first Daily, so a day without one still moves the count on. Several callers at once end up
 * with the same row. Null when there are too few live questions.
 */
export async function ensureDaily(
  pool: Pool,
  log: FastifyBaseLogger,
  date: string,
  random: () => number = Math.random,
): Promise<DailyRow | null> {
  const existing = await dailyByDate(pool, date);
  if (existing) return existing;
  const candidates = await dailyCandidates(pool, date);
  const ids = pickDailyQuestions(candidates, random);
  if (!ids) {
    log.warn({ date, live: candidates.length }, 'too few live family-safe questions for a Daily');
    return null;
  }
  const reused = ids.filter((id) => candidates.find((c) => c.id === id)?.lastUsed !== null).length;
  if (reused > 0) log.warn({ date, reused }, 'Daily reuses questions from the last year: add more questions');
  await pool.query(
    `INSERT INTO daily_challenges (id, play_date, question_ids, locked)
     SELECT COALESCE((SELECT max(id) + ($2::date - max(play_date)) FROM daily_challenges), 1), $2::date, $1, true
     ON CONFLICT DO NOTHING`,
    [ids, date],
  );
  return dailyByDate(pool, date);
}

/**
 * Live, family-safe multiple-choice or true/false questions in active categories (everyone gets
 * the same Daily, 13–17s included), with when each was last in a Daily.
 */
async function dailyCandidates(db: Db, date: string): Promise<DailyCandidate[]> {
  const result = await db.query<{
    id: string;
    category: string;
    difficulty: number;
    last_used: string | null;
  }>(
    `WITH used AS (
       SELECT qid, max(dc.play_date) AS last
         FROM daily_challenges dc, unnest(dc.question_ids) AS qid
        WHERE dc.play_date > $1::date - $2::int AND dc.play_date <> $1::date
        GROUP BY qid)
     SELECT q.id, q.category_id AS category, q.difficulty, to_char(u.last, 'YYYY-MM-DD') AS last_used
       FROM questions q
       JOIN categories c ON c.id = q.category_id AND c.active
       LEFT JOIN used u ON u.qid = q.id
      WHERE q.status = 'live' AND q.family_safe AND q.type IN ('mcq4', 'true_false')
        AND (q.valid_until IS NULL OR q.valid_until >= $1::date)`,
    [date, REUSE_AFTER_DAYS],
  );
  return result.rows.map((r) => ({
    id: r.id,
    category: r.category,
    difficulty: r.difficulty,
    lastUsed: r.last_used,
  }));
}

export async function dailyResultFor(
  db: Db,
  dailyId: number,
  userId: string,
): Promise<DailyResultRow | null> {
  const result = await db.query<DailyResultRow>(
    `SELECT daily_id, user_id, correct_count, score, total_ms, grid, home_state, xp, coins, streak, used_freeze
       FROM daily_results WHERE daily_id = $1 AND user_id = $2`,
    [dailyId, userId],
  );
  return result.rows[0] ?? null;
}

export async function loadStreak(db: Db, userId: string, forUpdate = false): Promise<StreakState> {
  const result = await db.query<{
    current: number;
    best: number;
    last_play_date: string | null;
    freezes_left: number;
    freeze_week: string | null;
  }>(
    `SELECT current, best, to_char(last_play_date, 'YYYY-MM-DD') AS last_play_date, freezes_left, freeze_week
       FROM streaks WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return NEW_STREAK;
  return {
    current: row.current,
    best: row.best,
    lastPlayDate: row.last_play_date,
    freezesLeft: row.freezes_left,
    freezeWeek: row.freeze_week,
  };
}

export async function saveStreak(db: Db, userId: string, s: StreakState): Promise<void> {
  await db.query(
    `INSERT INTO streaks (user_id, current, best, last_play_date, freezes_left, freeze_week)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET current = $2, best = $3, last_play_date = $4,
       freezes_left = $5, freeze_week = $6`,
    [userId, s.current, s.best, s.lastPlayDate, s.freezesLeft, s.freezeWeek],
  );
}

/** A Daily's final ranks, overall and per state: points first, then the faster total time. */
export async function rankDaily(db: Db, dailyId: number): Promise<void> {
  await db.query(
    `UPDATE daily_results dr SET rank = r.rank, state_rank = r.state_rank
       FROM (SELECT user_id,
                    row_number() OVER (ORDER BY score DESC, total_ms, user_id) AS rank,
                    CASE WHEN home_state IS NULL THEN NULL ELSE
                      row_number() OVER (PARTITION BY home_state ORDER BY score DESC, total_ms, user_id) END AS state_rank
               FROM daily_results WHERE daily_id = $1) r
      WHERE dr.daily_id = $1 AND dr.user_id = r.user_id`,
    [dailyId],
  );
}

/** A finished week's ranks again, after its scores changed (re-scoring, step 2.6b-2). */
export async function rankWeek(db: Db, week: string): Promise<void> {
  await db.query(
    `UPDATE weekly_standings ws SET rank = r.rank, state_rank = r.state_rank
       FROM (SELECT user_id,
                    row_number() OVER (ORDER BY score DESC, user_id) AS rank,
                    CASE WHEN home_state IS NULL THEN NULL ELSE
                      row_number() OVER (PARTITION BY home_state ORDER BY score DESC, user_id) END AS state_rank
               FROM weekly_standings WHERE iso_week = $1) r
      WHERE ws.iso_week = $1 AND ws.user_id = r.user_id`,
    [week],
  );
}
