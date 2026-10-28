import { describe, expect, it } from 'vitest';
import { isWahala, liveRanks, partyMvp, partyXp, rankParty } from '../src/party';

describe('the Wahala Round', () => {
  it('is the last 3 questions when the host turns it on', () => {
    const wahala = (total: number, on = true) =>
      Array.from({ length: total }, (_, i) => isWahala(i, total, on));
    expect(wahala(10)).toEqual([false, false, false, false, false, false, false, true, true, true]);
    expect(wahala(5)).toEqual([false, false, true, true, true]);
    expect(wahala(10, false).some(Boolean)).toBe(false);
    // Never the whole game.
    expect(wahala(3).some(Boolean)).toBe(false);
  });
});

describe('the end of a party game', () => {
  const p = (id: string, score: number, correct: number, fastestCorrectMs: number | null) => ({
    id,
    score,
    correct,
    fastestCorrectMs,
  });

  it('ranks by points, then right answers, then the quickest right answer; equals share a place', () => {
    const ranked = rankParty([
      p('chidi', 1722, 7, 2100),
      p('ngozi', 2140, 9, 1200),
      p('femi', 1722, 7, 1900),
      p('tolu', 1980, 8, 1500),
      p('uncle_b', 0, 0, null),
      p('dami', 0, 0, null),
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ['ngozi', 1],
      ['tolu', 2],
      ['femi', 3],
      ['chidi', 4],
      ['uncle_b', 5],
      ['dami', 5],
    ]);
  });

  it('names the MVP by right answers, then speed, and nobody with none right', () => {
    expect(
      partyMvp([p('ngozi', 2140, 8, 1500), p('tolu', 1980, 9, 2500), p('femi', 1980, 9, 1800)])?.id,
    ).toBe('femi');
    expect(partyMvp([p('a', 0, 0, null)])).toBeNull();
  });

  it('places players between questions by points alone', () => {
    const ranks = liveRanks([
      { id: 'a', score: 300 },
      { id: 'b', score: 500 },
      { id: 'c', score: 300 },
      { id: 'd', score: 0 },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, a: 2, c: 2, d: 4 });
  });
});

describe('XP for a party game', () => {
  it('gives 10 a right answer, 2 a wrong one and 50 for finishing', () => {
    expect(partyXp(7, 9)).toBe(70 + 4 + 50);
    expect(partyXp(0, 0)).toBe(50);
  });
});
