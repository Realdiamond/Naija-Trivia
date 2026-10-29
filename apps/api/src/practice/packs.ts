/**
 * Which questions a pack holds (build plan step 2.8f): the ones chosen for it, and every live
 * question in its category when it has one. Players only get live multiple-choice and true/false
 * questions in active categories that haven't expired, family-safe ones in family mode, and never
 * a question in today's Daily or one already planned (Practice sends the answers with the set).
 */
import { PRACTICE_MIN_QUESTIONS, PRACTICE_SET_SIZE, watDate } from '@whosabi/game-rules';
import type { PackAccess, PackSummary } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';

type Db = Pool | PoolClient;

/**
 * The questions pack `p` holds for a player. Parameters: $1 today (WAT date), $2 family-safe only,
 * $3 the Daily's question ids from today on.
 */
export const PACK_QUESTION = `q.status = 'live' AND q.type IN ('mcq4', 'true_false')
  AND (q.valid_until IS NULL OR q.valid_until >= $1::date)
  AND (q.family_safe OR NOT $2)
  AND NOT (q.id = ANY($3::text[]))
  AND EXISTS (SELECT 1 FROM categories c WHERE c.id = q.category_id AND c.active)
  AND (q.category_id = p.category_id
       OR EXISTS (SELECT 1 FROM pack_questions pq WHERE pq.pack_id = p.id AND pq.question_id = q.id))`;

/** Questions in a Daily from `today` on: never in a practice set. */
export async function upcomingDailyQuestions(db: Db, today: string): Promise<string[]> {
  const row = await db.query<{ ids: string[] }>(
    `SELECT coalesce(array_agg(DISTINCT qid), '{}') AS ids
       FROM daily_challenges dc, unnest(dc.question_ids) AS qid WHERE dc.play_date >= $1::date`,
    [today],
  );
  return row.rows[0]!.ids;
}

export interface PackRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category_id: string | null;
  access: PackAccess;
  price_coins: number | null;
  ends_at: Date | null;
  unlocked: boolean;
  questions: number;
}

/**
 * The packs a player can see now: active, open, in an active category if a core pack, and with
 * enough questions for them. Ones ending soon first, then curated packs, then the core ones.
 */
export async function visiblePacks(db: Db, userId: string, now: number, only?: string): Promise<PackRow[]> {
  const today = watDate(now);
  const family = (
    await db.query<{ family_mode: boolean }>('SELECT family_mode FROM users WHERE id = $1', [userId])
  ).rows[0]?.family_mode;
  const result = await db.query<PackRow>(
    `SELECT p.id, p.slug, p.title, p.description, coalesce(p.category_id, top.category_id) AS category_id,
            p.access, p.price_coins, p.ends_at,
            (p.access IN ('free', 'sponsored') OR u.pack_id IS NOT NULL) AS unlocked,
            least(n.questions, ${PRACTICE_SET_SIZE}) AS questions
       FROM packs p
       LEFT JOIN categories pc ON pc.id = p.category_id
       LEFT JOIN pack_unlocks u ON u.pack_id = p.id AND u.user_id = $4
       CROSS JOIN LATERAL (SELECT count(*)::int AS questions FROM questions q WHERE ${PACK_QUESTION}) n
       LEFT JOIN LATERAL (
         SELECT q.category_id FROM pack_questions pq JOIN questions q ON q.id = pq.question_id
          WHERE pq.pack_id = p.id GROUP BY q.category_id ORDER BY count(*) DESC, q.category_id LIMIT 1
       ) top ON p.category_id IS NULL
      WHERE p.active AND (p.starts_at IS NULL OR p.starts_at <= $5) AND (p.ends_at IS NULL OR p.ends_at > $5)
        AND (p.category_id IS NULL OR pc.active)
        AND n.questions >= ${PRACTICE_MIN_QUESTIONS}
        AND ($6::text IS NULL OR p.id = $6)
      ORDER BY p.ends_at NULLS LAST, p.category_id IS NOT NULL, pc.sort_order, p.created_at DESC, p.id`,
    [today, family ?? true, await upcomingDailyQuestions(db, today), userId, new Date(now), only ?? null],
  );
  return result.rows;
}

export const packSummary = (p: PackRow): PackSummary => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  category_id: p.category_id,
  access: p.access,
  price_coins: p.price_coins,
  unlocked: p.unlocked,
  questions: p.questions,
  ends_at: p.ends_at?.toISOString() ?? null,
});
