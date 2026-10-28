/**
 * Finished party games (doc 08: `party_games`, `party_results`). Only results are kept, not each
 * answer: those go to analytics. Signed-in players get their XP (GDD §5.1).
 */
import { levelForXp, partyXp } from '@whosabi/game-rules';
import type { PartyGameResult, PartyMvp, PartySeatKind } from '@whosabi/shared-types';
import { withTransaction, type Pool } from '../db';
import type { FinishedGame } from './room';

export async function saveGame(pool: Pool, game: FinishedGame): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO party_games (id, room_code, host_user_id, settings, player_count, started_at, ended_at,
                                questions, mvp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        game.gameId,
        game.roomCode,
        game.hostUserId,
        JSON.stringify(game.settings),
        game.ranking.length,
        new Date(game.startedAt),
        new Date(game.endedAt),
        game.questions,
        game.mvp ? JSON.stringify(game.mvp) : null,
      ],
    );
    for (const p of game.ranking) {
      await client.query(
        `INSERT INTO party_results (game_id, player_ref, user_id, rank, score, correct_count, name, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [game.gameId, p.id, p.userId, p.rank, p.score, p.correct, p.name, p.kind],
      );
    }
    // In id order, so two games ending together never wait on each other.
    const players = game.ranking.filter((p) => p.userId).sort((a, b) => a.userId!.localeCompare(b.userId!));
    for (const p of players) {
      const user = (
        await client.query<{ xp: string }>(
          "SELECT xp FROM users WHERE id = $1 AND status IN ('guest', 'active', 'restricted') FOR UPDATE",
          [p.userId],
        )
      ).rows[0];
      if (!user) continue;
      const xp = Number(user.xp) + partyXp(p.correct, p.answered);
      await client.query('UPDATE users SET xp = $2, level = $3, updated_at = $4 WHERE id = $1', [
        p.userId,
        xp,
        levelForXp(xp).level,
        new Date(game.endedAt),
      ]);
    }
  });
}

/**
 * A finished game, for its share card and results link. A deleted player shows as "Deleted
 * player", and a 13–17 player's name is left out, as on public boards (doc 10 §3.3).
 */
export async function getGame(pool: Pool, gameId: string): Promise<PartyGameResult | null> {
  const game = (
    await pool.query<{
      id: string;
      room_code: string;
      ended_at: Date;
      questions: number;
      mvp: PartyMvp | null;
    }>('SELECT id, room_code, ended_at, questions, mvp FROM party_games WHERE id = $1', [gameId])
  ).rows[0];
  if (!game) return null;
  const rows = (
    await pool.query<{
      player_ref: string;
      rank: number;
      name: string;
      kind: PartySeatKind;
      score: number;
      correct_count: number;
      status: string | null;
      age_band: string | null;
    }>(
      `SELECT r.player_ref, r.rank, r.name, r.kind, r.score, r.correct_count, u.status, u.age_band
         FROM party_results r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.game_id = $1 ORDER BY r.rank, r.name`,
      [gameId],
    )
  ).rows;
  const shown = new Map(rows.map((r) => [r.player_ref, shownName(r)]));
  return {
    game_id: game.id,
    room_code: game.room_code,
    ended_at: game.ended_at.toISOString(),
    questions: game.questions,
    ranking: rows.map((r) => ({
      rank: r.rank,
      name: shown.get(r.player_ref)!,
      kind: r.kind,
      score: r.score,
      correct: r.correct_count,
    })),
    mvp: game.mvp ? { ...game.mvp, name: shown.get(game.mvp.id) ?? game.mvp.name } : null,
  };
}

function shownName(r: { name: string; status: string | null; age_band: string | null }): string {
  if (r.status === 'deleted') return 'Deleted player';
  if (r.age_band === '13_17') return 'A player';
  return r.name;
}
