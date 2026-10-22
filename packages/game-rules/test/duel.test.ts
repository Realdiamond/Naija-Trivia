import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyDuelEvent,
  categoryPicker,
  DuelTransitionError,
  NEW_DUEL,
  resolveTiebreak,
  roundsForTurn,
  turnSide,
  type DuelEvent,
  type DuelSnapshot,
  type DuelState,
} from '../src/duel';

const joined: DuelSnapshot = { ...NEW_DUEL, opponentJoined: true };

function run(events: DuelEvent[], start: DuelSnapshot = joined): DuelSnapshot {
  return events.reduce(applyDuelEvent, start);
}

describe('duel flow', () => {
  it('plays out A R1 → B R1+R2 → A R2+R3 → B R3', () => {
    expect([turnSide('created'), roundsForTurn('created')]).toEqual(['a', [1]]);
    expect([turnSide('wait_b_r1r2'), roundsForTurn('wait_b_r1r2')]).toEqual(['b', [1, 2]]);
    expect([turnSide('wait_a_r2r3'), roundsForTurn('wait_a_r2r3')]).toEqual(['a', [2, 3]]);
    expect([turnSide('wait_b_r3'), roundsForTurn('wait_b_r3')]).toEqual(['b', [3]]);
    expect([categoryPicker(1), categoryPicker(2), categoryPicker(3)]).toEqual(['a', 'b', 'a']);

    const done = run([
      { type: 'turn_completed', side: 'a', scoreA: 500, scoreB: 0 },
      { type: 'turn_completed', side: 'b', scoreA: 500, scoreB: 900 },
      { type: 'turn_completed', side: 'a', scoreA: 1400, scoreB: 900 },
      { type: 'turn_completed', side: 'b', scoreA: 1400, scoreB: 1300 },
    ]);
    expect(done).toMatchObject({ state: 'complete', winner: 'a', scoreA: 1400, scoreB: 1300 });
  });

  it('goes to a tie-break on equal scores', () => {
    const tied = run([
      { type: 'turn_completed', side: 'a', scoreA: 300, scoreB: 0 },
      { type: 'turn_completed', side: 'b', scoreA: 300, scoreB: 600 },
      { type: 'turn_completed', side: 'a', scoreA: 900, scoreB: 600 },
      { type: 'turn_completed', side: 'b', scoreA: 900, scoreB: 900 },
    ]);
    expect(tied.state).toBe('tiebreak');
    expect(applyDuelEvent(tied, { type: 'tiebreak_resolved', winner: 'b' })).toMatchObject({
      state: 'complete',
      winner: 'b',
    });
  });

  it('awards a forfeit to the waiting player when a turn expires', () => {
    const waitingOnB = run([{ type: 'turn_completed', side: 'a', scoreA: 400, scoreB: 0 }]);
    expect(applyDuelEvent(waitingOnB, { type: 'expired' })).toMatchObject({ state: 'forfeit', winner: 'a' });
  });

  it('cancels instead when there is nobody to award the win to', () => {
    expect(applyDuelEvent(joined, { type: 'expired' }).state).toBe('cancelled');
    const linkNeverAccepted = run([{ type: 'turn_completed', side: 'a', scoreA: 400, scoreB: 0 }], NEW_DUEL);
    expect(applyDuelEvent(linkNeverAccepted, { type: 'expired' }).state).toBe('cancelled');
  });

  it('allows decline and cancel only before the opponent plays', () => {
    const afterA = run([{ type: 'turn_completed', side: 'a', scoreA: 100, scoreB: 0 }]);
    expect(applyDuelEvent(afterA, { type: 'declined' }).state).toBe('declined');
    const afterB = applyDuelEvent(afterA, { type: 'turn_completed', side: 'b', scoreA: 100, scoreB: 200 });
    expect(() => applyDuelEvent(afterB, { type: 'cancelled' })).toThrow(DuelTransitionError);
  });

  it('rejects a turn by the wrong player or by an opponent who never joined', () => {
    expect(() => applyDuelEvent(joined, { type: 'turn_completed', side: 'b', scoreA: 0, scoreB: 1 })).toThrow(
      DuelTransitionError,
    );
    const linkDuel = run([{ type: 'turn_completed', side: 'a', scoreA: 100, scoreB: 0 }], NEW_DUEL);
    expect(() =>
      applyDuelEvent(linkDuel, { type: 'turn_completed', side: 'b', scoreA: 100, scoreB: 9 }),
    ).toThrow(DuelTransitionError);
    expect(applyDuelEvent(linkDuel, { type: 'opponent_joined' }).opponentJoined).toBe(true);
  });

  it('never skips a state, whatever events arrive', () => {
    const ORDER: DuelState[] = ['created', 'wait_b_r1r2', 'wait_a_r2r3', 'wait_b_r3', 'tiebreak'];
    const event = fc.oneof(
      fc.record({
        type: fc.constant('turn_completed' as const),
        side: fc.constantFrom('a' as const, 'b' as const),
        scoreA: fc.integer({ min: 0, max: 3000 }),
        scoreB: fc.integer({ min: 0, max: 3000 }),
      }),
      fc.constantFrom<DuelEvent>(
        { type: 'opponent_joined' },
        { type: 'expired' },
        { type: 'declined' },
        { type: 'cancelled' },
        { type: 'tiebreak_resolved', winner: 'a' },
      ),
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 30 }), (events) => {
        let duel = NEW_DUEL;
        let lastActive = 0;
        for (const e of events) {
          try {
            duel = applyDuelEvent(duel, e);
          } catch (err) {
            expect(err).toBeInstanceOf(DuelTransitionError);
            continue;
          }
          const index = ORDER.indexOf(duel.state);
          if (index >= 0) {
            expect(index - lastActive).toBeLessThanOrEqual(1);
            expect(index).toBeGreaterThanOrEqual(lastActive);
            lastActive = index;
          }
          if (duel.state === 'complete' || duel.state === 'forfeit') expect(duel.winner).not.toBeNull();
        }
      }),
    );
  });
});

describe('resolveTiebreak', () => {
  it('prefers the closest guess, then the faster answer', () => {
    expect(resolveTiebreak(1992, { guess: 1990, elapsedMs: 9000 }, { guess: 1995, elapsedMs: 2000 })).toBe(
      'a',
    );
    expect(resolveTiebreak(36, { guess: 34, elapsedMs: 5000 }, { guess: 38, elapsedMs: 4000 })).toBe('b');
    expect(resolveTiebreak(36, { guess: 36, elapsedMs: 4000 }, { guess: 36, elapsedMs: 4000 })).toBeNull();
  });
});
