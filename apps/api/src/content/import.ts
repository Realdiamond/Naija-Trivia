/**
 * CSV import (FR-CON-6): the seed format (docs/content/seed-questions.csv), or a question-bank
 * category file with its source and review columns (docs/content/question-bank/). Every row is
 * checked against the Question Bible; a row with an error is left out and listed.
 *
 * Rows the team approved in the question bank arrive approved (or live, if the editor says so),
 * rejected rows are skipped, and the rest arrive in review for a fact-checker in the console.
 * Rows already imported (same id) and copies of an existing question are skipped. Imported
 * questions have no writer in the console, so whoever imports them may fact-check them; the
 * history says who imported each one.
 */
import { parse as parseCsv } from 'csv-parse/sync';
import {
  checkQuestion,
  initialItemRating,
  normaliseQuestionText,
  type DifficultyLevel,
} from '@whosabi/game-rules';
import {
  CategoryId,
  ErrorCode,
  type AdminImportResponse,
  type AdminQuestionInput,
  type QuestionStatus,
} from '@whosabi/shared-types';
import { writeAudit } from '../admin/audit';
import { withTransaction, type Pool } from '../db';
import { ApiError } from '../errors';
import { addHistory, draftOf } from './bank';

const REQUIRED = [
  'id',
  'category',
  'type',
  'difficulty',
  'question',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'correct_option',
  'fact',
  'family_safe',
  'valid_until',
  'region_tag',
] as const;
const LETTERS = ['a', 'b', 'c', 'd'] as const;

type CsvRow = Partial<Record<string, string>>;

interface Planned {
  line: number;
  ref: string;
  input: AdminQuestionInput;
  status: QuestionStatus;
  reviewer: string | null;
  note: string | null;
}

export interface ImportOptions {
  dryRun: boolean;
  publishApproved: boolean;
  actor: string;
  ip: string | null;
  now: number;
}

function invalidFile(detail: string): ApiError {
  return new ApiError(400, ErrorCode.validation, 'This file cannot be imported', detail);
}

/** One CSV row as the editor's input, or the reason it can't be one. */
function toInput(row: CsvRow): AdminQuestionInput | string {
  const value = (key: string) => (row[key] ?? '').trim();
  const category = CategoryId.safeParse(value('category'));
  if (!category.success) return `"${value('category')}" is not a category.`;
  const type = value('type');
  if (type !== 'mcq4' && type !== 'true_false' && type !== 'closest_number')
    return `"${type}" is not a question type the console imports (mcq4, true_false, closest_number).`;
  const difficulty = Number(value('difficulty'));
  const familySafe = value('family_safe').toLowerCase();
  if (familySafe !== 'true' && familySafe !== 'false') return 'family_safe must be true or false.';
  const letters = type === 'true_false' ? LETTERS.slice(0, 2) : type === 'mcq4' ? LETTERS : [];
  const answer = value('correct_option').toLowerCase();
  const numeric = Number(value('correct_option'));
  const region = value('region_tag');
  return {
    category_id: category.data,
    subcategory: value('subcategory') || null,
    type,
    text: value('question'),
    options: letters.map((l) => value(`option_${l}`)),
    correct_index: type === 'closest_number' ? null : LETTERS.indexOf(answer as (typeof LETTERS)[number]),
    numeric_answer:
      type === 'closest_number' && value('correct_option') !== '' && Number.isFinite(numeric)
        ? numeric
        : null,
    fact: value('fact') || null,
    difficulty: Number.isInteger(difficulty) ? difficulty : 0,
    family_safe: familySafe === 'true',
    region_tag: (region || null) as AdminQuestionInput['region_tag'],
    valid_until: value('valid_until') || null,
    source_url: value('source_url') || null,
  };
}

export async function importQuestions(
  pool: Pool,
  csv: string,
  options: ImportOptions,
): Promise<AdminImportResponse> {
  let rows: CsvRow[];
  try {
    rows = parseCsv(csv, { columns: true, skip_empty_lines: true, bom: true, trim: false }) as CsvRow[];
  } catch (err) {
    throw invalidFile(
      `It is not a readable CSV file (${err instanceof Error ? err.message : 'parse error'}).`,
    );
  }
  if (rows.length === 0) throw invalidFile('It has no rows.');
  const missing = REQUIRED.filter((c) => !(c in rows[0]!));
  if (missing.length > 0) throw invalidFile(`It needs these columns: ${missing.join(', ')}.`);

  const refs = rows.map((r) => (r.id ?? '').trim()).filter(Boolean);
  const existing = new Set(
    (
      await pool.query<{ external_ref: string }>(
        'SELECT external_ref FROM questions WHERE external_ref = ANY($1)',
        [refs],
      )
    ).rows.map((r) => r.external_ref),
  );
  const known = new Map(
    (
      await pool.query<{ id: string; text: string }>(
        "SELECT id, text FROM questions WHERE status <> 'retired'",
      )
    ).rows.map((r) => [normaliseQuestionText(r.text), r.id]),
  );
  const inactive = new Set(
    (await pool.query<{ id: string }>('SELECT id FROM categories WHERE NOT active')).rows.map((r) => r.id),
  );

  const result: AdminImportResponse = {
    dry_run: options.dryRun,
    rows: rows.length,
    created: { draft: 0, in_review: 0, approved: 0, live: 0, suspended: 0, retired: 0 },
    skipped: 0,
    errors: [],
    warnings: [],
  };
  const planned: Planned[] = [];
  const offCategories = new Set<string>();

  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const ref = (row.id ?? '').trim();
    const problem = (message: string) => ({ line, ref: ref || '?', message });
    if (!ref) {
      result.errors.push(problem('The id is empty.'));
      continue;
    }
    if (!/^[A-Za-z0-9-]{3,40}$/.test(ref)) {
      result.errors.push(problem('The id may only use letters, digits and dashes.'));
      continue;
    }
    const review = (row.review_status ?? '').trim().toLowerCase();
    if (existing.has(ref) || review === 'rejected') {
      result.skipped++;
      continue;
    }
    const input = toInput(row);
    if (typeof input === 'string') {
      result.errors.push(problem(input));
      continue;
    }
    const checks = checkQuestion(draftOf(input), { forReview: true });
    if (checks.errors.length > 0) {
      for (const message of checks.errors) result.errors.push(problem(message));
      continue;
    }
    for (const message of checks.warnings) result.warnings.push(problem(message));

    const key = normaliseQuestionText(input.text);
    const copyOf = known.get(key);
    if (copyOf) {
      result.skipped++;
      result.warnings.push(problem(`Skipped: the same question as ${copyOf}.`));
      continue;
    }
    known.set(key, ref);
    const similar = await pool.query<{ id: string; similarity: number }>(
      `SELECT id, similarity(text, $1) AS similarity FROM questions
        WHERE status <> 'retired' AND text % $1 AND similarity(text, $1) > 0.7
        ORDER BY similarity DESC LIMIT 1`,
      [input.text],
    );
    const near = similar.rows[0];
    if (near) {
      result.warnings.push(
        problem(
          `Reads like ${near.id} (${Math.round(near.similarity * 100)}% alike). Check it is not a duplicate.`,
        ),
      );
    }

    const status: QuestionStatus =
      review === 'approved' ? (options.publishApproved ? 'live' : 'approved') : 'in_review';
    if (inactive.has(input.category_id)) offCategories.add(input.category_id);
    const reviewer = (row.reviewer ?? '').trim() || null;
    const notes = (row.review_notes ?? '').trim() || null;
    planned.push({
      line,
      ref,
      input,
      status,
      reviewer,
      note:
        review === 'approved'
          ? `Approved in the question bank${reviewer ? ` by ${reviewer}` : ''}${notes ? `: ${notes}` : ''}`
          : notes,
    });
    result.created[status]++;
  }

  for (const category of offCategories) {
    result.warnings.push({
      line: 0,
      ref: category,
      message: `The ${category} category is switched off, so its questions are not played until it is switched on.`,
    });
  }

  if (!options.dryRun && planned.length > 0) {
    await withTransaction(pool, async (client) => {
      for (const p of planned) {
        const id = `q_${p.ref.toLowerCase()}`;
        const inserted = await client.query(
          `INSERT INTO questions (id, external_ref, category_id, subcategory, type, text, options, correct_index,
             numeric_answer, fact, difficulty, d_rating, family_safe, region_tag, valid_until, source_url, status,
             author_id, reviewed_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20)
           ON CONFLICT DO NOTHING`,
          [
            id,
            p.ref,
            p.input.category_id,
            p.input.subcategory,
            p.input.type,
            p.input.text,
            JSON.stringify(p.input.options),
            p.input.correct_index,
            p.input.numeric_answer,
            p.input.fact,
            p.input.difficulty,
            initialItemRating(p.input.difficulty as DifficultyLevel),
            p.input.family_safe,
            p.input.region_tag,
            p.input.valid_until,
            p.input.source_url,
            p.status,
            // Written in the question bank, not by the person importing: they can still check it.
            null,
            p.status === 'in_review' ? null : p.reviewer,
            new Date(options.now),
          ],
        );
        if (inserted.rowCount === 0) continue;
        await addHistory(client, {
          questionId: id,
          action: p.status === 'live' ? 'imported_live' : 'imported',
          actor: options.actor,
          note: p.note,
          version: 1,
          at: options.now,
        });
      }
      await writeAudit(client, {
        actor: options.actor,
        action: 'import_questions',
        entity: 'question',
        after: {
          rows: result.rows,
          created: result.created,
          skipped: result.skipped,
          errors: result.errors.length,
        },
        ip: options.ip,
      });
    });
  }
  return result;
}
