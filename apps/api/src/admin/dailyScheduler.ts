/**
 * The Daily scheduler (doc 18 §11, build plan step 2.7f): the next 30 Dailies with exactly the
 * questions players will get, planned ahead in one go, and a question swapped for another until
 * 22:00 WAT the day before. Owners, admins and LiveOps (`liveops.daily`); planning and swaps
 * need a reason and go in the audit log. Players get each question's options shuffled as usual.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, DAILY_PLAN_DAYS, dailyEditable, watDate } from '@whosabi/game-rules';
import {
  AdminDailyCandidatesQuery,
  AdminDailyPlan,
  AdminDailySwap,
  ErrorCode,
  type AdminDailyCalendar,
  type AdminDailyCandidates,
  type AdminDailyDay,
  type AdminDailyPlanResponse,
  type AdminDailyQuestion,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { dailyByDate, ensureDaily, type DailyRow } from '../daily/repo';
import { withTransaction, type Pool } from '../db';
import { ApiError, conflict, notFound, parse } from '../errors';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const DateParams = z.object({ date: z.iso.date() });

interface QuestionRow {
  id: string;
  category: string;
  type: string;
  difficulty: number;
  text: string;
  options: string[];
  correct_index: number;
  fact: string | null;
  plays: string | null;
  correct: string | null;
  /** Every Daily it was in, oldest first. */
  dailies: string[] | null;
}

/** The same questions players can get in a Daily (repo.ts's `dailyCandidates`): live, family-safe, in an open category. */
const SERVABLE = `q.status = 'live' AND q.family_safe AND q.type IN ('mcq4', 'true_false')
  AND (q.valid_until IS NULL OR q.valid_until >= $DATE::date)
  AND EXISTS (SELECT 1 FROM categories c WHERE c.id = q.category_id AND c.active)`;

const QUESTION_SELECT = `
  SELECT q.id, q.category_id AS category, q.type::text AS type, q.difficulty, q.text, q.options, q.correct_index,
         q.fact, s.plays, s.correct,
         (SELECT array_agg(to_char(dc.play_date, 'YYYY-MM-DD') ORDER BY dc.play_date)
            FROM daily_challenges dc WHERE q.id = ANY(dc.question_ids)) AS dailies
    FROM questions q LEFT JOIN question_stats s ON s.question_id = q.id`;

function questionView(row: QuestionRow, date: string): AdminDailyQuestion {
  const plays = Number(row.plays ?? 0);
  return {
    id: row.id,
    category: row.category,
    type: row.type,
    difficulty: row.difficulty,
    text: row.text,
    options: row.options,
    correct_index: row.correct_index,
    fact: row.fact,
    last_used: (row.dailies ?? []).filter((d) => d < date).at(-1) ?? null,
    plays,
    correct_rate: plays > 0 ? Math.round((Number(row.correct ?? 0) / plays) * 100) / 100 : null,
  };
}

async function questionRows(pool: Pool, ids: string[]): Promise<Map<string, QuestionRow>> {
  const rows = await pool.query<QuestionRow>(`${QUESTION_SELECT} WHERE q.id = ANY($1)`, [ids]);
  return new Map(rows.rows.map((r) => [r.id, r]));
}

export function adminDailyRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, log } = deps;

  async function days(dates: string[]): Promise<AdminDailyDay[]> {
    const dailies = await pool.query<DailyRow & { players: string }>(
      `SELECT dc.id, to_char(dc.play_date, 'YYYY-MM-DD') AS play_date, dc.question_ids, dc.locked,
              (SELECT count(*) FROM daily_results r WHERE r.daily_id = dc.id) AS players
         FROM daily_challenges dc WHERE dc.play_date = ANY($1::date[])`,
      [dates],
    );
    const byDate = new Map(dailies.rows.map((d) => [d.play_date, d]));
    const questions = await questionRows(
      pool,
      dailies.rows.flatMap((d) => d.question_ids),
    );
    const now = clock.now();
    return dates.map((date) => {
      const daily = byDate.get(date);
      return {
        date,
        id: daily?.id ?? null,
        locked: daily?.locked ?? false,
        editable: Boolean(daily) && !daily!.locked && dailyEditable(date, now),
        players: Number(daily?.players ?? 0),
        questions: (daily?.question_ids ?? []).flatMap((id) => {
          const row = questions.get(id);
          return row ? [questionView(row, date)] : [];
        }),
      };
    });
  }

  const nextDays = (today: string) => Array.from({ length: DAILY_PLAN_DAYS }, (_, i) => addDays(today, i));

  app.get('/admin/daily', async (request): Promise<AdminDailyCalendar> => {
    await requireAdmin(request, ctx, 'liveops.daily');
    const today = watDate(clock.now());
    return { today, days: await days(nextDays(today)) };
  });

  /** Picks every Daily missing from the next 30 days; those far enough ahead stay open to swaps. */
  app.post('/admin/daily/plan', async (request): Promise<AdminDailyPlanResponse> => {
    const admin = await requireAdmin(request, ctx, 'liveops.daily');
    const body = parse(AdminDailyPlan, request.body);
    const now = clock.now();
    let planned = 0;
    const short: string[] = [];
    // In date order, so each new Daily's number follows the last.
    for (const date of nextDays(watDate(now))) {
      if (await dailyByDate(pool, date)) continue;
      const made = await ensureDaily(pool, log, date, Math.random, !dailyEditable(date, now));
      if (made) planned++;
      else short.push(date);
    }
    await writeAudit(pool, {
      actor: admin.id,
      action: 'plan_dailies',
      entity: 'daily',
      reason: body.reason,
      after: { planned, short },
      ip: request.ip,
    });
    return { planned, short };
  });

  app.get('/admin/daily/:date', async (request): Promise<AdminDailyDay> => {
    await requireAdmin(request, ctx, 'liveops.daily');
    const { date } = parse(DateParams, request.params);
    return (await days([date]))[0]!;
  });

  /** What could replace the question in `slot`: the same category first, close in difficulty, least used. */
  app.get('/admin/daily/:date/candidates', async (request): Promise<AdminDailyCandidates> => {
    await requireAdmin(request, ctx, 'liveops.daily');
    const { date } = parse(DateParams, request.params);
    const { slot } = parse(AdminDailyCandidatesQuery, request.query);
    const daily = await dailyByDate(pool, date);
    if (!daily) throw notFound('No Daily planned for that day.');
    const current = (await questionRows(pool, [daily.question_ids[slot - 1]!])).get(
      daily.question_ids[slot - 1]!,
    );
    const rows = await pool.query<QuestionRow>(
      `${QUESTION_SELECT}
        WHERE ${SERVABLE.replaceAll('$DATE', '$1')} AND NOT (q.id = ANY($2))
        ORDER BY (q.category_id = $3) DESC, abs(q.difficulty - $4), coalesce(s.plays, 0), q.id
        LIMIT 20`,
      [date, daily.question_ids, current?.category ?? '', current?.difficulty ?? 3],
    );
    return { slot, candidates: rows.rows.map((r) => questionView(r, date)) };
  });

  app.post('/admin/daily/:date/swap', async (request): Promise<AdminDailyDay> => {
    const admin = await requireAdmin(request, ctx, 'liveops.daily');
    const { date } = parse(DateParams, request.params);
    const body = parse(AdminDailySwap, request.body);
    await withTransaction(pool, async (client) => {
      const daily = (
        await client.query<DailyRow>(
          `SELECT id, to_char(play_date, 'YYYY-MM-DD') AS play_date, question_ids, locked
             FROM daily_challenges WHERE play_date = $1 FOR UPDATE`,
          [date],
        )
      ).rows[0];
      if (!daily) throw notFound('No Daily planned for that day.');
      if (daily.locked || !dailyEditable(date, clock.now())) {
        throw conflict(
          ErrorCode.conflict,
          'Too late to change',
          'A Daily is fixed from 22:00 WAT the day before, so everyone gets the same questions.',
        );
      }
      if (daily.question_ids.includes(body.question_id)) {
        throw conflict(ErrorCode.conflict, 'Already in this Daily', 'Pick a question that is not in it yet.');
      }
      const ok = await client.query(
        `SELECT 1 FROM questions q WHERE q.id = $2 AND ${SERVABLE.replaceAll('$DATE', '$1')}`,
        [date, body.question_id],
      );
      if (ok.rowCount === 0) {
        throw new ApiError(
          400,
          ErrorCode.validation,
          'Not a Daily question',
          'Daily questions are live, family-safe, multiple choice or true/false, in an open category.',
        );
      }
      const old = daily.question_ids[body.slot - 1]!;
      await client.query('UPDATE daily_challenges SET question_ids[$2] = $3 WHERE id = $1', [
        daily.id,
        body.slot,
        body.question_id,
      ]);
      await writeAudit(client, {
        actor: admin.id,
        action: 'swap_daily_question',
        entity: 'daily',
        entityId: String(daily.id),
        reason: body.reason,
        before: { date, slot: body.slot, question: old },
        after: { date, slot: body.slot, question: body.question_id },
        ip: request.ip,
      });
    });
    return (await days([date]))[0]!;
  });
}
