import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { maxScore, scoreAnswer } from '../src/scoring';

describe('scoreAnswer', () => {
  it('matches the worked example in the API doc (4,210 ms of 15 s → 172 points)', () => {
    const s = scoreAnswer({ correct: true, elapsedMs: 4210, timeLimitMs: 15_000, streakBefore: 0 });
    expect(s).toMatchObject({ base: 100, speed: 72, streak: 0, points: 172, streakAfter: 1 });
  });

  it('gives nothing for a wrong answer and resets the streak', () => {
    expect(
      scoreAnswer({ correct: false, elapsedMs: 1000, timeLimitMs: 15_000, streakBefore: 3 }),
    ).toMatchObject({
      points: 0,
      streakAfter: 0,
    });
  });

  it('adds 20 per answer in a row, capped at +80', () => {
    const bonuses = [0, 1, 2, 3, 4, 5, 9].map(
      (streakBefore) =>
        scoreAnswer({ correct: true, elapsedMs: 15_000, timeLimitMs: 15_000, streakBefore }).streak,
    );
    expect(bonuses).toEqual([0, 20, 40, 60, 80, 80, 80]);
  });

  it('doubles everything in the Wahala Round', () => {
    const normal = scoreAnswer({ correct: true, elapsedMs: 3000, timeLimitMs: 15_000, streakBefore: 2 });
    const wahala = scoreAnswer({
      correct: true,
      elapsedMs: 3000,
      timeLimitMs: 15_000,
      streakBefore: 2,
      wahala: true,
    });
    expect(wahala.points).toBe(normal.points * 2);
  });

  it('never gives more points for a slower answer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 10 }),
        (t1, t2, streakBefore) => {
          const [fast, slow] = t1 <= t2 ? [t1, t2] : [t2, t1];
          const pf = scoreAnswer({
            correct: true,
            elapsedMs: fast,
            timeLimitMs: 15_000,
            streakBefore,
          }).points;
          const ps = scoreAnswer({
            correct: true,
            elapsedMs: slow,
            timeLimitMs: 15_000,
            streakBefore,
          }).points;
          expect(pf).toBeGreaterThanOrEqual(ps);
        },
      ),
    );
  });

  it('keeps every answer between 0 and 280 points (560 in the Wahala Round)', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 30_000 }),
        fc.integer({ min: 0, max: 50 }),
        fc.boolean(),
        (correct, t, streakBefore, wahala) => {
          const { points } = scoreAnswer({
            correct,
            elapsedMs: t,
            timeLimitMs: 15_000,
            streakBefore,
            wahala,
          });
          expect(points).toBeGreaterThanOrEqual(0);
          expect(points).toBeLessThanOrEqual(wahala ? 560 : 280);
        },
      ),
    );
  });

  it('rejects impossible inputs', () => {
    expect(() => scoreAnswer({ correct: true, elapsedMs: -1, timeLimitMs: 15_000, streakBefore: 0 })).toThrow(
      RangeError,
    );
    expect(() => scoreAnswer({ correct: true, elapsedMs: 1, timeLimitMs: 0, streakBefore: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      scoreAnswer({ correct: true, elapsedMs: 1, timeLimitMs: 15_000, streakBefore: 1.5 }),
    ).toThrow(RangeError);
  });
});

describe('maxScore', () => {
  it('caps a 9-question duel at 2,302 points (900 base + 882 speed + 520 streak)', () => {
    expect(maxScore(9, 15_000)).toBe(2302);
  });
});
