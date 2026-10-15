/**
 * Async duel flow (GDD §2.1, TRD §5.2). Pure: the API stores the snapshot and applies
 * events inside a transaction.
 *
 * Turn order keeps waiting short:
 *   A plays R1 → B plays R1 and R2 → A plays R2 and R3 → B plays R3 → [tie-break] → done
 * Category pickers: R1 challenger (A), R2 opponent (B), R3 challenger (A).
 */

export type DuelState =
  | 'created'
  | 'wait_b_r1r2'
  | 'wait_a_r2r3'
  | 'wait_b_r3'
  | 'tiebreak'
  | 'complete'
  | 'forfeit'
  | 'declined'
  | 'cancelled';

export type DuelSide = 'a' | 'b';
export type DuelRound = 1 | 2 | 3;

export interface DuelSnapshot {
  state: DuelState;
  scoreA: number;
  scoreB: number;
  /** False until the invite link is accepted. */
  opponentJoined: boolean;
  winner: DuelSide | null;
}

export type DuelEvent =
  /** The side whose turn it is finished every round of the turn; scores are the running totals. */
  | { type: 'turn_completed'; side: DuelSide; scoreA: number; scoreB: number }
  | { type: 'opponent_joined' }
  | { type: 'tiebreak_resolved'; winner: DuelSide }
  /** The turn deadline (48 h) passed. */
  | { type: 'expired' }
  | { type: 'declined' }
  | { type: 'cancelled' };

export class DuelTransitionError extends Error {
  constructor(state: DuelState, event: DuelEvent['type']) {
    super(`'${event}' is not allowed while the duel is '${state}'`);
    this.name = 'DuelTransitionError';
  }
}

export const NEW_DUEL: DuelSnapshot = {
  state: 'created',
  scoreA: 0,
  scoreB: 0,
  opponentJoined: false,
  winner: null,
};

const TURNS: Partial<Record<DuelState, { side: DuelSide; rounds: DuelRound[]; next: DuelState }>> = {
  created: { side: 'a', rounds: [1], next: 'wait_b_r1r2' },
  wait_b_r1r2: { side: 'b', rounds: [1, 2], next: 'wait_a_r2r3' },
  wait_a_r2r3: { side: 'a', rounds: [2, 3], next: 'wait_b_r3' },
  wait_b_r3: { side: 'b', rounds: [3], next: 'complete' },
};

/** Whose turn it is, or null when nobody can play. */
export function turnSide(state: DuelState): DuelSide | null {
  return TURNS[state]?.side ?? null;
}

/** Rounds the current player plays this turn, in order. */
export function roundsForTurn(state: DuelState): DuelRound[] {
  return [...(TURNS[state]?.rounds ?? [])];
}

/** Who picks the category for a round. */
export function categoryPicker(round: DuelRound): DuelSide {
  return round === 2 ? 'b' : 'a';
}

export function isFinished(state: DuelState): boolean {
  return state === 'complete' || state === 'forfeit' || state === 'declined' || state === 'cancelled';
}

export function applyDuelEvent(duel: DuelSnapshot, event: DuelEvent): DuelSnapshot {
  const turn = TURNS[duel.state];
  switch (event.type) {
    case 'opponent_joined':
      if (duel.opponentJoined || isFinished(duel.state))
        throw new DuelTransitionError(duel.state, event.type);
      return { ...duel, opponentJoined: true };

    case 'turn_completed': {
      if (!turn || turn.side !== event.side) throw new DuelTransitionError(duel.state, event.type);
      if (event.side === 'b' && !duel.opponentJoined) throw new DuelTransitionError(duel.state, event.type);
      const scored = { ...duel, scoreA: event.scoreA, scoreB: event.scoreB };
      if (turn.next !== 'complete') return { ...scored, state: turn.next };
      if (event.scoreA === event.scoreB) return { ...scored, state: 'tiebreak' };
      return { ...scored, state: 'complete', winner: event.scoreA > event.scoreB ? 'a' : 'b' };
    }

    case 'tiebreak_resolved':
      if (duel.state !== 'tiebreak') throw new DuelTransitionError(duel.state, event.type);
      return { ...duel, state: 'complete', winner: event.winner };

    case 'expired': {
      if (!turn) throw new DuelTransitionError(duel.state, event.type);
      // Nobody to award the win to if the challenger never played or the invite was never accepted.
      if (duel.state === 'created' || !duel.opponentJoined) return { ...duel, state: 'cancelled' };
      return { ...duel, state: 'forfeit', winner: turn.side === 'a' ? 'b' : 'a' };
    }

    case 'declined':
    case 'cancelled':
      // Only before the opponent has played anything.
      if (duel.state !== 'created' && duel.state !== 'wait_b_r1r2') {
        throw new DuelTransitionError(duel.state, event.type);
      }
      return { ...duel, state: event.type === 'declined' ? 'declined' : 'cancelled' };
  }
}

export interface TiebreakGuess {
  guess: number;
  elapsedMs: number;
}

/** Closest-number tie-break (GDD §2.1): closest guess wins, then the faster answer. */
export function resolveTiebreak(answer: number, a: TiebreakGuess, b: TiebreakGuess): DuelSide | null {
  const da = Math.abs(a.guess - answer);
  const db = Math.abs(b.guess - answer);
  if (da !== db) return da < db ? 'a' : 'b';
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs < b.elapsedMs ? 'a' : 'b';
  return null;
}
