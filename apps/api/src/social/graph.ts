/**
 * Who is connected to whom (TRD FR-SOC-1). `friendships` keeps one row per pair, ordered by
 * the database (LEAST/GREATEST, so the order always matches its CHECK): pending, accepted or
 * blocked, with `requested_by` being the asker or the blocker.
 */
import type { Pool, PoolClient } from '../db';

type Db = Pool | PoolClient;

export interface PairRow {
  status: 'pending' | 'accepted' | 'blocked';
  requested_by: string;
  source: string | null;
  created_at: Date;
  updated_at: Date | null;
}

export async function pairOf(db: Db, a: string, b: string): Promise<PairRow | null> {
  const result = await db.query<PairRow>(
    `SELECT status, requested_by, source, created_at, updated_at FROM friendships
      WHERE user_a = LEAST($1::text, $2::text) AND user_b = GREATEST($1::text, $2::text)`,
    [a, b],
  );
  return result.rows[0] ?? null;
}

export type ChallengeCheck = 'ok' | 'blocked' | 'not_connected';

/**
 * A direct challenge needs friends or past opponents, and nobody blocked (build plan 1.2b).
 * Anyone else is reached through an invite link.
 */
export async function canChallenge(db: Db, from: string, to: string): Promise<ChallengeCheck> {
  const pair = await pairOf(db, from, to);
  if (pair?.status === 'blocked') return 'blocked';
  if (pair?.status === 'accepted') return 'ok';
  const played = await db.query(
    `SELECT 1 FROM duels
      WHERE (player_a = $1 AND player_b = $2) OR (player_a = $2 AND player_b = $1) LIMIT 1`,
    [from, to],
  );
  return played.rowCount ? 'ok' : 'not_connected';
}

export async function isBlocked(db: Db, a: string, b: string): Promise<boolean> {
  return (await pairOf(db, a, b))?.status === 'blocked';
}
