/**
 * Coins (GDD §5.1): what a duel, the Daily and a new level pay. The amounts come from the
 * remote-config defaults, so they can be tuned later without a release (FR-ECO-5).
 */
import { DEFAULT_CONFIG } from './config';
import { XP_REWARDS } from './progression';

/** How a finished duel ended for one player. A forfeit is the side that let the clock run out. */
export type DuelOutcome = 'win' | 'loss' | 'draw' | 'forfeit';

/** Win +30, lose +10 (a draw pays the same as a loss), and nothing for walking away. */
export function duelCoins(outcome: DuelOutcome): number {
  switch (outcome) {
    case 'win':
      return DEFAULT_CONFIG['econ.win_coins'];
    case 'loss':
    case 'draw':
      return DEFAULT_CONFIG['econ.loss_coins'];
    case 'forfeit':
      return 0;
  }
}

/** The Daily pays 20, plus 5 for each day of the streak after the first, up to 50 (a week). */
export function dailyCoins(streak: number): number {
  const days = Math.max(0, Math.floor(streak) - 1);
  return Math.min(
    DEFAULT_CONFIG['econ.daily_coins_max'],
    DEFAULT_CONFIG['econ.daily_coins'] + days * DEFAULT_CONFIG['econ.daily_streak_coins'],
  );
}

/** +100 for every level reached. */
export function levelUpCoins(fromLevel: number, toLevel: number): number {
  return Math.max(0, toLevel - fromLevel) * DEFAULT_CONFIG['econ.level_up_coins'];
}

/**
 * A duel's XP for one player: +10 a right answer, +2 a wrong one (rounds 1–3; the tie-break is a
 * guess), and +50 for seeing it through. A player who forfeits keeps what their answers earned.
 */
export function duelXp(correct: number, answered: number, finished: boolean): number {
  return (
    correct * XP_REWARDS.correctAnswer +
    (answered - correct) * XP_REWARDS.wrongAnswer +
    (finished ? XP_REWARDS.matchComplete : 0)
  );
}
