import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { NEW_PLAYER_RATING, updateItemRating } from '@whosabi/game-rules';
import type { Pool, PoolClient } from '../db';

export interface AnsweredForStats {
  correct: boolean;
  acceptedMs: number;
  /** The option picked, in canonical order; null for a timeout or a closest-number guess. */
  canonicalIndex: number | null;
}

/** What the difficulty calibration needs from one answer (GDD §6.3): both ratings at the time. */
export interface ItemCalibration {
  itemRating: number;
  playerRating: number;
}

/**
 * Hot per-question counters (doc 08 §3 `qstat:{qid}`); a worker flushes them to question_stats.
 * With `calibration`, the answer also moves the question's item rating (`d_delta`, applied by the
 * same flush): right answers make it easier, misses harder. Tie-breaks have no right answer.
 */
export async function recordQuestionStats(
  redis: Redis,
  log: FastifyBaseLogger,
  qid: string,
  answer: AnsweredForStats,
  calibration: ItemCalibration | null = null,
): Promise<void> {
  try {
    const key = `qstat:${qid}`;
    const multi = redis.multi().hincrby(key, 'plays', 1).hincrby(key, 'elapsed_ms_sum', answer.acceptedMs);
    if (answer.correct) multi.hincrby(key, 'correct', 1);
    if (answer.canonicalIndex !== null) multi.hincrby(key, `option_${answer.canonicalIndex}`, 1);
    if (calibration) {
      const { itemRating, playerRating } = calibration;
      multi.hincrbyfloat(
        key,
        'd_delta',
        updateItemRating(itemRating, playerRating, answer.correct) - itemRating,
      );
    }
    await multi.exec();
  } catch (err) {
    log.warn({ err, qid }, 'question stats not recorded');
  }
}

/** A player's overall rating for calibration; new players and guests count as 1500. */
export async function overallRating(db: Pool | PoolClient, userId: string): Promise<number> {
  const result = await db.query<{ rating: number }>(
    "SELECT rating FROM ratings WHERE user_id = $1 AND scope = 'overall'",
    [userId],
  );
  return result.rows[0]?.rating ?? NEW_PLAYER_RATING.rating;
}
