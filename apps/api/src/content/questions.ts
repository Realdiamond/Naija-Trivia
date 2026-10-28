import type { Category, QuestionType } from '@whosabi/shared-types';
import type { Pool } from '../db';

export interface QuestionRow {
  id: string;
  category_id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correct_index: number;
  fact: string | null;
  difficulty: number;
  /** The calibrated item rating (GDD §6.3). */
  d_rating: number;
}

const QUESTION_COLUMNS = 'id, category_id, type, text, options, correct_index, fact, difficulty, d_rating';

/** The first-run taste test: one live, family-safe question each from Slang, Food and Music (PRD US-1). */
export const TASTE_TEST_CATEGORIES = ['slang', 'food', 'music'] as const;

export async function pickTasteTestQuestions(pool: Pool, today: string): Promise<QuestionRow[]> {
  const picked: QuestionRow[] = [];
  for (const category of TASTE_TEST_CATEGORIES) {
    const result = await pool.query<QuestionRow>(
      `SELECT ${QUESTION_COLUMNS}
         FROM questions
        WHERE status = 'live' AND category_id = $1 AND family_safe
          AND type IN ('mcq4', 'true_false')
          AND (valid_until IS NULL OR valid_until >= $2::date)
        ORDER BY (difficulty <= 2) DESC, random()
        LIMIT 1`,
      [category, today],
    );
    if (result.rows[0]) picked.push(result.rows[0]);
  }
  return picked;
}

export async function loadQuestion(pool: Pool, id: string): Promise<QuestionRow | null> {
  const result = await pool.query<QuestionRow>(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = $1`, [
    id,
  ]);
  return result.rows[0] ?? null;
}

export async function listCategories(pool: Pool): Promise<Category[]> {
  const result = await pool.query<Category>(
    'SELECT id, name_en, name_pcm, emoji, color_hex FROM categories WHERE active ORDER BY sort_order',
  );
  return result.rows;
}
