/**
 * Lifelines (GDD §5.2): one of each per duel, paid for with coins. Never in the Daily, Campus
 * Clash or a sponsored-prize event, and never in a duel's tie-break.
 */
import { DEFAULT_CONFIG, type GameConfig } from './config';
import { xxh64 } from './hash';

export const LIFELINES = ['fifty', 'ask_naija', 'skip', 'time'] as const;
export type Lifeline = (typeof LIFELINES)[number];

export function lifelineCost(type: Lifeline, config: GameConfig = DEFAULT_CONFIG): number {
  return config[`econ.lifeline_${type}`];
}

/** "+10s": what Extra Time adds. Points for speed still count against the usual limit. */
export const EXTRA_TIME_MS = 10_000;

/**
 * 50/50: the two wrong options to take away (canonical indexes, in order), the same every time
 * for one player and question. Only for four-option questions.
 */
export function fiftyFifty(optionCount: number, correctIndex: number, seed: string): [number, number] {
  if (optionCount !== 4) throw new RangeError(`50/50 needs four options, got ${optionCount}`);
  const wrong = [0, 1, 2, 3].filter((i) => i !== correctIndex);
  // Keep one wrong option at random; the other two go.
  const kept = wrong[Number(xxh64(seed) % 3n)]!;
  const removed = wrong.filter((i) => i !== kept);
  return [removed[0]!, removed[1]!];
}

/** How many imagined players stand in for a question few have answered yet. */
export const ASK_NAIJA_PRIOR = 20;

/**
 * Ask Naija: the share of players who picked each option (canonical order, whole percentages
 * adding up to 100). Until a question has many answers, an imagined crowd that gets it right as
 * often as its difficulty says (`expectedCorrect`, 0–1) fills in, so the first player to ask
 * still sees something sensible. That crowd always leans to the right answer, narrowly on a hard
 * question: one that leaned away would teach players to read Ask Naija backwards.
 */
export function askNaija(counts: readonly number[], correctIndex: number, expectedCorrect: number): number[] {
  const n = counts.length;
  if (n < 2 || correctIndex < 0 || correctIndex >= n) throw new RangeError('askNaija: bad options');
  const p = Math.min(0.9, Math.max(1 / n + 0.1, expectedCorrect));
  const votes = counts.map(
    (c, i) => Math.max(0, c) + ASK_NAIJA_PRIOR * (i === correctIndex ? p : (1 - p) / (n - 1)),
  );
  const total = votes.reduce((a, b) => a + b, 0);
  // Largest remainder, so the percentages add up to exactly 100.
  const exact = votes.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]!++;
    left--;
  }
  return floors;
}
