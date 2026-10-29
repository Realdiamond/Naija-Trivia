/**
 * What a game pays (GDD §5.1): XP, which moves the player's level, coins, and 100 coins for each
 * level reached. Written in the caller's transaction, with the game's own result.
 */
import { levelForXp, levelUpCoins } from '@whosabi/game-rules';
import type { LedgerReason } from '@whosabi/shared-types';
import type { PoolClient } from '../db';
import { grantCoins, type CoinChange } from './ledger';

export interface RewardInput {
  xp: number;
  coins: number;
  reason: LedgerReason;
  /** Unique to this player and game, e.g. `duel:{id}:{user}`. */
  key: string;
  refType: string;
  refId: string;
  now: number;
}

export interface Reward {
  xp: number;
  coins: number;
  level: number;
  /** Coins moved, the level-up's included, for `coins_changed` once committed. */
  changes: CoinChange[];
}

/**
 * Pays a player for a game. Only guests and players earn: nothing for the Sabi Bot or a deleted
 * account (null). Several players in one transaction should be paid in user id order.
 */
export async function rewardPlayer(
  client: PoolClient,
  userId: string,
  input: RewardInput,
): Promise<Reward | null> {
  const user = (
    await client.query<{ xp: string }>(
      "SELECT xp FROM users WHERE id = $1 AND status IN ('guest', 'active', 'restricted') FOR UPDATE",
      [userId],
    )
  ).rows[0];
  if (!user) return null;
  const before = levelForXp(Number(user.xp)).level;
  const total = Number(user.xp) + input.xp;
  const level = levelForXp(total).level;
  await client.query('UPDATE users SET xp = $2, level = $3, updated_at = $4 WHERE id = $1', [
    userId,
    total,
    level,
    new Date(input.now),
  ]);

  const changes: CoinChange[] = [];
  const posting = { reason: input.reason, refType: input.refType, refId: input.refId, now: input.now };
  const earned = await grantCoins(client, userId, input.coins, { ...posting, key: input.key });
  if (earned) changes.push(earned);
  const bonus = await grantCoins(client, userId, levelUpCoins(before, level), {
    key: `${input.key}:level`,
    reason: 'level_up',
    refType: 'level',
    refId: String(level),
    now: input.now,
  });
  if (bonus) changes.push(bonus);
  return { xp: input.xp, coins: input.coins, level, changes };
}
