/**
 * Coins (GDD §5.1): what a duel, the Daily and a new level pay. The amounts are remote config:
 * the defaults, or what staff set in the console (FR-ECO-5, step 2.7g).
 */
import { DEFAULT_CONFIG, type GameConfig } from './config';
import { XP_REWARDS } from './progression';

/** How a finished duel ended for one player. A forfeit is the side that let the clock run out. */
export type DuelOutcome = 'win' | 'loss' | 'draw' | 'forfeit';

/** Win +30, lose +10 (a draw pays the same as a loss), and nothing for walking away. */
export function duelCoins(outcome: DuelOutcome, config: GameConfig = DEFAULT_CONFIG): number {
  switch (outcome) {
    case 'win':
      return config['econ.win_coins'];
    case 'loss':
    case 'draw':
      return config['econ.loss_coins'];
    case 'forfeit':
      return 0;
  }
}

/** The Daily pays 20, plus 5 for each day of the streak after the first, up to 50 (a week). */
export function dailyCoins(streak: number, config: GameConfig = DEFAULT_CONFIG): number {
  const days = Math.max(0, Math.floor(streak) - 1);
  return Math.min(
    config['econ.daily_coins_max'],
    config['econ.daily_coins'] + days * config['econ.daily_streak_coins'],
  );
}

/** +100 for every level reached. */
export function levelUpCoins(
  fromLevel: number,
  toLevel: number,
  config: GameConfig = DEFAULT_CONFIG,
): number {
  return Math.max(0, toLevel - fromLevel) * config['econ.level_up_coins'];
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
