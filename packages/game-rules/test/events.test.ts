import { describe, expect, it } from 'vitest';
import { boostedDuelXp, duelXp, eventLive } from '../src';

describe('live events (step 2.7h)', () => {
  it('runs from its start until its end, unless ended early', () => {
    const event = { starts_at: 100, ends_at: 200, ended_at: null };
    expect([99, 100, 199, 200].map((t) => eventLive(event, t))).toEqual([false, true, true, false]);
    expect(eventLive({ ...event, ended_at: 150 }, 120)).toBe(false);
  });

  it('pays double XP for the answers in the boosted category only', () => {
    const answers = [
      { correct: true, category: 'music' },
      { correct: false, category: 'music' },
      { correct: true, category: 'food' },
    ];
    const plain = duelXp(2, 3, true);
    expect(boostedDuelXp(answers, true, [])).toBe(plain);
    // Music's answers again: 10 + 2.
    expect(boostedDuelXp(answers, true, [{ category: 'music', multiplier: 2 }])).toBe(plain + 12);
    // Every category: all the answers again, not the 50 for finishing.
    expect(boostedDuelXp(answers, true, [{ category: null, multiplier: 2 }])).toBe(plain + 22);
    expect(boostedDuelXp(answers, false, [{ category: 'sport', multiplier: 2 }])).toBe(duelXp(2, 3, false));
    // Two at once: each answer counts once, at its biggest boost.
    expect(
      boostedDuelXp(answers, true, [
        { category: 'music', multiplier: 2 },
        { category: 'food', multiplier: 2 },
        { category: null, multiplier: 2 },
      ]),
    ).toBe(plain + 22);
  });
});
