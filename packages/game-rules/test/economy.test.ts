import { describe, expect, it } from 'vitest';
import { dailyCoins, duelCoins, duelXp, levelUpCoins } from '../src/economy';

describe('coins (GDD §5.1)', () => {
  it('pays 30 for a win, 10 for a loss or a draw, and nothing for a forfeit', () => {
    expect(duelCoins('win')).toBe(30);
    expect(duelCoins('loss')).toBe(10);
    expect(duelCoins('draw')).toBe(10);
    expect(duelCoins('forfeit')).toBe(0);
  });

  it('pays the Daily 20, plus 5 a streak day after the first, up to 50', () => {
    expect(dailyCoins(0)).toBe(20);
    expect(dailyCoins(1)).toBe(20);
    expect(dailyCoins(2)).toBe(25);
    expect(dailyCoins(3)).toBe(30);
    expect(dailyCoins(7)).toBe(50);
    expect(dailyCoins(40)).toBe(50);
  });

  it('pays 100 for each level reached, and nothing without one', () => {
    expect(levelUpCoins(1, 1)).toBe(0);
    expect(levelUpCoins(1, 2)).toBe(100);
    expect(levelUpCoins(3, 6)).toBe(300);
    expect(levelUpCoins(5, 4)).toBe(0);
  });
});

describe('duel XP', () => {
  it('gives 10 a right answer, 2 a wrong one and 50 for finishing', () => {
    expect(duelXp(6, 9, true)).toBe(6 * 10 + 3 * 2 + 50);
    expect(duelXp(0, 0, true)).toBe(50);
  });

  it('keeps what the answers earned for a player who forfeits', () => {
    expect(duelXp(2, 3, false)).toBe(22);
  });
});
