import { describe, expect, it } from 'vitest';
import { answerKey, currentRound, isUrgent, playerName, timeLeft } from './format';

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const inMs = (ms: number) => new Date(NOW + ms).toISOString();

describe('timeLeft', () => {
  it('counts whole hours, then minutes in the last hour', () => {
    expect(timeLeft(inMs(41.9 * 3_600_000), NOW)).toEqual({ hours: 41 });
    expect(timeLeft(inMs(3_600_000), NOW)).toEqual({ hours: 1 });
    expect(timeLeft(inMs(59 * 60_000 + 1), NOW)).toEqual({ minutes: 60 });
    expect(timeLeft(inMs(10_000), NOW)).toEqual({ minutes: 1 });
  });

  it('is null with no deadline or once it has passed', () => {
    expect(timeLeft(null, NOW)).toBeNull();
    expect(timeLeft(inMs(0), NOW)).toBeNull();
    expect(timeLeft(inMs(-5_000), NOW)).toBeNull();
  });

  it('marks the last 6 hours as urgent', () => {
    expect(isUrgent(inMs(5.9 * 3_600_000), NOW)).toBe(true);
    expect(isUrgent(inMs(6 * 3_600_000), NOW)).toBe(false);
    expect(isUrgent(inMs(-1), NOW)).toBe(false);
  });
});

describe('duel helpers', () => {
  it('names guests and missing opponents', () => {
    expect(playerName({ id: 'u', username: 'Tolu', level: 3 }, 'Guest', 'nobody')).toBe('Tolu');
    expect(playerName({ id: 'u', username: null, level: 1 }, 'Guest', 'nobody')).toBe('Guest');
    expect(playerName(null, 'Guest', 'nobody')).toBe('nobody');
  });

  it('knows the round from the state', () => {
    expect(currentRound('created')).toBe(1);
    expect(currentRound('wait_a_r2r3')).toBe(2);
    expect(currentRound('wait_b_r3')).toBe(3);
  });

  it('makes idempotency keys the API accepts', () => {
    const key = answerKey('d_01JABCDEF.ghi', 2, 3);
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(key).toBe(answerKey('d_01JABCDEF.ghi', 2, 3));
    expect(answerKey('x'.repeat(100), 1, 1)).toHaveLength(64);
  });
});
