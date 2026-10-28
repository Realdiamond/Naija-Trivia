/**
 * Player reports (PRD US-9, FR-CON-4): a report in two taps, kept once per player and question.
 * Five "wrong answer" reports, or reports on more than 3% of plays (from 100 plays), take the
 * question out of rotation at once (`shouldAutoSuspend` in game-rules). Editors work through the
 * queue in the admin console: fix the question, keep it as it is, or retire it.
 */
import { checkQuestion, shouldAutoSuspend } from '@whosabi/game-rules';
import {
  ErrorCode,
  type AdminReportGroup,
  type AdminReportsResponse,
  type QuestionStatus,
  type ReportReason,
} from '@whosabi/shared-types';
import { writeAudit } from '../admin/audit';
import { withTransaction, type Pool } from '../db';
import { ApiError, notFound } from '../errors';
import { addHistory, draftOf, inputOf, loadQuestionRow } from './bank';

/** The statuses a player can have seen a question in. */
const PLAYED_STATUSES: readonly QuestionStatus[] = ['live', 'suspended', 'retired'];

export interface ReportOutcome {
  /** False when this player had already reported the question. */
  recorded: boolean;
  suspended: boolean;
}

export async function reportQuestion(
  pool: Pool,
  report: { questionId: string; userId: string; reason: ReportReason; note: string | null; now: number },
): Promise<ReportOutcome> {
  return withTransaction(pool, async (client) => {
    const row = await loadQuestionRow(client, report.questionId, true);
    if (!row || !PLAYED_STATUSES.includes(row.status)) throw notFound('There is no question with this id.');
    const inserted = await client.query(
      `INSERT INTO question_reports (question_id, user_id, reason, note, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (question_id, user_id) DO NOTHING`,
      [row.id, report.userId, report.reason, report.note, new Date(report.now)],
    );
    if (inserted.rowCount === 0) return { recorded: false, suspended: false };
    await client.query(
      `INSERT INTO question_stats (question_id, reports, updated_at) VALUES ($1, 1, $2)
       ON CONFLICT (question_id) DO UPDATE SET reports = question_stats.reports + 1, updated_at = $2`,
      [row.id, new Date(report.now)],
    );
    if (row.status !== 'live') return { recorded: true, suspended: false };

    const counts = (
      await client.query<{ total: number; wrong: number; plays: string | null }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE reason = 'wrong_answer')::int AS wrong,
                (SELECT plays FROM question_stats WHERE question_id = $1) AS plays
           FROM question_reports WHERE question_id = $1 AND resolution IS NULL`,
        [row.id],
      )
    ).rows[0]!;
    const suspend = shouldAutoSuspend({
      plays: Number(counts.plays ?? 0),
      wrongAnswerReports: counts.wrong,
      totalReports: counts.total,
    });
    if (!suspend) return { recorded: true, suspended: false };
    await client.query("UPDATE questions SET status = 'suspended', updated_at = $2 WHERE id = $1", [
      row.id,
      new Date(report.now),
    ]);
    const note = `${counts.total} open reports (${counts.wrong} wrong answer) on ${Number(counts.plays ?? 0)} plays`;
    await addHistory(client, {
      questionId: row.id,
      action: 'auto_suspended',
      actor: 'system',
      note,
      version: row.version,
      at: report.now,
    });
    await writeAudit(client, {
      actor: 'system',
      action: 'question_auto_suspend',
      entity: 'question',
      entityId: row.id,
      reason: note,
    });
    return { recorded: true, suspended: true };
  });
}

/** Questions with open reports: suspended ones first, then the most reported. */
export async function reportQueue(pool: Pool): Promise<AdminReportsResponse> {
  const groups = await pool.query<{
    question_id: string;
    external_ref: string | null;
    text: string;
    category_id: string;
    status: QuestionStatus;
    plays: string | null;
    open: number;
    reasons: Record<string, number>;
    notes: string[] | null;
    first_at: Date;
    last_at: Date;
    auto_suspended: boolean;
  }>(
    `SELECT r.question_id, q.external_ref, q.text, q.category_id, q.status, s.plays,
            count(*)::int AS open,
            (SELECT jsonb_object_agg(reason, n) FROM (
               SELECT reason, count(*)::int AS n FROM question_reports
                WHERE question_id = r.question_id AND resolution IS NULL GROUP BY reason) x) AS reasons,
            (array_agg(r.note ORDER BY r.created_at DESC) FILTER (WHERE r.note IS NOT NULL))[1:5] AS notes,
            min(r.created_at) AS first_at, max(r.created_at) AS last_at,
            q.status = 'suspended' AND (
              SELECT action FROM question_history h WHERE h.question_id = q.id ORDER BY h.id DESC LIMIT 1
            ) = 'auto_suspended' AS auto_suspended
       FROM question_reports r
       JOIN questions q ON q.id = r.question_id
       LEFT JOIN question_stats s ON s.question_id = q.id
      WHERE r.resolution IS NULL
      GROUP BY r.question_id, q.id, s.plays
      ORDER BY (q.status = 'suspended') DESC, count(*) DESC, max(r.created_at) DESC
      LIMIT 100`,
  );
  return {
    groups: groups.rows.map((g): AdminReportGroup => ({
      question: {
        id: g.question_id,
        external_ref: g.external_ref,
        text: g.text,
        category_id: g.category_id,
        status: g.status,
      },
      open: g.open,
      reasons: g.reasons,
      notes: g.notes ?? [],
      plays: Number(g.plays ?? 0),
      auto_suspended: g.auto_suspended,
      first_at: g.first_at.toISOString(),
      last_at: g.last_at.toISOString(),
    })),
  };
}

/**
 * Closes every open report on a question. Fixed or rejected (nothing wrong): a suspended question
 * goes back live. Retired: out of the game.
 */
export async function resolveReports(
  pool: Pool,
  input: {
    questionId: string;
    resolution: 'fixed' | 'rejected' | 'retired';
    note: string | null;
    actor: string;
    ip: string | null;
    now: number;
  },
): Promise<number> {
  return withTransaction(pool, async (client) => {
    const row = await loadQuestionRow(client, input.questionId, true);
    if (!row) throw notFound('There is no question with this id.');
    const closed = await client.query(
      `UPDATE question_reports SET resolution = $2, resolved_by = $3, resolved_at = $4
        WHERE question_id = $1 AND resolution IS NULL`,
      [row.id, input.resolution, input.actor, new Date(input.now)],
    );
    const to: QuestionStatus | null =
      input.resolution === 'retired'
        ? row.status === 'retired'
          ? null
          : 'retired'
        : row.status === 'suspended'
          ? 'live'
          : null;
    if (to === 'live') {
      const { errors } = checkQuestion(draftOf(inputOf(row)), { forReview: true });
      if (errors.length > 0) {
        throw new ApiError(409, ErrorCode.conflict, 'Fix the question first', errors.join(' '));
      }
    }
    if (to) {
      await client.query('UPDATE questions SET status = $2, updated_at = $3 WHERE id = $1', [
        row.id,
        to,
        new Date(input.now),
      ]);
    }
    await addHistory(client, {
      questionId: row.id,
      action: `reports_${input.resolution}`,
      actor: input.actor,
      note: input.note,
      version: row.version,
      at: input.now,
    });
    await writeAudit(client, {
      actor: input.actor,
      action: 'resolve_reports',
      entity: 'question',
      entityId: row.id,
      reason: input.note,
      before: { status: row.status },
      after: { status: to ?? row.status, resolution: input.resolution, reports: closed.rowCount },
      ip: input.ip,
    });
    return closed.rowCount ?? 0;
  });
}
