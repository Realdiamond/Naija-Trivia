import { describe, expect, it } from 'vitest';
import { accuracyOutlier, tabHiding, timingAnomaly, type AccuracyNumbers } from '../src/integrity';

/** `answers` questions each right for share `p` of players; this player got `right` of them. */
function numbers(
  answers: number,
  p: number,
  right: number,
  hard?: Partial<AccuracyNumbers>,
): AccuracyNumbers {
  return {
    answers,
    right,
    expected: answers * p,
    variance: answers * p * (1 - p),
    hardAnswers: 0,
    hardRight: 0,
    hardMeanMs: 0,
    hardSdMs: 0,
    ...hard,
  };
}

describe('integrity checks', () => {
  it('flags far more right answers than the questions allow', () => {
    // 60 answers to questions half of players get right: 30 expected, sd ≈ 3.9.
    expect(accuracyOutlier(numbers(60, 0.5, 38))).toBeNull(); // z ≈ 2.1: a good player
    const bot = accuracyOutlier(numbers(60, 0.5, 58))!;
    expect(bot.evidence.z).toBeCloseTo(7.23, 1);
    expect(bot.score).toBeCloseTo(0.9, 1);
    expect(bot.evidence).toMatchObject({ answers: 60, accuracy: 0.97, expected_accuracy: 0.5 });
    expect(accuracyOutlier(numbers(20, 0.5, 20))).toBeNull(); // too few answers to say
  });

  it('flags near-perfect hard answers at a near-constant speed', () => {
    const steady = numbers(40, 0.6, 30, { hardAnswers: 20, hardRight: 20, hardMeanMs: 2100, hardSdMs: 150 });
    expect(accuracyOutlier(steady)).toMatchObject({ score: 0.9, evidence: { hard_accuracy: 1 } });
    // The same accuracy at a human, varied speed: not on its own.
    const human = numbers(40, 0.6, 30, { hardAnswers: 20, hardRight: 20, hardMeanMs: 4000, hardSdMs: 2200 });
    expect(accuracyOutlier(human)).toBeNull();
  });

  it('flags an app that keeps saying it took far less time than the server saw', () => {
    expect(timingAnomaly(40, 400)).toBeNull();
    expect(timingAnomaly(10, 9000)).toBeNull();
    expect(timingAnomaly(40, 3000)).toEqual({ score: 0.5, evidence: { answers: 40, median_gap_ms: 3000 } });
    expect(timingAnomaly(40, 30_000)!.score).toBe(1);
  });

  it('flags a web player who does far better with the tab hidden', () => {
    expect(tabHiding({ answers: 40, hidden: 4, accuracyHidden: 1, accuracyVisible: 0.4 })).toBeNull();
    expect(tabHiding({ answers: 40, hidden: 20, accuracyHidden: 0.5, accuracyVisible: 0.45 })).toBeNull();
    expect(tabHiding({ answers: 40, hidden: 20, accuracyHidden: 0.95, accuracyVisible: 0.4 })).toEqual({
      score: 0.83,
      evidence: { answers: 40, hidden_share: 0.5, accuracy_hidden: 0.95, accuracy_visible: 0.4 },
    });
  });
});
