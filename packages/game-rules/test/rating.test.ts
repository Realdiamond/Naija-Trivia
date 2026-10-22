import { describe, expect, it } from 'vitest';
import {
  dampenPairGain,
  NEW_PLAYER_RATING,
  seasonSoftReset,
  tierForRating,
  updateRating,
} from '../src/rating';

describe('dampenPairGain (anti win-trading)', () => {
  it('leaves the first 3 games between a pair alone, then halves gains game by game', () => {
    expect([0, 1, 2].map((before) => dampenPairGain(16, before))).toEqual([16, 16, 16]);
    expect([3, 4, 5].map((before) => dampenPairGain(16, before))).toEqual([8, 4, 2]);
  });

  it('never softens a loss', () => {
    expect(dampenPairGain(-12, 7)).toBe(-12);
    expect(dampenPairGain(0, 7)).toBe(0);
  });
});

describe('updateRating (Glicko-2)', () => {
  it("reproduces the worked example from Glickman's paper", () => {
    const next = updateRating({ rating: 1500, rd: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ]);
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.volatility).toBeCloseTo(0.05999, 4);
  });

  it('moves up after beating a stronger player and down after losing to a weaker one', () => {
    const me = { rating: 1500, rd: 120, volatility: 0.06 };
    expect(
      updateRating(me, [{ opponent: { rating: 1700, rd: 80, volatility: 0.06 }, score: 1 }]).rating,
    ).toBeGreaterThan(1500);
    expect(
      updateRating(me, [{ opponent: { rating: 1300, rd: 80, volatility: 0.06 }, score: 0 }]).rating,
    ).toBeLessThan(1500);
  });

  it('only widens the deviation when a player sits out, never past 350', () => {
    const idle = updateRating({ rating: 1620, rd: 90, volatility: 0.06 }, []);
    expect(idle.rating).toBe(1620);
    expect(idle.rd).toBeGreaterThan(90);
    expect(updateRating(NEW_PLAYER_RATING, []).rd).toBe(350);
  });
});

describe('tierForRating', () => {
  it.each([
    [1000, 'jjc'],
    [1299.9, 'jjc'],
    [1300, 'learner'],
    [1500, 'sharp'],
    [1700, 'oga'],
    [1900, 'chairman'],
    [2100, 'baba_sabi'],
    [2600, 'baba_sabi'],
  ])('%d → %s', (rating, tier) => {
    expect(tierForRating(rating).id).toBe(tier);
  });
});

describe('seasonSoftReset', () => {
  it('pulls ratings halfway back to 1500', () => {
    expect(seasonSoftReset(1900)).toBe(1700);
    expect(seasonSoftReset(1300)).toBe(1400);
    expect(seasonSoftReset(1500)).toBe(1500);
  });
});
