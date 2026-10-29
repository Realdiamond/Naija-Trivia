/**
 * Solo Practice with packs (GDD §2.6, build plan step 2.8f): a player keeps a pack's practice set
 * of up to 50 questions on their device, answers checked there, so it plays offline. A game is
 * 10 of them; it pays XP (never coins, never rating), up to a daily cap.
 */
import { XP_REWARDS } from './progression';

/** Questions in a pack's practice set, kept on the device. */
export const PRACTICE_SET_SIZE = 50;
/** Questions in one practice game. */
export const PRACTICE_GAME_QUESTIONS = 10;
/** A pack needs this many questions a player can get before it shows. */
export const PRACTICE_MIN_QUESTIONS = 10;
/** A finished practice game can arrive this late (it was played offline). */
export const PRACTICE_RESULT_MAX_AGE_DAYS = 14;

/** XP for a practice game: per answer, plus the finish when every question was answered. */
export function practiceXp(correct: number, answered: number, complete: boolean): number {
  return (
    correct * XP_REWARDS.correctAnswer +
    (answered - correct) * XP_REWARDS.wrongAnswer +
    (complete ? XP_REWARDS.matchComplete : 0)
  );
}

/**
 * The next game's questions from a practice set: those played least often first, then in the
 * set's order, so a player goes round the whole set before seeing a question again.
 */
export function nextPracticeGame(
  setIds: readonly string[],
  plays: Readonly<Record<string, number>>,
  n: number = PRACTICE_GAME_QUESTIONS,
): string[] {
  return setIds
    .map((id, order) => ({ id, order, played: plays[id] ?? 0 }))
    .sort((a, b) => a.played - b.played || a.order - b.order)
    .slice(0, n)
    .map((q) => q.id);
}
