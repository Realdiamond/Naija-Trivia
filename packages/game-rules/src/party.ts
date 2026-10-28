/**
 * Party rooms (GDD §2.2, TRD §4.4, UX §2.3): what a host can pick, the room's clock, the
 * Wahala Round and the end-of-game ranking with its "MVP of the night".
 *
 * Phases: LOBBY → COUNTDOWN → QUESTION → REVEAL → LEADERBOARD → … → PODIUM → (LOBBY to play
 * again) → CLOSED.
 */
import { XP_REWARDS } from './progression';

export const PARTY_QUESTION_COUNTS = [5, 10, 15, 20] as const;
export const PARTY_TIMERS_S = [10, 15, 20] as const;
/** The Wahala Round: the last 3 questions, harder and worth double. */
export const WAHALA_QUESTIONS = 3;
/** The host can start once this many people are playing (UX §2.3). */
export const PARTY_MIN_PLAYERS = 2;

export type PartyPhase = 'LOBBY' | 'COUNTDOWN' | 'QUESTION' | 'REVEAL' | 'LEADERBOARD' | 'PODIUM' | 'CLOSED';

export interface PartyTimings {
  /** "3, 2, 1" before the first question. */
  countdownMs: number;
  /** Answers still count this long after the clock shows zero (API §3.4). */
  graceMs: number;
  /** The right answer and what everyone picked. */
  revealMs: number;
  /** The top 5 between questions. */
  leaderboardMs: number;
  /** A dropped player keeps their seat this long; a host gone this long hands over (FR-PARTY-4, 5). */
  reconnectMs: number;
  /** A room nobody is using closes after this (FR-PARTY-2). */
  idleCloseMs: number;
}

export const PARTY_TIMINGS: PartyTimings = {
  countdownMs: 3000,
  graceMs: 300,
  revealMs: 2500,
  leaderboardMs: 3000,
  reconnectMs: 60_000,
  idleCloseMs: 10 * 60_000,
};

/** XP for a finished game (GDD §5.1): +10 a right answer, +2 a wrong one, +50 for finishing. */
export function partyXp(correct: number, answered: number): number {
  return (
    correct * XP_REWARDS.correctAnswer +
    (answered - correct) * XP_REWARDS.wrongAnswer +
    XP_REWARDS.matchComplete
  );
}

/** A closed room's code isn't given out again for this long (FR-PARTY-1). */
export const ROOM_CODE_RESERVED_MS = 10 * 60_000;

/** Whether question `index` (from 0) of `total` is in the Wahala Round. */
export function isWahala(index: number, total: number, wahalaOn: boolean): boolean {
  return wahalaOn && total > WAHALA_QUESTIONS && index >= total - WAHALA_QUESTIONS;
}

export interface PartyStanding {
  id: string;
  score: number;
  correct: number;
  /** The quickest right answer, in ms; null with none right. */
  fastestCorrectMs: number | null;
}

/**
 * Final places: more points first, then more right answers, then the quickest right answer.
 * Players equal on all three share a place (1, 1, 3).
 */
export function rankParty<T extends PartyStanding>(players: readonly T[]): Array<T & { rank: number }> {
  const sorted = [...players].sort(compareStandings);
  return sorted.map((p, i) => {
    let rank = i + 1;
    for (let j = i - 1; j >= 0 && compareStandings(sorted[j]!, p) === 0; j--) rank = j + 1;
    return { ...p, rank };
  });
}

/** Places between questions, by points alone (ties share a place). */
export function liveRanks(players: readonly { id: string; score: number }[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const ranks = new Map<string, number>();
  sorted.forEach((p, i) => {
    const before = sorted[i - 1];
    ranks.set(p.id, before && before.score === p.score ? ranks.get(before.id)! : i + 1);
  });
  return ranks;
}

/**
 * MVP of the night (UX §2.3, mockup 20): the most right answers, then the quickest right
 * answer. Nobody with no right answers.
 */
export function partyMvp<T extends PartyStanding>(players: readonly T[]): T | null {
  let best: T | null = null;
  for (const p of players) {
    if (p.correct === 0) continue;
    if (
      !best ||
      p.correct > best.correct ||
      (p.correct === best.correct && (p.fastestCorrectMs ?? Infinity) < (best.fastestCorrectMs ?? Infinity))
    ) {
      best = p;
    }
  }
  return best;
}

function compareStandings(a: PartyStanding, b: PartyStanding): number {
  return (
    b.score - a.score ||
    b.correct - a.correct ||
    (a.fastestCorrectMs ?? Infinity) - (b.fastestCorrectMs ?? Infinity) ||
    0
  );
}
