/**
 * Questions for a party game (GDD §2.2, §3.2): spread across the packs the host picked, taking
 * questions none of the signed-in players has seen in 30 days first. With the Wahala Round on,
 * the last 3 are the hardest on offer (levels 4–5 first).
 */
import { DEFAULT_CONFIG, isWahala, WAHALA_QUESTIONS, watDate } from '@whosabi/game-rules';
import type { PartySettings } from '@whosabi/shared-types';
import type { Pool } from '../db';
import type { PartyQuestion } from './room';

const DAY_MS = 86_400_000;

export async function pickPartyQuestions(
  db: Pool,
  settings: PartySettings,
  userIds: readonly string[],
  now: number,
): Promise<PartyQuestion[]> {
  const total = settings.questions;
  const hard = isWahala(total - 1, total, settings.wahala) ? WAHALA_QUESTIONS : 0;
  // A player in family mode (13–17s, GDD §8) keeps the whole room family-safe.
  const familySafe =
    settings.family_safe ||
    (userIds.length > 0 &&
      (await db.query('SELECT 1 FROM users WHERE id = ANY($1) AND family_mode LIMIT 1', [userIds])).rows
        .length > 0);
  const params = [
    settings.categories,
    watDate(now),
    familySafe,
    userIds,
    new Date(now - DEFAULT_CONFIG['content.repeat_window_days'] * DAY_MS),
  ];
  const where = `q.status = 'live' AND q.category_id = ANY($1::text[]) AND q.type IN ('mcq4', 'true_false')
    AND (q.valid_until IS NULL OR q.valid_until >= $2::date) AND (q.family_safe OR NOT $3)
    AND EXISTS (SELECT 1 FROM categories c WHERE c.id = q.category_id AND c.active)`;
  const seen = `EXISTS (SELECT 1 FROM user_question_seen s
                 WHERE s.question_id = q.id AND s.user_id = ANY($4::text[]) AND s.seen_at > $5)`;
  const columns =
    'q.id, q.category_id, q.type, q.text, q.options, q.correct_index, q.fact, q.difficulty, q.d_rating';

  // Each pack in turn, unseen questions first within each.
  const regular = (
    await db.query<PartyQuestion>(
      `SELECT ${columns.replaceAll('q.', 'x.')} FROM (
         SELECT ${columns}, row_number() OVER (PARTITION BY q.category_id ORDER BY ${seen}, random()) AS turn
           FROM questions q WHERE ${where}
       ) x ORDER BY x.turn, random() LIMIT $6`,
      [...params, total - hard],
    )
  ).rows;
  if (hard === 0) return regular;
  const wahala = (
    await db.query<PartyQuestion>(
      `SELECT ${columns} FROM questions q
        WHERE ${where} AND NOT (q.id = ANY($6::text[]))
        ORDER BY ${seen}, q.difficulty >= 4 DESC, random() LIMIT ${WAHALA_QUESTIONS}`,
      [...params, regular.map((q) => q.id)],
    )
  ).rows;
  // Easiest of the three first, so the round builds.
  return [...regular, ...wahala.sort((a, b) => a.d_rating - b.d_rating)];
}
