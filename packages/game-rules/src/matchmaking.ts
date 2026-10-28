/**
 * Random opponents and the Sabi Bot (TRD FR-DUEL-6, GDD §4.2). A random duel waits for a
 * stranger whose rating is within ±200 of the challenger's; the window widens by 100 every
 * 10 seconds, and after 60 seconds the Sabi Bot, clearly labelled as a bot, takes the seat.
 *
 * The bot plays like a player of its opponent's rating: each answer is right with the
 * probability the item ratings give (GDD §6.3), in a believable time. Pure: the API passes in
 * the random source, so tests can fix it.
 */
import { expectedCorrect } from './content';

/** ±200 at first (GDD §2.1 table). */
export const MATCH_WINDOW_START = 200;
export const MATCH_WINDOW_STEP = 100;
export const MATCH_WINDOW_EVERY_MS = 10_000;
/** After this long without a player, the Sabi Bot plays instead. */
export const MATCH_WAIT_MS = 60_000;
/** The bot answers its turn this long after it starts, so it never feels instant. */
export const BOT_TURN_DELAY_MS = 20_000;

/** How far apart in rating two players may be, once a random duel has waited `waitedMs`. */
export function matchWindow(waitedMs: number): number {
  const steps = Math.floor(Math.min(Math.max(waitedMs, 0), MATCH_WAIT_MS - 1) / MATCH_WINDOW_EVERY_MS);
  return MATCH_WINDOW_START + MATCH_WINDOW_STEP * steps;
}

/** A player can take a waiting random duel when their ratings are close enough for its wait so far. */
export function canMatch(ratingA: number, ratingB: number, waitedMs: number): boolean {
  return waitedMs < MATCH_WAIT_MS && Math.abs(ratingA - ratingB) <= matchWindow(waitedMs);
}

export interface BotAnswer {
  /** The option the bot picked, in the question's own order. */
  chosenIndex: number;
  correct: boolean;
  elapsedMs: number;
}

/**
 * One multiple-choice answer from the bot. Right answers come a little faster than wrong
 * ones (3–9 s against 4–12 s), always inside the 15 s limit.
 */
export function botAnswer(
  q: { itemRating: number; optionCount: number; correctIndex: number },
  botRating: number,
  random: () => number,
): BotAnswer {
  const correct = random() < expectedCorrect(q.itemRating, botRating);
  const elapsedMs = Math.round(correct ? 3000 + random() * 6000 : 4000 + random() * 8000);
  if (correct) return { chosenIndex: q.correctIndex, correct, elapsedMs };
  // One of the wrong options, evenly.
  const wrong = Math.min(Math.floor(random() * (q.optionCount - 1)), q.optionCount - 2);
  return { chosenIndex: wrong >= q.correctIndex ? wrong + 1 : wrong, correct, elapsedMs };
}

/**
 * The bot's closest-number guess: near the answer, rarely spot on. Years (whole numbers from
 * 1000 to 2100) are off by up to 15 years; other numbers by up to 15%.
 */
export function botGuess(answer: number, random: () => number): number {
  const yearLike = Number.isInteger(answer) && answer >= 1000 && answer <= 2100;
  const spread = yearLike ? 15 : Math.max(1, Math.abs(answer) * 0.15);
  const guess = answer + (random() * 2 - 1) * spread;
  return Number.isInteger(answer) ? Math.round(guess) : Math.round(guess * 100) / 100;
}
