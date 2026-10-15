import { describe, expect, it } from 'vitest';
import {
  addDays,
  dailyNumber,
  daysBetween,
  isoWeek,
  NEW_STREAK,
  recordDailyPlay,
  watDate,
} from '../src/calendar';

describe('WAT dates', () => {
  it('rolls over at midnight WAT (23:00 UTC), not midnight UTC', () => {
    expect(watDate(Date.UTC(2026, 10, 2, 22, 59, 59))).toBe('2026-11-02');
    expect(watDate(Date.UTC(2026, 10, 2, 23, 0, 0))).toBe('2026-11-03');
    expect(watDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('does date arithmetic across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(daysBetween('2026-11-02', '2026-11-30')).toBe(28);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });

  it('computes ISO weeks, including 53-week years', () => {
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2026-11-02')).toBe('2026-W45');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2027-01-04')).toBe('2027-W01');
  });

  it('numbers the Daily from the first one', () => {
    expect(dailyNumber('2027-03-01', '2027-03-01')).toBe(1);
    expect(dailyNumber('2027-07-20', '2027-03-01')).toBe(142);
  });
});

describe('recordDailyPlay', () => {
  const play = (dates: string[]) => {
    let state = NEW_STREAK;
    const freezes: boolean[] = [];
    for (const d of dates) {
      const r = recordDailyPlay(state, d);
      state = r.state;
      freezes.push(r.usedFreeze);
    }
    return { state, freezes };
  };

  it('grows on consecutive days and remembers the best', () => {
    const { state } = play(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-08', '2026-11-09']);
    expect(state).toMatchObject({ current: 2, best: 3, lastPlayDate: '2026-11-09' });
  });

  it('uses one freeze a week to bridge a single missed day', () => {
    const { state, freezes } = play(['2026-11-02', '2026-11-04', '2026-11-06']);
    expect(freezes).toEqual([false, true, false]);
    expect(state.current).toBe(1); // the second gap in the same week breaks the streak
  });

  it('gives a fresh freeze when the player comes back in a new ISO week', () => {
    // Sat 7 Nov, miss Sun 8 Nov, back Mon 9 Nov (new week, after using last week's freeze).
    const { state, freezes } = play([
      '2026-11-02',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-09',
    ]);
    expect(freezes).toEqual([false, true, false, false, false, true]);
    expect(state.current).toBe(6);
    expect(state.freezeWeek).toBe('2026-W46');
  });

  it('ignores a second play on the same day and resets after a long break', () => {
    const once = play(['2026-11-02', '2026-11-02']).state;
    expect(once.current).toBe(1);
    expect(play(['2026-11-02', '2026-11-03', '2026-11-10']).state.current).toBe(1);
  });
});
