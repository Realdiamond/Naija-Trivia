import { describe, expect, it } from 'vitest';
import { expectedCorrect } from '../src/content';
import { botAnswer, botGuess, canMatch, matchWindow, MATCH_WAIT_MS } from '../src/matchmaking';

/** A repeatable stand-in for Math.random (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random matchmaking (TRD FR-DUEL-6)', () => {
  it('starts at ±200 and widens by 100 every 10 seconds, up to a minute', () => {
    expect([0, 9_999, 10_000, 25_000, 50_000, 59_999].map(matchWindow)).toEqual([
      200, 200, 300, 400, 700, 700,
    ]);
    // A duel that waited longer still says ±700; the bot has its seat by then.
    expect(matchWindow(120_000)).toBe(700);
  });

  it('pairs players whose ratings fit the window for the wait so far', () => {
    expect(canMatch(1500, 1700, 0)).toBe(true);
    expect(canMatch(1500, 1750, 0)).toBe(false);
    expect(canMatch(1500, 1750, 10_000)).toBe(true);
    expect(canMatch(1750, 1500, 10_000)).toBe(true);
    // After a minute, nobody: the Sabi Bot plays.
    expect(canMatch(1500, 1500, MATCH_WAIT_MS)).toBe(false);
  });
});

describe('the Sabi Bot', () => {
  it('gets questions right about as often as a player of its rating would', () => {
    const random = seeded(7);
    for (const [item, bot] of [
      [1500, 1500],
      [1800, 1400],
      [1200, 1700],
    ] as const) {
      let right = 0;
      for (let i = 0; i < 4000; i++) {
        if (botAnswer({ itemRating: item, optionCount: 4, correctIndex: 2 }, bot, random).correct) right++;
      }
      expect(right / 4000).toBeCloseTo(expectedCorrect(item, bot), 1);
    }
  });

  it('answers in 3–12 seconds and picks a real wrong option when it misses', () => {
    const random = seeded(11);
    const wrongPicks = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const a = botAnswer({ itemRating: 1500, optionCount: 4, correctIndex: 1 }, 1500, random);
      expect(a.elapsedMs).toBeGreaterThanOrEqual(3000);
      expect(a.elapsedMs).toBeLessThanOrEqual(12_000);
      if (a.correct) expect(a.chosenIndex).toBe(1);
      else wrongPicks.add(a.chosenIndex);
    }
    expect([...wrongPicks].sort()).toEqual([0, 2, 3]);
    // True or false: the only wrong option.
    const tf = botAnswer({ itemRating: 3000, optionCount: 2, correctIndex: 0 }, 1000, () => 0.5);
    expect(tf).toMatchObject({ correct: false, chosenIndex: 1 });
  });

  it('guesses near the answer in a tie-break: years by up to 15, other numbers by up to 15%', () => {
    const random = seeded(3);
    for (let i = 0; i < 500; i++) {
      const year = botGuess(1960, random);
      expect(Number.isInteger(year)).toBe(true);
      expect(Math.abs(year - 1960)).toBeLessThanOrEqual(15);
      const people = botGuess(200_000, random);
      expect(Math.abs(people - 200_000)).toBeLessThanOrEqual(30_000);
      const rate = botGuess(2.5, random);
      expect(Math.abs(rate - 2.5)).toBeLessThanOrEqual(1);
    }
  });
});
