/**
 * Game days run on West Africa Time (Africa/Lagos, UTC+1, no daylight saving).
 * Dates are 'YYYY-MM-DD' strings in WAT. The server's clock decides, never the device's.
 */

const DAY_MS = 86_400_000;
const WAT_OFFSET_MS = 3_600_000;

/** The WAT calendar date of an instant. */
export function watDate(at: Date | number): string {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(ms + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(parseDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

/** ISO-8601 week, e.g. '2026-W45' (weeks start on Monday). */
export function isoWeek(date: string): string {
  const ms = parseDate(date);
  const mondayBased = (new Date(ms).getUTCDay() + 6) % 7;
  const thursday = new Date(ms + (3 - mondayBased) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The Monday that starts `date`'s ISO week. */
export function isoWeekStart(date: string): string {
  return addDays(date, -((new Date(parseDate(date)).getUTCDay() + 6) % 7));
}

/** Daily Sabi Challenge number: #1 on the first Daily. */
export function dailyNumber(date: string, firstDailyDate: string): number {
  return daysBetween(firstDailyDate, date) + 1;
}

export interface StreakState {
  current: number;
  best: number;
  lastPlayDate: string | null;
  /** Streak freezes left this ISO week (one a week, PRD US-8). */
  freezesLeft: number;
  /** ISO week `freezesLeft` belongs to. */
  freezeWeek: string | null;
}

export const NEW_STREAK: StreakState = {
  current: 0,
  best: 0,
  lastPlayDate: null,
  freezesLeft: 1,
  freezeWeek: null,
};

export interface StreakUpdate {
  state: StreakState;
  usedFreeze: boolean;
}

/**
 * Record a completed Daily. Playing the next day extends the streak. Missing exactly
 * one day uses the week's freeze if there is one; the freeze comes from the week the
 * player returns in. Anything longer starts a new streak.
 */
export function recordDailyPlay(previous: StreakState, playDate: string): StreakUpdate {
  const week = isoWeek(playDate);
  const state: StreakState =
    previous.freezeWeek === week ? { ...previous } : { ...previous, freezesLeft: 1, freezeWeek: week };

  if (state.lastPlayDate !== null) {
    const gap = daysBetween(state.lastPlayDate, playDate);
    if (gap <= 0) return { state: previous, usedFreeze: false };
    if (gap === 1) return finish(state, state.current + 1, playDate, false);
    if (gap === 2 && state.freezesLeft > 0) {
      state.freezesLeft -= 1;
      return finish(state, state.current + 1, playDate, true);
    }
  }
  return finish(state, 1, playDate, false);
}

function finish(state: StreakState, current: number, playDate: string, usedFreeze: boolean): StreakUpdate {
  return {
    state: { ...state, current, best: Math.max(state.best, current), lastPlayDate: playDate },
    usedFreeze,
  };
}

function parseDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`expected a YYYY-MM-DD date, got '${date}'`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new RangeError(`'${date}' is not a real date`);
  return ms;
}
