/**
 * Leaderboards (TRD §5.5): Redis sorted sets for the day and the week, each with one set per
 * state. Postgres (`daily_results`) is the record; a board missing from Redis (expired, or Redis
 * restarted) is rebuilt from it on the next read. Every write sets a player's absolute score, so
 * a rebuild and a new result arriving together cannot count anything twice.
 *   lb:daily:{yyyymmdd}             day board: points first, then the faster total time
 *   lb:daily:{yyyymmdd}:state:{st}  the same per home state
 *   lb:week:{iso week}              Daily points from Monday to Sunday WAT
 *   lb:week:{iso week}:state:{st}
 *   …:built                         set once the board has been filled from Postgres
 */
import type { Redis } from 'ioredis';
import { addDays, dailyBoardScore } from '@whosabi/game-rules';
import type { Pool } from '../db';

const DAY = 86_400;
const DAILY_TTL_S = 8 * DAY;
const WEEK_TTL_S = 15 * DAY;

export interface Board {
  key: string;
  stateKey: (state: string) => string;
  built: string;
  ttl: number;
}

export function dailyBoard(date: string): Board {
  const key = `lb:daily:${date.replaceAll('-', '')}`;
  return { key, stateKey: (st) => `${key}:state:${st}`, built: `${key}:built`, ttl: DAILY_TTL_S };
}

export function weekBoard(week: string): Board {
  const key = `lb:week:${week}`;
  return { key, stateKey: (st) => `${key}:state:${st}`, built: `${key}:built`, ttl: WEEK_TTL_S };
}

interface Line {
  userId: string;
  value: number;
  state: string | null;
}

async function put(redis: Redis, board: Board, lines: readonly Line[]): Promise<void> {
  const chain = redis.multi();
  const touched = new Set<string>();
  for (const line of lines) {
    chain.zadd(board.key, line.value, line.userId);
    touched.add(board.key);
    if (line.state) {
      chain.zadd(board.stateKey(line.state), line.value, line.userId);
      touched.add(board.stateKey(line.state));
    }
  }
  for (const key of touched) chain.expire(key, board.ttl);
  await chain.exec();
}

/** A player's Daily result on the day's board and their total on the week's. */
export async function recordResult(
  pool: Pool,
  redis: Redis,
  entry: { userId: string; date: string; week: string; weekStart: string; state: string | null },
): Promise<void> {
  const totals = await pool.query<{ day_score: number; day_ms: number; week_score: number }>(
    `SELECT max(dr.score) FILTER (WHERE dc.play_date = $2::date) AS day_score,
            max(dr.total_ms) FILTER (WHERE dc.play_date = $2::date) AS day_ms,
            sum(dr.score)::int AS week_score
       FROM daily_results dr JOIN daily_challenges dc ON dc.id = dr.daily_id
      WHERE dr.user_id = $1 AND dc.play_date >= $3::date AND dc.play_date < $3::date + 7`,
    [entry.userId, entry.date, entry.weekStart],
  );
  const row = totals.rows[0];
  if (!row || row.day_score === null) return;
  await put(redis, dailyBoard(entry.date), [
    { userId: entry.userId, value: dailyBoardScore(row.day_score, row.day_ms), state: entry.state },
  ]);
  await put(redis, weekBoard(entry.week), [
    { userId: entry.userId, value: row.week_score, state: entry.state },
  ]);
}

/** Fills the day's board from Postgres unless that was done already. */
export async function ensureDailyBoard(
  pool: Pool,
  redis: Redis,
  dailyId: number,
  date: string,
): Promise<Board> {
  const board = dailyBoard(date);
  if (await redis.exists(board.built)) return board;
  const rows = await pool.query<{
    user_id: string;
    score: number;
    total_ms: number;
    home_state: string | null;
  }>('SELECT user_id, score, total_ms, home_state FROM daily_results WHERE daily_id = $1', [dailyId]);
  await fill(
    redis,
    board,
    rows.rows.map((r) => ({
      userId: r.user_id,
      value: dailyBoardScore(r.score, r.total_ms),
      state: r.home_state,
    })),
  );
  return board;
}

/** Fills the week's board from Postgres unless that was done already. */
export async function ensureWeekBoard(
  pool: Pool,
  redis: Redis,
  week: string,
  weekStart: string,
): Promise<Board> {
  const board = weekBoard(week);
  if (await redis.exists(board.built)) return board;
  const rows = await pool.query<{ user_id: string; score: number; home_state: string | null }>(
    `SELECT dr.user_id, sum(dr.score)::int AS score,
            (array_agg(dr.home_state ORDER BY dr.daily_id DESC))[1] AS home_state
       FROM daily_results dr JOIN daily_challenges dc ON dc.id = dr.daily_id
      WHERE dc.play_date >= $1::date AND dc.play_date < $2::date
      GROUP BY dr.user_id`,
    [weekStart, addDays(weekStart, 7)],
  );
  await fill(
    redis,
    board,
    rows.rows.map((r) => ({ userId: r.user_id, value: r.score, state: r.home_state })),
  );
  return board;
}

async function fill(redis: Redis, board: Board, lines: Line[]): Promise<void> {
  for (let i = 0; i < lines.length; i += 1000) await put(redis, board, lines.slice(i, i + 1000));
  await redis.set(board.built, '1', 'EX', board.ttl);
}

export interface Ranked {
  userId: string;
  value: number;
  rank: number;
}

export async function topOf(redis: Redis, key: string, limit: number): Promise<Ranked[]> {
  const flat = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
  const out: Ranked[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ userId: flat[i]!, value: Number(flat[i + 1]), rank: i / 2 + 1 });
  }
  return out;
}

export async function positionOf(redis: Redis, key: string, userId: string): Promise<Ranked | null> {
  const [rank, value] = await Promise.all([redis.zrevrank(key, userId), redis.zscore(key, userId)]);
  if (rank === null || value === null) return null;
  return { userId, value: Number(value), rank: rank + 1 };
}

/** How many players on the board did worse than `value`. */
export async function countBelow(redis: Redis, key: string, value: number): Promise<number> {
  return redis.zcount(key, '-inf', `(${value}`);
}
