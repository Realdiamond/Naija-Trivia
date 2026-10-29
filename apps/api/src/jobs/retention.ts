/**
 * Retention (doc 08 §4, build plan step 2.7n): once a night, after 03:00 WAT, remove what is
 * past its time, in batches, and record each rule's run for the console's Compliance page.
 *   duel answers' raw timing   180 days (the answers and points stay; only the timing goes)
 *   party games and results    2 years
 *   Daily results              2 years
 *   practice sets              35 days (only to check games sent within 14 days)
 *   practice results           2 years
 *   integrity flags            2 years
 *   question reports           2 years
 *   messages to support        2 years
 *   consent records            6 years after the account was deleted
 * Raw analytics events go with the analytics loader (ANALYTICS_RETENTION_DAYS); the admin audit
 * log is kept 6 years and the app's database role cannot delete from it.
 */
import { watDate } from '@whosabi/game-rules';
import type { Pool } from '../db';
import type { JobDeps } from './deps';

const DAY = 86_400_000;
/** West Africa Time is UTC+1 all year. */
const WAT_OFFSET_MS = 3_600_000;
/** While the game is quietest (WAT), before the ledger check. */
export const RETENTION_HOUR = 3;
/** Rows touched per statement, so no run holds locks for long. */
const BATCH = 5_000;
/** At most this many batches per rule a night; the rest waits for tomorrow. */
const MAX_BATCHES = 40;

export interface RetentionRule {
  rule: string;
  days: number;
  /** Removes up to BATCH rows older than the cutoff; returns how many. */
  run: (pool: Pool, cutoff: Date) => Promise<number>;
}

const rows = async (pool: Pool, sql: string, cutoff: Date) =>
  (await pool.query(sql, [cutoff, BATCH])).rowCount ?? 0;

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    rule: 'duel_timing',
    days: 180,
    run: (pool, cutoff) =>
      rows(
        pool,
        `UPDATE duel_answers SET client_elapsed_ms = NULL, rtt_est_ms = NULL, tab_hidden_ms = NULL
          WHERE (duel_id, round_no, seq, user_id) IN (
            SELECT duel_id, round_no, seq, user_id FROM duel_answers
             WHERE served_at < $1
               AND (client_elapsed_ms IS NOT NULL OR rtt_est_ms IS NOT NULL OR tab_hidden_ms IS NOT NULL)
             LIMIT $2)`,
        cutoff,
      ),
  },
  {
    rule: 'party_results',
    days: 730,
    run: (pool, cutoff) =>
      rows(
        pool,
        `DELETE FROM party_games WHERE id IN (
           SELECT id FROM party_games WHERE coalesce(ended_at, started_at) < $1 LIMIT $2)`,
        cutoff,
      ),
  },
  {
    rule: 'daily_results',
    days: 730,
    run: (pool, cutoff) =>
      rows(
        pool,
        `DELETE FROM daily_results WHERE (daily_id, user_id) IN (
           SELECT daily_id, user_id FROM daily_results WHERE completed_at < $1 LIMIT $2)`,
        cutoff,
      ),
  },
  {
    rule: 'practice_sets',
    days: 35,
    run: (pool, cutoff) =>
      rows(
        pool,
        `DELETE FROM practice_sets WHERE (user_id, pack_id, week) IN (
           SELECT user_id, pack_id, week FROM practice_sets WHERE issued_at < $1 LIMIT $2)`,
        cutoff,
      ),
  },
  {
    rule: 'practice_results',
    days: 730,
    run: (pool, cutoff) =>
      rows(
        pool,
        `DELETE FROM practice_results WHERE (user_id, id) IN (
           SELECT user_id, id FROM practice_results WHERE received_at < $1 LIMIT $2)`,
        cutoff,
      ),
  },
  {
    rule: 'integrity_flags',
    days: 730,
    run: (pool, cutoff) =>
      rows(
        pool,
        'DELETE FROM integrity_flags WHERE id IN (SELECT id FROM integrity_flags WHERE created_at < $1 LIMIT $2)',
        cutoff,
      ),
  },
  {
    rule: 'question_reports',
    days: 730,
    run: (pool, cutoff) =>
      rows(
        pool,
        'DELETE FROM question_reports WHERE id IN (SELECT id FROM question_reports WHERE created_at < $1 LIMIT $2)',
        cutoff,
      ),
  },
  {
    rule: 'support_tickets',
    days: 730,
    run: (pool, cutoff) =>
      rows(
        pool,
        'DELETE FROM support_tickets WHERE id IN (SELECT id FROM support_tickets WHERE created_at < $1 LIMIT $2)',
        cutoff,
      ),
  },
  {
    rule: 'consent_records',
    days: 6 * 365 + 2,
    // Kept for the account's life and six years after it was deleted.
    run: (pool, cutoff) =>
      rows(
        pool,
        `DELETE FROM consent_records WHERE id IN (
           SELECT c.id FROM consent_records c JOIN users u ON u.id = c.user_id
            WHERE u.status = 'deleted' AND u.deleted_at < $1 LIMIT $2)`,
        cutoff,
      ),
  },
];

export async function applyRetention(deps: JobDeps): Promise<Record<string, number> | null> {
  const now = deps.clock.now();
  if (new Date(now + WAT_OFFSET_MS).getUTCHours() < RETENTION_HOUR) return null;
  const key = `job:retention:${watDate(now)}`;
  if ((await deps.redis.set(key, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK') return null;
  try {
    const removed: Record<string, number> = {};
    for (const rule of RETENTION_RULES) {
      const cutoff = new Date(now - rule.days * DAY);
      let total = 0;
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const n = await rule.run(deps.pool, cutoff);
        total += n;
        if (n < BATCH) break;
      }
      removed[rule.rule] = total;
      await deps.pool.query(
        'INSERT INTO retention_runs (rule, cutoff, rows, ran_at) VALUES ($1, $2, $3, $4)',
        [rule.rule, cutoff, total, new Date(now)],
      );
    }
    if (Object.values(removed).some((n) => n > 0)) deps.log.info({ removed }, 'retention: removed old data');
    return removed;
  } catch (err) {
    // Let tomorrow's run (or the next worker) try again.
    await deps.redis.del(key);
    throw err;
  }
}
