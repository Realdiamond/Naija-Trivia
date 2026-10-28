/**
 * The question bank behind the admin console's Content module (doc 18 §12): listing, the
 * editor, workflow moves and bulk publishing. Every change is kept in `question_history` and
 * the audit log; an edit keeps the content as it was before.
 */
import {
  addDays,
  checkQuestion,
  initialItemRating,
  TRENDING_DAYS,
  trendingValidUntil,
  watDate,
  type DifficultyLevel,
  type QuestionDraft,
} from '@whosabi/game-rules';
import {
  ErrorCode,
  type AdminBulkPublishResponse,
  type AdminQuestion,
  type AdminQuestionInput,
  type AdminQuestionListQuery,
  type AdminQuestionListResponse,
  type QuestionAction,
  type QuestionStatus,
} from '@whosabi/shared-types';
import type { z } from 'zod';
import { writeAudit } from '../admin/audit';
import { withTransaction, type Pool, type PoolClient } from '../db';
import { ApiError, notFound } from '../errors';
import { newId } from '../ids';
import {
  allowedActions,
  canEdit,
  canSee,
  CHECKED_ACTIONS,
  refusal,
  TRANSITIONS,
  type Actor,
} from './workflow';

type Db = Pool | PoolClient;

export interface QuestionRow {
  id: string;
  external_ref: string | null;
  category_id: AdminQuestionInput['category_id'];
  subcategory: string | null;
  type: AdminQuestionInput['type'];
  text: string;
  options: string[];
  correct_index: number | null;
  numeric_answer: string | null;
  fact: string | null;
  difficulty: number;
  d_rating: number;
  family_safe: boolean;
  region_tag: AdminQuestionInput['region_tag'];
  valid_until: string | null;
  source_url: string | null;
  trending: boolean;
  status: QuestionStatus;
  author_id: string | null;
  reviewed_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, external_ref, category_id, subcategory, type, text, options, correct_index, numeric_answer,
  fact, difficulty, d_rating, family_safe, region_tag, to_char(valid_until, 'YYYY-MM-DD') AS valid_until,
  source_url, trending, status, author_id, reviewed_by, version, created_at, updated_at`;

/** The parts of a question an edit can change, as the editor sends them. */
export function inputOf(row: QuestionRow): AdminQuestionInput {
  return {
    category_id: row.category_id,
    subcategory: row.subcategory,
    type: row.type,
    text: row.text,
    options: row.options,
    correct_index: row.correct_index,
    numeric_answer: row.numeric_answer === null ? null : Number(row.numeric_answer),
    fact: row.fact,
    difficulty: row.difficulty,
    family_safe: row.family_safe,
    region_tag: row.region_tag,
    valid_until: row.valid_until,
    source_url: row.source_url,
    trending: row.trending,
  };
}

export function draftOf(q: AdminQuestionInput): QuestionDraft {
  return {
    type: q.type,
    text: q.text,
    options: q.options,
    correctIndex: q.correct_index,
    numericAnswer: q.numeric_answer,
    fact: q.fact,
    difficulty: q.difficulty,
    regionTag: q.region_tag,
    validUntil: q.valid_until,
    sourceUrl: q.source_url,
  };
}

/** What the database needs to hold a question at all, even a draft: an answer that fits the options. */
function assertStorable(q: AdminQuestionInput): void {
  const wanted = q.type === 'mcq4' ? 4 : q.type === 'true_false' ? 2 : 0;
  const invalid = (detail: string) =>
    new ApiError(400, ErrorCode.validation, 'The question is not valid', detail);
  if (q.options.length !== wanted) throw invalid(`A ${q.type} question has ${wanted} options.`);
  if (q.type === 'closest_number') {
    if (q.numeric_answer === null) throw invalid('Enter the number that answers it.');
  } else if (q.correct_index === null || q.correct_index >= q.options.length) {
    throw invalid('Mark which option is right.');
  }
}

const DONE: Record<QuestionAction, string> = {
  submit: 'submitted',
  approve: 'approved',
  send_back: 'sent back',
  publish: 'published',
  suspend: 'suspended',
  restore: 'restored',
  retire: 'retired',
  reopen: 'reopened',
};

const notAllowed = (detail: string) => new ApiError(403, ErrorCode.forbidden, 'Not allowed', detail);

export async function loadQuestionRow(db: Db, id: string, forUpdate = false): Promise<QuestionRow | null> {
  const result = await db.query<QuestionRow>(
    `SELECT ${COLUMNS} FROM questions WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function addHistory(
  db: Db,
  entry: {
    questionId: string;
    action: string;
    actor: string;
    version: number;
    note?: string | null;
    snapshot?: unknown;
    at: number;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO question_history (question_id, action, actor, note, version, snapshot, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.questionId,
      entry.action,
      entry.actor,
      entry.note ?? null,
      entry.version,
      entry.snapshot === undefined ? null : JSON.stringify(entry.snapshot),
      new Date(entry.at),
    ],
  );
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class QuestionBank {
  constructor(private readonly deps: { pool: Pool; now: () => number }) {}

  async list(
    query: z.output<typeof AdminQuestionListQuery>,
    actor: Actor,
  ): Promise<AdminQuestionListResponse> {
    const { pool } = this.deps;
    const ownOnly = actor.permissions.includes('content.review') ? null : actor.id;
    const cursor = decodeCursor(query.cursor);
    const params: unknown[] = [
      query.status ?? null,
      query.category ?? null,
      query.q ? `%${escapeLike(query.q)}%` : null,
      query.q ?? null,
      ownOnly,
      query.reported === true,
      cursor ? new Date(cursor.at) : null,
      cursor?.id ?? null,
      query.limit + 1,
    ];
    const rows = await pool.query<{
      id: string;
      external_ref: string | null;
      text: string;
      category_id: string;
      type: string;
      difficulty: number;
      status: QuestionStatus;
      version: number;
      author: string | null;
      plays: string;
      correct: string;
      open_reports: number;
      updated_at: Date;
    }>(
      `SELECT q.id, q.external_ref, q.text, q.category_id, q.type, q.difficulty, q.status, q.version,
              a.name AS author, COALESCE(s.plays, 0) AS plays, COALESCE(s.correct, 0) AS correct,
              (SELECT count(*)::int FROM question_reports r WHERE r.question_id = q.id AND r.resolution IS NULL)
                AS open_reports,
              q.updated_at
         FROM questions q
         LEFT JOIN question_stats s ON s.question_id = q.id
         LEFT JOIN admin_users a ON a.id = q.author_id
        WHERE ($1::question_status IS NULL OR q.status = $1)
          AND ($2::text IS NULL OR q.category_id = $2)
          AND ($3::text IS NULL OR q.text ILIKE $3 OR q.id = $4 OR q.external_ref ILIKE $4)
          AND ($5::text IS NULL OR q.author_id = $5)
          AND (NOT $6 OR EXISTS (SELECT 1 FROM question_reports r WHERE r.question_id = q.id AND r.resolution IS NULL))
          AND ($7::timestamptz IS NULL OR (q.updated_at, q.id) < ($7, $8))
        ORDER BY q.updated_at DESC, q.id DESC
        LIMIT $9`,
      params,
    );
    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);
    const counts = await pool.query<{ status: QuestionStatus; n: number }>(
      `SELECT status, count(*)::int AS n FROM questions
        WHERE ($1::text IS NULL OR category_id = $1) AND ($2::text IS NULL OR author_id = $2)
        GROUP BY status`,
      [query.category ?? null, ownOnly],
    );
    const byStatus = Object.fromEntries(
      (['draft', 'in_review', 'approved', 'live', 'suspended', 'retired'] as const).map((s) => [s, 0]),
    ) as Record<QuestionStatus, number>;
    for (const c of counts.rows) byStatus[c.status] = c.n;
    return {
      questions: page.map((r) => ({
        id: r.id,
        external_ref: r.external_ref,
        text: r.text,
        category_id: r.category_id,
        type: r.type,
        difficulty: r.difficulty,
        status: r.status,
        version: r.version,
        author: r.author,
        plays: Number(r.plays),
        correct_rate: Number(r.plays) > 0 ? Number(r.correct) / Number(r.plays) : null,
        open_reports: r.open_reports,
        updated_at: r.updated_at.toISOString(),
      })),
      next_cursor:
        rows.rows.length > query.limit && last ? encodeCursor(last.updated_at.getTime(), last.id) : null,
      counts: byStatus,
    };
  }

  async detail(id: string, actor: Actor): Promise<AdminQuestion> {
    const { pool } = this.deps;
    const row = await loadQuestionRow(pool, id);
    if (!row || !canSee(actor, row)) throw notFound('There is no question with this id.');
    const [stats, reports, similar, history, people] = await Promise.all([
      pool.query<{ plays: string; correct: string; avg_elapsed_ms: number | null; option_counts: number[] }>(
        'SELECT plays, correct, avg_elapsed_ms, option_counts FROM question_stats WHERE question_id = $1',
        [id],
      ),
      pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM question_reports WHERE question_id = $1 AND resolution IS NULL',
        [id],
      ),
      pool.query<{ id: string; text: string; status: QuestionStatus; similarity: number }>(
        `SELECT id, text, status, similarity(text, $1) AS similarity FROM questions
          WHERE id <> $2 AND status <> 'retired' AND text % $1 AND similarity(text, $1) > 0.7
          ORDER BY similarity DESC LIMIT 5`,
        [row.text, id],
      ),
      pool.query<{ action: string; actor: string; note: string | null; version: number; created_at: Date }>(
        `SELECT action, actor, note, version, created_at FROM question_history
          WHERE question_id = $1 ORDER BY id DESC LIMIT 50`,
        [id],
      ),
      pool.query<{ id: string; name: string }>(`SELECT id, name FROM admin_users WHERE id = ANY($1)`, [
        [row.author_id, row.reviewed_by].filter(Boolean),
      ]),
    ]);
    const names = new Map(people.rows.map((p) => [p.id, p.name]));
    const actorNames = await this.names(history.rows.map((h) => h.actor));
    const s = stats.rows[0];
    const input = inputOf(row);
    return {
      ...input,
      id: row.id,
      external_ref: row.external_ref,
      status: row.status,
      version: row.version,
      author: row.author_id ? (names.get(row.author_id) ?? row.author_id) : null,
      author_id: row.author_id,
      reviewed_by: row.reviewed_by ? (names.get(row.reviewed_by) ?? row.reviewed_by) : null,
      d_rating: row.d_rating,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      stats: {
        plays: Number(s?.plays ?? 0),
        correct: Number(s?.correct ?? 0),
        avg_elapsed_ms: s?.avg_elapsed_ms ?? null,
        option_counts: (s?.option_counts ?? []).slice(0, row.options.length),
      },
      open_reports: reports.rows[0]?.n ?? 0,
      checks: checkQuestion(draftOf(input), { forReview: true }),
      similar: similar.rows.map((r) => ({ ...r, similarity: Math.round(r.similarity * 100) / 100 })),
      allowed_actions: allowedActions(actor, row),
      can_edit: canEdit(actor, row),
      history: history.rows.map((h) => ({
        action: h.action,
        actor: actorNames.get(h.actor) ?? h.actor,
        note: h.note,
        version: h.version,
        at: h.created_at.toISOString(),
      })),
    };
  }

  private async names(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((id) => id !== 'system');
    const rows = await this.deps.pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM admin_users WHERE id = ANY($1)',
      [unique],
    );
    return new Map([['system', 'System'], ...rows.rows.map((r) => [r.id, r.name] as [string, string])]);
  }

  async create(input: AdminQuestionInput, actor: Actor, ip: string | null): Promise<string> {
    if (!actor.permissions.includes('content.write'))
      throw notAllowed("Your roles don't include content.write.");
    assertStorable(input);
    const now = this.deps.now();
    const id = newId('q', now);
    await withTransaction(this.deps.pool, async (client) => {
      await client.query(
        `INSERT INTO questions (id, category_id, subcategory, type, text, options, correct_index, numeric_answer,
           fact, difficulty, d_rating, family_safe, region_tag, valid_until, source_url, status, author_id,
           created_at, updated_at, trending)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16, $17, $17, $18)`,
        [
          id,
          input.category_id,
          input.subcategory,
          input.type,
          input.text,
          JSON.stringify(input.options),
          input.type === 'closest_number' ? null : input.correct_index,
          input.type === 'closest_number' ? input.numeric_answer : null,
          input.fact,
          input.difficulty,
          initialItemRating(input.difficulty as DifficultyLevel),
          input.family_safe,
          input.region_tag,
          input.valid_until,
          input.source_url,
          actor.id,
          new Date(now),
          input.trending,
        ],
      );
      await addHistory(client, { questionId: id, action: 'created', actor: actor.id, version: 1, at: now });
      await writeAudit(client, {
        actor: actor.id,
        action: 'create_question',
        entity: 'question',
        entityId: id,
        after: input,
        ip,
      });
    });
    return id;
  }

  /** Saves an edit as a new version; the content before it stays in the history. */
  async update(id: string, input: AdminQuestionInput, actor: Actor, ip: string | null): Promise<void> {
    assertStorable(input);
    const now = this.deps.now();
    await withTransaction(this.deps.pool, async (client) => {
      const row = await loadQuestionRow(client, id, true);
      if (!row || !canSee(actor, row)) throw notFound('There is no question with this id.');
      if (!canEdit(actor, row)) {
        throw notAllowed(
          row.status === 'retired'
            ? 'A retired question cannot be edited. Reopen it first.'
            : 'Only an editor can change a question once it is approved.',
        );
      }
      const before = inputOf(row);
      if (JSON.stringify(before) === JSON.stringify(input)) return;
      const answerChanged =
        before.type !== input.type ||
        JSON.stringify(before.options) !== JSON.stringify(input.options) ||
        before.correct_index !== input.correct_index ||
        before.numeric_answer !== input.numeric_answer;
      // Until real plays calibrate it, the item rating follows the writer's difficulty.
      const unplayed = row.status === 'draft' || row.status === 'in_review' || row.status === 'approved';
      // A played question given a different right answer among the same options: its games from
      // the last 14 days are re-scored (step 2.6b-2). New options can't be matched to old picks.
      const corrected =
        !unplayed &&
        input.type === before.type &&
        input.type !== 'closest_number' &&
        JSON.stringify(input.options) === JSON.stringify(before.options) &&
        input.correct_index !== before.correct_index &&
        before.correct_index !== null &&
        input.correct_index !== null;
      const version = row.version + 1;
      await client.query(
        `UPDATE questions SET category_id = $2, subcategory = $3, type = $4, text = $5, options = $6::jsonb,
                correct_index = $7, numeric_answer = $8, fact = $9, difficulty = $10, d_rating = $11,
                family_safe = $12, region_tag = $13, valid_until = $14, source_url = $15, version = $16,
                updated_at = $17, trending = $18
          WHERE id = $1`,
        [
          id,
          input.category_id,
          input.subcategory,
          input.type,
          input.text,
          JSON.stringify(input.options),
          input.type === 'closest_number' ? null : input.correct_index,
          input.type === 'closest_number' ? input.numeric_answer : null,
          input.fact,
          input.difficulty,
          unplayed ? initialItemRating(input.difficulty as DifficultyLevel) : row.d_rating,
          input.family_safe,
          input.region_tag,
          // A live question marked trending gets its 90 days from now (step 2.6b-3).
          input.trending && row.status === 'live'
            ? trendingValidUntil(input.valid_until, watDate(now))
            : input.valid_until,
          input.source_url,
          version,
          new Date(now),
          input.trending,
        ],
      );
      if (corrected) {
        await client.query(
          `INSERT INTO question_corrections (question_id, version, old_index, new_index, corrected_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, version, before.correct_index, input.correct_index, actor.id, new Date(now)],
        );
      }
      await addHistory(client, {
        questionId: id,
        action: 'edited',
        actor: actor.id,
        version,
        note: corrected
          ? 'The answer changed: games from the last 14 days are being re-scored.'
          : answerChanged && row.status !== 'draft' && row.status !== 'in_review'
            ? 'The answer changed.'
            : null,
        snapshot: before,
        at: now,
      });
      await writeAudit(client, {
        actor: actor.id,
        action: 'edit_question',
        entity: 'question',
        entityId: id,
        before,
        after: input,
        ip,
      });
    });
  }

  async act(
    id: string,
    action: QuestionAction,
    note: string | undefined,
    actor: Actor,
    ip: string | null,
  ): Promise<void> {
    const now = this.deps.now();
    await withTransaction(this.deps.pool, async (client) => {
      const row = await loadQuestionRow(client, id, true);
      if (!row || !canSee(actor, row)) throw notFound('There is no question with this id.');
      const refused = refusal(actor, row, action);
      if (refused === 'not_allowed') throw notAllowed(`Your roles don't let you mark it ${DONE[action]}.`);
      if (refused === 'own_question') {
        throw notAllowed('Someone else has to fact-check your question.');
      }
      if (refused === 'wrong_status') {
        throw new ApiError(
          409,
          ErrorCode.conflict,
          'Not possible now',
          `This question is ${row.status.replace('_', ' ')}, so it can't be ${DONE[action]}.`,
        );
      }
      if (action === 'send_back' && !note) {
        throw new ApiError(400, ErrorCode.validation, 'Add a note', 'Say what needs fixing.');
      }
      if (CHECKED_ACTIONS.includes(action)) {
        const { errors } = checkQuestion(draftOf(inputOf(row)), { forReview: true });
        if (errors.length > 0) {
          throw new ApiError(409, ErrorCode.conflict, 'Fix the question first', errors.join(' '));
        }
      }
      await this.move(client, row, TRANSITIONS[action].to, action, actor.id, note ?? null, now);
      if (action === 'approve') {
        await client.query('UPDATE questions SET reviewed_by = $2 WHERE id = $1', [id, actor.id]);
      }
      await writeAudit(client, {
        actor: actor.id,
        action: `question_${action}`,
        entity: 'question',
        entityId: id,
        reason: note ?? null,
        before: { status: row.status },
        after: { status: TRANSITIONS[action].to },
        ip,
      });
    });
  }

  /** Approved questions go live together: the ones still approved and passing every check. */
  async publishMany(
    ids: readonly string[],
    actor: Actor,
    ip: string | null,
  ): Promise<AdminBulkPublishResponse> {
    if (!actor.permissions.includes('content.publish'))
      throw notAllowed("Your roles don't include content.publish.");
    const now = this.deps.now();
    const skipped: string[] = [];
    let published = 0;
    await withTransaction(this.deps.pool, async (client) => {
      for (const id of new Set(ids)) {
        const row = await loadQuestionRow(client, id, true);
        if (
          !row ||
          row.status !== 'approved' ||
          checkQuestion(draftOf(inputOf(row)), { forReview: true }).errors.length > 0
        ) {
          skipped.push(id);
          continue;
        }
        await this.move(client, row, 'live', 'publish', actor.id, null, now);
        published++;
      }
      await writeAudit(client, {
        actor: actor.id,
        action: 'question_publish_many',
        entity: 'question',
        after: { published, skipped },
        ip,
      });
    });
    return { published, skipped };
  }

  private async move(
    client: PoolClient,
    row: QuestionRow,
    to: QuestionStatus,
    action: string,
    actor: string,
    note: string | null,
    now: number,
  ): Promise<void> {
    await client.query('UPDATE questions SET status = $2, updated_at = $3 WHERE id = $1', [
      row.id,
      to,
      new Date(now),
    ]);
    // A trending question goes live for 90 days at most (GDD §6.2).
    if (to === 'live' && row.trending) {
      await client.query('UPDATE questions SET valid_until = $2 WHERE id = $1', [
        row.id,
        trendingValidUntil(row.valid_until, watDate(now)),
      ]);
    }
    await addHistory(client, { questionId: row.id, action, actor, note, version: row.version, at: now });
  }

  /** Another 90 days in the game for a trending question, from today (step 2.6b-3). */
  async renew(id: string, actor: Actor, ip: string | null): Promise<void> {
    if (!actor.permissions.includes('content.publish'))
      throw notAllowed("Your roles don't include content.publish.");
    const now = this.deps.now();
    await withTransaction(this.deps.pool, async (client) => {
      const row = await loadQuestionRow(client, id, true);
      if (!row || !canSee(actor, row)) throw notFound('There is no question with this id.');
      if (!row.trending || !['approved', 'live', 'suspended'].includes(row.status)) {
        throw new ApiError(
          409,
          ErrorCode.conflict,
          'Not possible now',
          row.trending
            ? `This question is ${row.status.replace('_', ' ')}: reopen it first.`
            : 'Only trending questions are renewed. Mark it trending first.',
        );
      }
      const until = addDays(watDate(now), TRENDING_DAYS);
      await client.query('UPDATE questions SET valid_until = $2, updated_at = $3 WHERE id = $1', [
        id,
        until,
        new Date(now),
      ]);
      await addHistory(client, {
        questionId: id,
        action: 'renewed',
        actor: actor.id,
        note: `In the game until ${until}.`,
        version: row.version,
        at: now,
      });
      await writeAudit(client, {
        actor: actor.id,
        action: 'question_renew',
        entity: 'question',
        entityId: id,
        before: { valid_until: row.valid_until },
        after: { valid_until: until },
        ip,
      });
    });
  }
}

function encodeCursor(atMs: number, id: string): string {
  return Buffer.from(`${atMs}:${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  const [at, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
  const ms = Number(at);
  return Number.isFinite(ms) && rest.length > 0 ? { at: ms, id: rest.join(':') } : null;
}
