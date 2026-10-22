import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

export interface AnsweredForStats {
  correct: boolean;
  acceptedMs: number;
  /** The option picked, in canonical order; null for a timeout or a closest-number guess. */
  canonicalIndex: number | null;
}

/** Hot per-question counters (doc 08 §3 `qstat:{qid}`); a worker flushes them to question_stats. */
export async function recordQuestionStats(
  redis: Redis,
  log: FastifyBaseLogger,
  qid: string,
  answer: AnsweredForStats,
): Promise<void> {
  try {
    const key = `qstat:${qid}`;
    const multi = redis.multi().hincrby(key, 'plays', 1).hincrby(key, 'elapsed_ms_sum', answer.acceptedMs);
    if (answer.correct) multi.hincrby(key, 'correct', 1);
    if (answer.canonicalIndex !== null) multi.hincrby(key, `option_${answer.canonicalIndex}`, 1);
    await multi.exec();
  } catch (err) {
    log.warn({ err, qid }, 'question stats not recorded');
  }
}
