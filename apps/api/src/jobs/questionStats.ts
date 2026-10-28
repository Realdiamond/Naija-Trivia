/**
 * Moves the hot per-question counters (`qstat:{qid}` in Redis, content/stats.ts) into
 * `question_stats`, which "Ask Naija" and difficulty calibration read (doc 08 §3).
 *
 * Each counter is renamed to `qstatf:{qid}` before it is read, so answers keep counting into a
 * fresh key while it is written to Postgres, and a flush that dies halfway is finished by the
 * next one. A Redis lock keeps two workers from adding the same counter twice.
 */
import { randomUUID } from 'node:crypto';
import type { JobDeps } from './deps';

const LOCK_KEY = 'lock:qstat-flush';
const LOCK_MS = 120_000;
const LIVE = 'qstat:';
const FLUSHING = 'qstatf:';
const OPTIONS = 4; // question_stats.option_counts, canonical order

// Release the lock only if it is still ours.
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/** Returns how many questions were updated; 0 when another worker holds the lock. */
export async function flushQuestionStats(deps: JobDeps): Promise<number> {
  const { redis } = deps;
  const token = randomUUID();
  if ((await redis.set(LOCK_KEY, token, 'PX', LOCK_MS, 'NX')) !== 'OK') return 0;
  try {
    let flushed = 0;
    // Leftovers from a flush that died first, then the live counters.
    for (const key of await keys(deps, FLUSHING)) flushed += await flushKey(deps, key);
    for (const key of await keys(deps, LIVE)) {
      const pending = FLUSHING + key.slice(LIVE.length);
      // RENAMENX fails only if a leftover with this id survived the pass above; it goes next time.
      if ((await redis.renamenx(key, pending)) === 1) flushed += await flushKey(deps, pending);
    }
    return flushed;
  } finally {
    await redis.eval(RELEASE, 1, LOCK_KEY, token);
  }
}

async function keys(deps: JobDeps, prefix: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await deps.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    found.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return found;
}

async function flushKey(deps: JobDeps, key: string): Promise<number> {
  const qid = key.slice(FLUSHING.length);
  const h = await deps.redis.hgetall(key);
  const n = (field: string) => Number.parseInt(h[field] ?? '0', 10) || 0;
  const plays = n('plays');
  if (plays > 0) {
    const options = Array.from({ length: OPTIONS }, (_, i) => n(`option_${i}`));
    try {
      await deps.pool.query(
        `INSERT INTO question_stats (question_id, plays, correct, option_counts, avg_elapsed_ms, updated_at)
         VALUES ($1, $2::bigint, $3::bigint, $4::int[], round($5::numeric / $2::bigint), $6)
         ON CONFLICT (question_id) DO UPDATE SET
           plays = question_stats.plays + EXCLUDED.plays,
           correct = question_stats.correct + EXCLUDED.correct,
           option_counts = ARRAY(
             SELECT coalesce(old, 0) + coalesce(new, 0)
               FROM unnest(question_stats.option_counts, EXCLUDED.option_counts) AS x(old, new)),
           avg_elapsed_ms = round(
             (coalesce(question_stats.avg_elapsed_ms, 0)::numeric * question_stats.plays + $5)
             / (question_stats.plays + EXCLUDED.plays)),
           updated_at = EXCLUDED.updated_at`,
        [qid, plays, n('correct'), options, n('elapsed_ms_sum'), new Date(deps.clock.now())],
      );
    } catch (err) {
      // A question deleted since it was answered has nowhere to go; anything else is retried.
      if ((err as { code?: string }).code !== '23503') throw err;
      deps.log.warn({ qid }, 'question stats dropped: the question no longer exists');
    }
  }
  await deps.redis.del(key);
  return plays > 0 ? 1 : 0;
}
