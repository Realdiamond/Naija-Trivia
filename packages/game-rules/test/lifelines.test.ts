import { describe, expect, it } from 'vitest';
import { askNaija, fiftyFifty, lifelineCost } from '../src/lifelines';

describe('lifelines (GDD §5.2)', () => {
  it('costs 60, 80, 100 and 40 coins', () => {
    expect(['fifty', 'ask_naija', 'skip', 'time'].map((t) => lifelineCost(t as never))).toEqual([
      60, 80, 100, 40,
    ]);
  });

  it('50/50 takes away two wrong options, the same ones every time', () => {
    for (let correct = 0; correct < 4; correct++) {
      for (const seed of ['a', 'b', 'c', 'd', 'e']) {
        const removed = fiftyFifty(4, correct, seed);
        expect(removed).not.toContain(correct);
        expect(new Set(removed).size).toBe(2);
        expect(fiftyFifty(4, correct, seed)).toEqual(removed);
      }
    }
    const kept = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => fiftyFifty(4, 0, s).join()));
    expect(kept.size).toBeGreaterThan(1);
    expect(() => fiftyFifty(2, 0, 'a')).toThrow(RangeError);
  });

  it('Ask Naija adds up to 100, follows the answers, and fills in for a new question', () => {
    const fresh = askNaija([0, 0, 0, 0], 2, 0.7);
    expect(fresh.reduce((a, b) => a + b, 0)).toBe(100);
    expect(fresh).toEqual([10, 10, 70, 10]);
    const played = askNaija([300, 500, 100, 100], 2, 0.7);
    expect(played.reduce((a, b) => a + b, 0)).toBe(100);
    expect(played.indexOf(Math.max(...played))).toBe(1);
    // A hard new question: the imagined crowd still leans, narrowly, to the right answer.
    const hard = askNaija([0, 0, 0, 0], 1, 0.15);
    expect(hard).toEqual([22, 35, 22, 21]);
    expect(askNaija([1, 1], 0, 0.5)).toEqual([59, 41]);
  });
});
