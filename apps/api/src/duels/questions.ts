/**
 * Questions for duel rounds (GDD §3.2–3.3, TRD FR-CON-2). Both players get the same three:
 * one easy, one medium and one near their combined rating, preferring questions neither
 * has seen in the last 30 days. While the pool is small, seen questions are used rather
 * than leaving a round short; the seen-history table is the TRD's fallback store until the
 * per-player Redis filters land.
 */
import { DEFAULT_CONFIG, NEW_PLAYER_RATING, watDate } from '@whosabi/game-rules';
import type { QuestionType } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';

type Db = Pool | PoolClient;

export interface DuelQuestion {
  id: string;
  category_id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correct_index: number | null;
  numeric_answer: number | null;
  fact: string | null;
  difficulty: number;
  /** The calibrated item rating (GDD §6.3). */
  d_rating: number;
}

export interface PickContext {
  players: readonly string[];
  /** Only family-safe questions (restricted mode for 13–17s, GDD §8). */
  familySafeOnly: boolean;
  /** Questions already used in this duel. */
  exclude: readonly string[];
  now: number;
}

const DAY_MS = 86_400_000;

export async function loadQuestions(db: Db, ids: readonly string[]): Promise<Map<string, DuelQuestion>> {
  if (ids.length === 0) return new Map();
  const result = await db.query<DuelQuestion & { numeric_answer: string | null }>(
    `SELECT id, category_id, type, text, options, correct_index, numeric_answer, fact, difficulty, d_rating
       FROM questions WHERE id = ANY($1)`,
    [ids],
  );
  return new Map(
    result.rows.map((q) => [
      q.id,
      { ...q, numeric_answer: q.numeric_answer === null ? null : Number(q.numeric_answer) },
    ]),
  );
}

/** Average overall rating of the players (new players count as 1500). */
export async function combinedRating(db: Db, players: readonly string[]): Promise<number> {
  const result = await db.query<{ rating: number }>(
    "SELECT rating FROM ratings WHERE scope = 'overall' AND user_id = ANY($1)",
    [players],
  );
  const known = result.rows.map((r) => r.rating);
  const missing = players.length - known.length;
  return (known.reduce((sum, r) => sum + r, 0) + missing * NEW_PLAYER_RATING.rating) / players.length;
}

/** The three questions for a round in `categoryId`; fewer only when the category runs dry. */
export async function pickRoundQuestions(
  db: Db,
  categoryId: string,
  context: PickContext,
): Promise<string[]> {
  const target = await combinedRating(db, context.players);
  // Easy (levels 1–2), medium (level 3), then the one nearest the players' combined rating.
  const slots: Array<{ order: string; params: unknown[] }> = [
    { order: 'q.difficulty > 2', params: [] },
    { order: 'q.difficulty <> 3', params: [] },
    // Weighted randomness: up to 150 rating points of noise around the target.
    { order: 'abs(q.d_rating - $7) + random() * 150', params: [target] },
  ];
  const picked: string[] = [];
  for (const slot of slots) {
    const result = await db.query<{ id: string }>(
      `SELECT q.id FROM questions q
        WHERE q.status = 'live' AND q.category_id = $1 AND q.type IN ('mcq4', 'true_false')
          AND (q.valid_until IS NULL OR q.valid_until >= $2::date)
          AND (q.family_safe OR NOT $3)
          AND NOT (q.id = ANY($4::text[]))
        ORDER BY EXISTS (SELECT 1 FROM user_question_seen s
                          WHERE s.question_id = q.id AND s.user_id = ANY($5::text[]) AND s.seen_at > $6),
                 ${slot.order}, random()
        LIMIT 1`,
      [
        categoryId,
        watDate(context.now),
        context.familySafeOnly,
        [...context.exclude, ...picked],
        context.players,
        seenSince(context.now),
        ...slot.params,
      ],
    );
    if (result.rows[0]) picked.push(result.rows[0].id);
  }
  return picked;
}

/** One closest-number question for the tie-break, from any category; null if there is none. */
export async function pickTiebreakQuestion(db: Db, context: PickContext): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT q.id FROM questions q
      WHERE q.status = 'live' AND q.type = 'closest_number'
        AND (q.valid_until IS NULL OR q.valid_until >= $1::date)
        AND (q.family_safe OR NOT $2)
        AND NOT (q.id = ANY($3::text[]))
      ORDER BY EXISTS (SELECT 1 FROM user_question_seen s
                        WHERE s.question_id = q.id AND s.user_id = ANY($4::text[]) AND s.seen_at > $5),
               random()
      LIMIT 1`,
    [watDate(context.now), context.familySafeOnly, context.exclude, context.players, seenSince(context.now)],
  );
  return result.rows[0]?.id ?? null;
}

/** Record that a player saw a question, for the 30-day no-repeat rule. */
export async function markSeen(db: Db, userId: string, questionId: string, now: number): Promise<void> {
  await db.query(
    `INSERT INTO user_question_seen (user_id, question_id, seen_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, question_id) DO UPDATE SET seen_at = EXCLUDED.seen_at`,
    [userId, questionId, new Date(now)],
  );
}

function seenSince(now: number): Date {
  return new Date(now - DEFAULT_CONFIG['content.repeat_window_days'] * DAY_MS);
}
