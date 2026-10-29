/**
 * The nightly integrity checks (doc 10 §2, doc 18 §12, build plan step 2.7e), once a night from
 * 04:00 WAT, over the last 7 days of duel answers:
 *
 * - accuracy against how hard the questions are (questions with 50 plays or more), and near-perfect
 *   hard answers at a near-constant speed;
 * - the app's clock far behind the server's;
 * - on the web, far more right answers with the tab hidden.
 *
 * Each finding is a flag in the Integrity queue for a moderator; a player is flagged for the same
 * thing at most once a week, and nothing bans anyone automatically. New flags raise one staff
 * alert a night.
 */
import {
  accuracyOutlier,
  P_FLOOR,
  TAB_HIDDEN_MS,
  tabHiding,
  timingAnomaly,
  watDate,
  type IntegritySignal,
} from '@whosabi/game-rules';
import { raiseStaffAlert } from '../admin/alerts';
import type { JobDeps } from './deps';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** After the content check (03:00) and before the ledger check (04:30). */
export const INTEGRITY_HOUR = 4;
const WINDOW_DAYS = 7;
const MIN_PLAYS = 50;

type Kind = 'accuracy_outlier' | 'timing_anomaly' | 'tab_hidden';

export interface IntegrityResult {
  checked: number;
  flagged: number;
}

/** Runs once a night, however many workers there are; null when it is not time or already done. */
export async function checkIntegrity(deps: JobDeps): Promise<IntegrityResult | null> {
  const now = deps.clock.now();
  if (new Date(now + HOUR).getUTCHours() < INTEGRITY_HOUR) return null;
  const date = watDate(now);
  const key = `job:integrity:${date}`;
  if ((await deps.redis.set(key, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK') return null;
  try {
    return await run(deps, now, date);
  } catch (err) {
    await deps.redis.del(key); // try again next run
    throw err;
  }
}

async function run(deps: JobDeps, now: number, date: string): Promise<IntegrityResult> {
  const { pool } = deps;
  const since = new Date(now - WINDOW_DAYS * DAY);
  const players = "JOIN users u ON u.id = a.user_id AND u.status NOT IN ('bot', 'deleted')";
  const [accuracy, timing, tabs] = await Promise.all([
    pool.query<{
      user_id: string;
      answers: string;
      hits: string;
      expected: number;
      variance: number;
      hard_answers: string;
      hard_hits: string;
      hard_mean: number | null;
      hard_sd: number | null;
    }>(
      `SELECT a.user_id, count(*) AS answers, count(*) FILTER (WHERE a.correct) AS hits,
              sum(s.p) AS expected, sum(s.p * (1 - s.p)) AS variance,
              count(*) FILTER (WHERE s.p < 0.5) AS hard_answers,
              count(*) FILTER (WHERE s.p < 0.5 AND a.correct) AS hard_hits,
              avg(a.accepted_elapsed_ms) FILTER (WHERE s.p < 0.5) AS hard_mean,
              stddev_samp(a.accepted_elapsed_ms) FILTER (WHERE s.p < 0.5) AS hard_sd
         FROM duel_answers a ${players}
         JOIN (SELECT question_id, greatest(least(correct::float8 / plays, 1 - $2::float8), $2::float8) AS p
                 FROM question_stats WHERE plays >= $3) s ON s.question_id = a.question_id
        WHERE a.received_at >= $1 AND a.correct IS NOT NULL
        GROUP BY a.user_id`,
      [since, P_FLOOR, MIN_PLAYS],
    ),
    pool.query<{ user_id: string; answers: string; median_gap: number }>(
      `SELECT a.user_id, count(*) AS answers,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY
                extract(epoch FROM a.received_at - a.served_at) * 1000 - coalesce(a.rtt_est_ms, 0) - a.client_elapsed_ms
              ) AS median_gap
         FROM duel_answers a ${players}
        WHERE a.received_at >= $1 AND a.client_elapsed_ms IS NOT NULL
        GROUP BY a.user_id`,
      [since],
    ),
    pool.query<{
      user_id: string;
      answers: string;
      hidden: string;
      accuracy_hidden: number | null;
      accuracy_visible: number | null;
    }>(
      `SELECT a.user_id, count(*) AS answers,
              count(*) FILTER (WHERE a.tab_hidden_ms >= $2) AS hidden,
              avg(a.correct::int) FILTER (WHERE a.tab_hidden_ms >= $2) AS accuracy_hidden,
              avg(a.correct::int) FILTER (WHERE coalesce(a.tab_hidden_ms, 0) < $2) AS accuracy_visible
         FROM duel_answers a ${players}
        WHERE a.received_at >= $1 AND a.platform = 'web' AND a.correct IS NOT NULL
        GROUP BY a.user_id`,
      [since, TAB_HIDDEN_MS],
    ),
  ]);

  const findings: Array<{ userId: string; kind: Kind; signal: IntegritySignal }> = [];
  const found = (userId: string, kind: Kind, signal: IntegritySignal | null) => {
    if (signal) findings.push({ userId, kind, signal });
  };
  for (const r of accuracy.rows) {
    found(
      r.user_id,
      'accuracy_outlier',
      accuracyOutlier({
        answers: Number(r.answers),
        right: Number(r.hits),
        expected: Number(r.expected),
        variance: Number(r.variance),
        hardAnswers: Number(r.hard_answers),
        hardRight: Number(r.hard_hits),
        hardMeanMs: Number(r.hard_mean ?? 0),
        hardSdMs: Number(r.hard_sd ?? 0),
      }),
    );
  }
  for (const r of timing.rows)
    found(r.user_id, 'timing_anomaly', timingAnomaly(Number(r.answers), Number(r.median_gap)));
  for (const r of tabs.rows) {
    found(
      r.user_id,
      'tab_hidden',
      tabHiding({
        answers: Number(r.answers),
        hidden: Number(r.hidden),
        accuracyHidden: Number(r.accuracy_hidden ?? 0),
        accuracyVisible: Number(r.accuracy_visible ?? 0),
      }),
    );
  }

  let flagged = 0;
  for (const f of findings) {
    // Once a week per player and kind, whatever a moderator decided last time.
    const inserted = await pool.query(
      `INSERT INTO integrity_flags (user_id, kind, score, evidence, created_at)
       SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (SELECT 1 FROM integrity_flags WHERE user_id = $1 AND kind = $2 AND created_at > $6)`,
      [f.userId, f.kind, f.signal.score, JSON.stringify(f.signal.evidence), new Date(now), since],
    );
    flagged += inserted.rowCount ?? 0;
  }
  if (flagged > 0) {
    const top = Math.max(...findings.map((f) => f.signal.score));
    await raiseStaffAlert(pool, {
      kind: 'problem',
      title: `${flagged} new integrity flag${flagged === 1 ? '' : 's'}`,
      body: `The nightly checks found players worth a look (highest risk ${Math.round(top * 100)}%). Nothing was done automatically.`,
      url: '/integrity',
      dedupeKey: `integrity:${date}`,
      now,
    });
  }
  const checked = new Set([...accuracy.rows, ...timing.rows, ...tabs.rows].map((r) => r.user_id)).size;
  deps.log.info({ checked, flagged }, 'integrity checks');
  return { checked, flagged };
}
