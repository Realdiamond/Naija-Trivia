/**
 * Import questions from the seed CSV (format: docs/content/seed-questions.csv), mirroring
 * docs/content/csv_to_sql.py. New questions are drafts; they go live through the CMS
 * review workflow. `live: true` is for local development and tests only.
 *
 * Closest-number questions (duel tie-breaks) leave the options empty and put the number
 * in `correct_option`.
 */
import { parse as parseCsv } from 'csv-parse/sync';
import type { Pool } from './db';

const LETTERS = ['a', 'b', 'c', 'd'] as const;

interface CsvRow {
  id: string;
  category: string;
  subcategory: string;
  type: string;
  difficulty: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  fact: string;
  family_safe: string;
  valid_until: string;
  region_tag: string;
}

export interface SeedResult {
  inserted: number;
  skipped: number;
}

export async function seedQuestions(
  pool: Pool,
  csvText: string,
  options: { live?: boolean } = {},
): Promise<SeedResult> {
  const rows = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: false }) as CsvRow[];
  let inserted = 0;
  for (const row of rows) {
    const opts = LETTERS.map((l) => row[`option_${l}`]).filter((o): o is string => Boolean(o));
    let correctIndex: number | null = null;
    let numericAnswer: number | null = null;
    if (row.type === 'closest_number') {
      numericAnswer = Number(row.correct_option.trim());
      if (opts.length > 0 || row.correct_option.trim() === '' || !Number.isFinite(numericAnswer))
        throw new Error(
          `${row.id}: a closest_number question needs no options and a number as correct_option`,
        );
    } else {
      correctIndex = LETTERS.indexOf(row.correct_option.trim().toLowerCase() as (typeof LETTERS)[number]);
      if (correctIndex < 0 || correctIndex >= opts.length)
        throw new Error(`${row.id}: correct_option out of range`);
    }
    if (row.question.length > 160) throw new Error(`${row.id}: question longer than 160 characters`);
    const difficulty = Number(row.difficulty);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5)
      throw new Error(`${row.id}: bad difficulty`);

    const result = await pool.query(
      `INSERT INTO questions (id, external_ref, category_id, subcategory, type, text, options, correct_index, fact,
         difficulty, d_rating, family_safe, region_tag, valid_until, status, numeric_answer)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (external_ref) DO NOTHING`,
      [
        `q_${row.id.toLowerCase()}`,
        row.id,
        row.category,
        row.subcategory || null,
        row.type,
        row.question,
        JSON.stringify(opts),
        correctIndex,
        row.fact || null,
        difficulty,
        1050 + 150 * difficulty,
        row.family_safe === 'true',
        row.region_tag || null,
        row.valid_until || null,
        options.live ? 'live' : 'draft',
        numericAnswer,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return { inserted, skipped: rows.length - inserted };
}
