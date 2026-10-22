/**
 * Points per question (GDD §4.1):
 *   base   = 100 if correct else 0
 *   speed  = round(100 × (1 − t_answer / t_limit)), only if correct
 *   streak = min(consecutive_correct − 1, 4) × 20
 *   points = (base + speed + streak) × 2 in the Wahala Round (party only)
 */
import { MIN_HUMAN_ELAPSED_MS } from './timing';

export interface ScoringRules {
  /** Points for a correct answer before bonuses. */
  base: number;
  /** Largest speed bonus. */
  speedMax: number;
  /** Bonus per consecutive correct answer after the first. */
  streakStep: number;
  /** Most streak steps that count (4 × 20 = +80). */
  streakCap: number;
}

export const DEFAULT_SCORING: ScoringRules = { base: 100, speedMax: 100, streakStep: 20, streakCap: 4 };

export interface AnswerScoreInput {
  correct: boolean;
  /** Accepted elapsed time from `acceptElapsed`, in ms. */
  elapsedMs: number;
  timeLimitMs: number;
  /** Correct answers in a row immediately before this one, in the same match. */
  streakBefore: number;
  /** Wahala Round (party only) doubles the points. */
  wahala?: boolean;
}

export interface AnswerScore {
  base: number;
  speed: number;
  streak: number;
  multiplier: 1 | 2;
  points: number;
  /** Streak to carry into the next question. */
  streakAfter: number;
}

export function scoreAnswer(input: AnswerScoreInput, rules: ScoringRules = DEFAULT_SCORING): AnswerScore {
  const { correct, elapsedMs, timeLimitMs, streakBefore } = input;
  if (!(timeLimitMs > 0)) throw new RangeError(`timeLimitMs must be positive, got ${timeLimitMs}`);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new RangeError(`elapsedMs must be ≥ 0, got ${elapsedMs}`);
  if (!Number.isInteger(streakBefore) || streakBefore < 0) {
    throw new RangeError(`streakBefore must be a non-negative integer, got ${streakBefore}`);
  }

  const multiplier = input.wahala ? 2 : 1;
  if (!correct) return { base: 0, speed: 0, streak: 0, multiplier, points: 0, streakAfter: 0 };

  const fractionUsed = Math.min(Math.max(elapsedMs / timeLimitMs, 0), 1);
  const speed = Math.round(rules.speedMax * (1 - fractionUsed));
  const streak = Math.min(streakBefore, rules.streakCap) * rules.streakStep;
  const points = (rules.base + speed + streak) * multiplier;
  return { base: rules.base, speed, streak, multiplier, points, streakAfter: streakBefore + 1 };
}

/**
 * Highest possible score for a run of questions, all answered correctly as fast as we
 * accept (MIN_HUMAN_ELAPSED_MS). A 9-question duel with 15 s questions tops out at 2,302.
 */
export function maxScore(
  questions: number,
  timeLimitMs: number,
  rules: ScoringRules = DEFAULT_SCORING,
): number {
  let total = 0;
  let streak = 0;
  for (let i = 0; i < questions; i++) {
    const s = scoreAnswer(
      { correct: true, elapsedMs: MIN_HUMAN_ELAPSED_MS, timeLimitMs, streakBefore: streak },
      rules,
    );
    total += s.points;
    streak = s.streakAfter;
  }
  return total;
}
