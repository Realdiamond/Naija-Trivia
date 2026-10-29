/**
 * The nightly integrity checks (doc 10 §2, build plan step 2.7e): signals for a moderator to look
 * at, never an automatic ban. Each check takes a player's numbers over the last week of duels and
 * gives a risk score 0–1 with the evidence, or null when nothing stands out.
 */

export interface IntegritySignal {
  score: number;
  evidence: Record<string, number>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** A question's share of right answers is held inside this, so no answer weighs 0 or everything. */
export const P_FLOOR = 0.02;
export const MIN_ANSWERS = 30;
export const Z_FLAG = 4;
export const MIN_HARD_ANSWERS = 20;

export interface AccuracyNumbers {
  /** Answers to questions with enough plays to know how hard they are. */
  answers: number;
  right: number;
  /** Sum of each question's share of right answers: the right answers an average player gets. */
  expected: number;
  /** Sum of p(1 − p): the spread around that. */
  variance: number;
  /** The same on hard questions (fewer than half of players right), with the answer times. */
  hardAnswers: number;
  hardRight: number;
  hardMeanMs: number;
  hardSdMs: number;
}

/**
 * Screen readers and OCR bots (doc 10 §2): far more right than the questions' difficulty allows
 * (a z-score of 4 or more), or 95% right on hard questions at a near-constant speed.
 */
export function accuracyOutlier(n: AccuracyNumbers): IntegritySignal | null {
  if (n.answers < MIN_ANSWERS || n.variance <= 0) return null;
  const z = (n.right - n.expected) / Math.sqrt(n.variance);
  const hardAccuracy = n.hardAnswers > 0 ? n.hardRight / n.hardAnswers : 0;
  const steadiness = n.hardMeanMs > 0 ? n.hardSdMs / n.hardMeanMs : 1;
  const robotic = n.hardAnswers >= MIN_HARD_ANSWERS && hardAccuracy >= 0.95 && steadiness < 0.2;
  if (z < Z_FLAG && !robotic) return null;
  return {
    score: round(clamp01(Math.max(z / (2 * Z_FLAG), robotic ? 0.9 : 0))),
    evidence: {
      z: round(z),
      answers: n.answers,
      accuracy: round(n.right / n.answers),
      expected_accuracy: round(n.expected / n.answers),
      hard_answers: n.hardAnswers,
      hard_accuracy: round(hardAccuracy),
      hard_time_spread: round(steadiness),
    },
  };
}

export const TIMING_GAP_FLAG_MS = 3000;
export const MIN_TIMED_ANSWERS = 20;

/**
 * Faked clocks (doc 10 §2): the app keeps saying it took far less time than the server saw,
 * after allowing for the network. `medianGapMs` is the median of server time − round trip −
 * the app's own time.
 */
export function timingAnomaly(answers: number, medianGapMs: number): IntegritySignal | null {
  if (answers < MIN_TIMED_ANSWERS || medianGapMs < TIMING_GAP_FLAG_MS) return null;
  return {
    score: round(clamp01(0.5 + (medianGapMs - TIMING_GAP_FLAG_MS) / 14_000)),
    evidence: { answers, median_gap_ms: Math.round(medianGapMs) },
  };
}

export const TAB_HIDDEN_MS = 2000;
export const TAB_HIDDEN_SHARE = 0.25;
export const TAB_ACCURACY_GAIN = 0.2;

/**
 * Searching in another tab (web, doc 10 §2): the tab often hidden during questions, and far more
 * right answers when it was.
 */
export function tabHiding(n: {
  answers: number;
  hidden: number;
  accuracyHidden: number;
  accuracyVisible: number;
}): IntegritySignal | null {
  if (n.answers < MIN_TIMED_ANSWERS || n.hidden === 0) return null;
  const share = n.hidden / n.answers;
  const gain = n.accuracyHidden - n.accuracyVisible;
  if (share < TAB_HIDDEN_SHARE || gain < TAB_ACCURACY_GAIN) return null;
  return {
    score: round(clamp01(0.3 + share / 2 + gain / 2)),
    evidence: {
      answers: n.answers,
      hidden_share: round(share),
      accuracy_hidden: round(n.accuracyHidden),
      accuracy_visible: round(n.accuracyVisible),
    },
  };
}
