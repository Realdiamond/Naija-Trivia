import { describe, expect, it } from 'vitest';
import {
  accuracyFlag,
  answerKeySuspect,
  expectedCorrect,
  initialItemRating,
  levelsByQuintile,
  shouldAutoSuspend,
  updateItemRating,
} from '../src/content';

describe('item difficulty', () => {
  it('starts from the writer level (1 → 1200 … 5 → 1800), matching the seed importer', () => {
    expect([1, 2, 3, 4, 5].map((l) => initialItemRating(l as 1 | 2 | 3 | 4 | 5))).toEqual([
      1200, 1350, 1500, 1650, 1800,
    ]);
  });

  it('gets easier when people answer correctly and harder when they miss', () => {
    expect(updateItemRating(1500, 1500, true)).toBeCloseTo(1496, 5);
    expect(updateItemRating(1500, 1500, false)).toBeCloseTo(1504, 5);
    expect(expectedCorrect(1500, 1500)).toBe(0.5);
  });

  it('buckets by quintile and keeps equal ratings together', () => {
    const ratings = Array.from({ length: 100 }, (_, i) => 1000 + i * 10);
    const levels = levelsByQuintile(ratings);
    for (const level of [1, 2, 3, 4, 5]) expect(levels.filter((l) => l === level)).toHaveLength(20);
    expect(levelsByQuintile([1500, 1500, 1500, 1500, 1500, 1500])).toEqual([5, 5, 5, 5, 5, 5]);
    expect(levelsByQuintile([])).toEqual([]);
  });
});

describe('quality flags', () => {
  it('flags questions that are too hard or too easy after 300 plays', () => {
    expect(accuracyFlag(299, 0)).toBeNull();
    expect(accuracyFlag(300, 10)).toBe('too_hard');
    expect(accuracyFlag(300, 295)).toBe('too_easy');
    expect(accuracyFlag(300, 150)).toBeNull();
  });

  it('suspects the answer key when a distractor wins a majority', () => {
    expect(answerKeySuspect([100, 210, 10, 10], 0)).toBe(true);
    expect(answerKeySuspect([210, 100, 10, 10], 0)).toBe(false);
    expect(answerKeySuspect([10, 20, 5, 5], 0)).toBe(false);
  });

  it('auto-suspends on 5 wrong-answer reports or > 3% of plays reported', () => {
    expect(shouldAutoSuspend({ plays: 10, wrongAnswerReports: 5, totalReports: 5 })).toBe(true);
    expect(shouldAutoSuspend({ plays: 1000, wrongAnswerReports: 0, totalReports: 31 })).toBe(true);
    expect(shouldAutoSuspend({ plays: 1000, wrongAnswerReports: 0, totalReports: 30 })).toBe(false);
    expect(shouldAutoSuspend({ plays: 20, wrongAnswerReports: 1, totalReports: 1 })).toBe(false);
  });
});
