/**
 * Question difficulty calibration and quality thresholds (GDD §6.3, content doc §4), and how
 * long trending questions stay in the game (GDD §6.2).
 */
import { addDays } from './calendar';

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

/** Starting item rating from the writer's level: 1 → 1200 … 5 → 1800. */
export function initialItemRating(level: DifficultyLevel): number {
  return 1050 + 150 * level;
}

/** Probability that a player of `playerRating` answers a question of `itemRating` correctly. */
export function expectedCorrect(itemRating: number, playerRating: number): number {
  return 1 / (1 + 10 ** ((itemRating - playerRating) / 400));
}

/** Elo-style item update after one answer: questions get "harder" when people miss them. */
export function updateItemRating(itemRating: number, playerRating: number, correct: boolean, k = 8): number {
  return itemRating + k * (expectedCorrect(itemRating, playerRating) - (correct ? 1 : 0));
}

/**
 * Nightly re-bucketing into levels 1–5 by item-rating quintiles. Equal ratings always
 * land in the same level.
 */
export function levelsByQuintile(itemRatings: readonly number[]): DifficultyLevel[] {
  if (itemRatings.length === 0) return [];
  const sorted = [...itemRatings].sort((x, y) => x - y);
  const cuts = [1, 2, 3, 4].map((k) => sorted[Math.floor((sorted.length * k) / 5)]!);
  return itemRatings.map((r) => (1 + cuts.filter((c) => r >= c).length) as DifficultyLevel);
}

/** Minimum answers before accuracy-based flags apply. */
export const REVIEW_MIN_PLAYS = 300;

/** Too hard (< 5% correct) or too easy (> 97%) after enough plays, or possibly a wrong answer key. */
export function accuracyFlag(plays: number, correct: number): 'too_hard' | 'too_easy' | null {
  if (plays < REVIEW_MIN_PLAYS) return null;
  const rate = correct / plays;
  if (rate < 0.05) return 'too_hard';
  if (rate > 0.97) return 'too_easy';
  return null;
}

/** The most-picked option is a distractor chosen by more than half of players. */
export function answerKeySuspect(optionCounts: readonly number[], correctIndex: number): boolean {
  const plays = optionCounts.reduce((sum, n) => sum + n, 0);
  if (plays < REVIEW_MIN_PLAYS) return false;
  let top = 0;
  optionCounts.forEach((n, i) => {
    if (n > optionCounts[top]!) top = i;
  });
  return top !== correctIndex && optionCounts[top]! / plays > 0.5;
}

export interface ReportCounts {
  plays: number;
  wrongAnswerReports: number;
  totalReports: number;
}

/**
 * Auto-suspend a question pending review (PRD US-9): 5+ "wrong answer" reports, or
 * reports on more than 3% of plays. The percentage rule waits for `minPlays` so a
 * single early report can't pull a new question.
 */
export function shouldAutoSuspend(counts: ReportCounts, minPlays = 100): boolean {
  if (counts.wrongAnswerReports >= 5) return true;
  return counts.plays >= minPlays && counts.totalReports / counts.plays > 0.03;
}

/** GDD §6.2: a trending question leaves the game this long after going live, unless renewed. */
export const TRENDING_DAYS = 90;

/** The last day a trending question live from `today` may stay: its own date if that is sooner. */
export function trendingValidUntil(validUntil: string | null, today: string): string {
  const cap = addDays(today, TRENDING_DAYS);
  return validUntil !== null && validUntil < cap ? validUntil : cap;
}
