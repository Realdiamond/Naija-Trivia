/**
 * Overall Glicko-2 ratings after a finished duel (GDD §4.2), with rating gains between the
 * same pair dampened after 3 games in 24 h (doc 10 §2). Category ratings come later.
 */
import {
  dampenPairGain,
  PAIR_WINDOW_MS,
  updateRating,
  type DuelSide,
  type Rating,
} from '@whosabi/game-rules';
import type { PoolClient } from '../db';

export interface RatingDeltas {
  a: number;
  b: number;
}

export async function applyDuelRatings(
  client: PoolClient,
  duel: { id: string; player_a: string; player_b: string },
  winner: DuelSide | null,
  now: number,
): Promise<RatingDeltas> {
  const ids = [duel.player_a, duel.player_b].sort();
  // Create missing rows first so both can be locked, always in id order (no deadlocks).
  await client.query(
    `INSERT INTO ratings (user_id, scope) SELECT unnest($1::text[]), 'overall' ON CONFLICT DO NOTHING`,
    [ids],
  );
  const rows = await client.query<{ user_id: string } & Rating>(
    `SELECT user_id, rating, rd, volatility FROM ratings
      WHERE scope = 'overall' AND user_id = ANY($1) ORDER BY user_id FOR UPDATE`,
    [ids],
  );
  const before = new Map(rows.rows.map((r) => [r.user_id, r]));
  const ratingA = before.get(duel.player_a)!;
  const ratingB = before.get(duel.player_b)!;

  const pairGames = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM duels
      WHERE id <> $3 AND state IN ('complete', 'forfeit') AND completed_at > $4
        AND ((player_a = $1 AND player_b = $2) OR (player_a = $2 AND player_b = $1))`,
    [duel.player_a, duel.player_b, duel.id, new Date(now - PAIR_WINDOW_MS)],
  );
  const pairGamesBefore = pairGames.rows[0]!.n;

  const scoreA = winner === 'a' ? 1 : winner === 'b' ? 0 : 0.5;
  const scoreB = winner === 'b' ? 1 : winner === 'a' ? 0 : 0.5;
  const nextA = updateRating(ratingA, [{ opponent: ratingB, score: scoreA }]);
  const nextB = updateRating(ratingB, [{ opponent: ratingA, score: scoreB }]);
  const deltaA = dampenPairGain(nextA.rating - ratingA.rating, pairGamesBefore);
  const deltaB = dampenPairGain(nextB.rating - ratingB.rating, pairGamesBefore);

  for (const [userId, rating, next, delta] of [
    [duel.player_a, ratingA, nextA, deltaA],
    [duel.player_b, ratingB, nextB, deltaB],
  ] as const) {
    await client.query(
      `UPDATE ratings SET rating = $2, rd = $3, volatility = $4, games = games + 1, updated_at = $5
        WHERE user_id = $1 AND scope = 'overall'`,
      [userId, rating.rating + delta, next.rd, next.volatility, new Date(now)],
    );
  }
  return { a: round1(deltaA), b: round1(deltaB) };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
