/**
 * The nightly content check (GDD §6.3, content doc §4, FR-CON-5), once a night from 03:00 WAT:
 *
 * - Levels: a live question with 200 plays or more gets its level 1–5 from its item rating's
 *   quintile among such questions, once there are enough of them to make quintiles mean something.
 * - Flags, from 300 plays: fewer than 5% right (too hard) or more than 97% (too easy) files a
 *   report for editors and the question stays in the game; most players (over half) picking one
 *   wrong option points at a wrong answer key, so that question also comes out of the game until
 *   an editor decides, and the team gets a staff alert. A flag is filed once per question and kind:
 *   an editor who keeps the question as it is won't see it again.
 */
import { accuracyFlag, answerKeySuspect, levelsByQuintile, watDate } from '@whosabi/game-rules';
import { raiseStaffAlert } from '../admin/alerts';
import { writeAudit } from '../admin/audit';
import { addHistory } from '../content/bank';
import { withTransaction, type PoolClient } from '../db';
import type { JobDeps } from './deps';

const HOUR = 3_600_000;
const WAT_OFFSET_MS = HOUR;
/** Quiet in Nigeria, and after the Daily has rolled over. */
export const CALIBRATION_HOUR = 3;
/** GDD §2: a question's level is recalibrated after 200 answers. */
export const CALIBRATED_PLAYS = 200;
/** Fewer calibrated questions than this, and quintiles say little: levels stay as written. */
export const MIN_FOR_LEVELS = 50;

export interface CalibrationResult {
  relevelled: number;
  flagged: number;
  suspended: number;
}

type Flag = 'too_hard' | 'too_easy' | 'wrong_answer';

/** Runs once a night, however many workers there are; null when it is not time or already done. */
export async function calibrateQuestions(deps: JobDeps): Promise<CalibrationResult | null> {
  const now = deps.clock.now();
  if (new Date(now + WAT_OFFSET_MS).getUTCHours() < CALIBRATION_HOUR) return null;
  const key = `job:calibrate:${watDate(now)}`;
  if ((await deps.redis.set(key, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK') return null;
  try {
    const relevelled = await relevel(deps, now);
    const { flagged, suspended } = await flag(deps, now);
    return { relevelled, flagged, suspended };
  } catch (err) {
    await deps.redis.del(key); // try again next run
    throw err;
  }
}

async function relevel(deps: JobDeps, now: number): Promise<number> {
  return withTransaction(deps.pool, async (client) => {
    const rows = (
      await client.query<{
        id: string;
        d_rating: number;
        difficulty: number;
        version: number;
        plays: string;
      }>(
        `SELECT q.id, q.d_rating, q.difficulty, q.version, s.plays
           FROM questions q JOIN question_stats s ON s.question_id = q.id
          WHERE q.status = 'live' AND q.type <> 'closest_number' AND s.plays >= $1
          ORDER BY q.id FOR UPDATE OF q`,
        [CALIBRATED_PLAYS],
      )
    ).rows;
    if (rows.length < MIN_FOR_LEVELS) return 0;
    const levels = levelsByQuintile(rows.map((r) => r.d_rating));
    let changed = 0;
    for (const [i, row] of rows.entries()) {
      const level = levels[i]!;
      if (level === row.difficulty) continue;
      await client.query('UPDATE questions SET difficulty = $2 WHERE id = $1', [row.id, level]);
      await addHistory(client, {
        questionId: row.id,
        action: 'recalibrated',
        actor: 'system',
        note: `Level ${row.difficulty} → ${level} from ${Number(row.plays).toLocaleString('en-NG')} plays`,
        version: row.version,
        at: now,
      });
      changed++;
    }
    return changed;
  });
}

interface Candidate {
  id: string;
  text: string;
  options: string[];
  correct_index: number;
  version: number;
  plays: string;
  correct: string;
  option_counts: number[];
  flagged: Flag[] | null;
}

async function flag(deps: JobDeps, now: number): Promise<{ flagged: number; suspended: number }> {
  const candidates = (
    await deps.pool.query<Candidate>(
      `SELECT q.id, q.text, q.options, q.correct_index, q.version, s.plays, s.correct, s.option_counts,
              (SELECT array_agg(DISTINCT r.reason) FROM question_reports r
                WHERE r.question_id = q.id AND r.by_numbers) AS flagged
         FROM questions q JOIN question_stats s ON s.question_id = q.id
        WHERE q.status = 'live' AND q.type <> 'closest_number' AND s.plays >= 300`,
    )
  ).rows;
  let flagged = 0;
  let suspended = 0;
  for (const q of candidates) {
    const plays = Number(q.plays);
    const counts = q.option_counts.slice(0, q.options.length);
    const done = new Set(q.flagged ?? []);
    if (answerKeySuspect(counts, q.correct_index)) {
      if (done.has('wrong_answer')) continue;
      const picked = counts.indexOf(Math.max(...counts));
      const share = Math.round((counts[picked]! / counts.reduce((a, b) => a + b, 0)) * 100);
      const note = `From the numbers: ${share}% of players pick “${q.options[picked]}”, not the answer “${
        q.options[q.correct_index]
      }”. Check the answer.`;
      await withTransaction(deps.pool, async (client) => {
        await fileFlag(client, q, 'wrong_answer', note, now);
        await client.query("UPDATE questions SET status = 'suspended', updated_at = $2 WHERE id = $1", [
          q.id,
          new Date(now),
        ]);
        await addHistory(client, {
          questionId: q.id,
          action: 'suspended_by_numbers',
          actor: 'system',
          note,
          version: q.version,
          at: now,
        });
        await writeAudit(client, {
          actor: 'system',
          action: 'question_auto_suspend',
          entity: 'question',
          entityId: q.id,
          reason: note,
        });
        await raiseStaffAlert(client, {
          kind: 'problem',
          title: 'Question taken out: most players pick another answer',
          body: `“${q.text}” ${share}% pick “${q.options[picked]}”. Check the answer in the console.`,
          now,
        });
      });
      flagged++;
      suspended++;
      continue;
    }
    const accuracy = accuracyFlag(plays, Number(q.correct));
    if (!accuracy || done.has(accuracy)) continue;
    const percent = ((Number(q.correct) / plays) * 100).toFixed(accuracy === 'too_easy' ? 0 : 1);
    const note =
      accuracy === 'too_hard'
        ? `From the numbers: only ${percent}% of ${plays.toLocaleString('en-NG')} plays are right. Too hard, or the answer is wrong?`
        : `From the numbers: ${percent}% of ${plays.toLocaleString('en-NG')} plays are right. Too easy to be worth asking?`;
    await withTransaction(deps.pool, async (client) => {
      await fileFlag(client, q, accuracy, note, now);
      await addHistory(client, {
        questionId: q.id,
        action: 'flagged',
        actor: 'system',
        note,
        version: q.version,
        at: now,
      });
    });
    flagged++;
  }
  return { flagged, suspended };
}

/** A report from the numbers, closed by editors in the reports queue like a player's. */
async function fileFlag(
  client: PoolClient,
  q: Candidate,
  reason: Flag,
  note: string,
  now: number,
): Promise<void> {
  await client.query(
    `INSERT INTO question_reports (question_id, user_id, reason, note, by_numbers, created_at)
     VALUES ($1, NULL, $2, $3, true, $4)`,
    [q.id, reason, note, new Date(now)],
  );
}
