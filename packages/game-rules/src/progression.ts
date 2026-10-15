/** XP and levels (GDD §5.1, §5.4). */

export const XP_REWARDS = {
  correctAnswer: 10,
  wrongAnswer: 2,
  matchComplete: 50,
} as const;

/** XP needed to go from `level` to `level + 1`: 200 × level^1.4. */
export function xpToNextLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1)
    throw new RangeError(`level must be an integer ≥ 1, got ${level}`);
  return Math.round(200 * level ** 1.4);
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

export function levelForXp(totalXp: number): LevelProgress {
  if (!Number.isFinite(totalXp) || totalXp < 0) throw new RangeError(`totalXp must be ≥ 0, got ${totalXp}`);
  let level = 1;
  let remaining = Math.floor(totalXp);
  while (remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level);
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: xpToNextLevel(level) };
}
