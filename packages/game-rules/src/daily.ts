/**
 * The Daily Sabi Challenge (GDD §2.3, PRD US-8, TRD §4.5): the same 7 questions for everyone,
 * a share grid that gives no answers away, a streak that survives one missed day a week, and
 * the order of the day's leaderboard.
 */
import { addDays, daysBetween, isoWeek, watDate, type StreakState } from './calendar';
import { XP_REWARDS } from './progression';

export const DAILY_QUESTIONS = 7;

export interface DailyCandidate {
  id: string;
  category: string;
  difficulty: number;
  /** WAT date it was last in a Daily, or null if never (within the window the caller looked at). */
  lastUsed: string | null;
}

/**
 * Tomorrow's questions (FR-DAILY-1): one per category, then the categories again in the same
 * random order until there are six, then a hard "boss" as #7. Questions not yet used in a Daily
 * come first, then the ones used longest ago, so a small pool still makes a Daily. The six go
 * from easiest to hardest. Null when there are fewer than seven questions.
 */
export function pickDailyQuestions(
  candidates: readonly DailyCandidate[],
  random: () => number = Math.random,
): string[] | null {
  if (candidates.length < DAILY_QUESTIONS) return null;
  // Fresh first, then oldest use first; ties in a random order.
  const preferred = shuffled(candidates, random).sort((a, b) =>
    (a.lastUsed ?? '').localeCompare(b.lastUsed ?? ''),
  );

  const freshHard = preferred.filter((c) => c.lastUsed === null && c.difficulty >= 4);
  const bossPool = freshHard.length > 0 ? freshHard : preferred;
  const hardest = Math.max(...bossPool.map((c) => c.difficulty));
  const boss = bossPool.find((c) => c.difficulty === hardest)!;

  const byCategory = new Map<string, DailyCandidate[]>();
  for (const c of preferred) {
    if (c === boss) continue;
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  }
  const order = shuffled([...byCategory.keys()], random);
  const picked: DailyCandidate[] = [];
  // Six or more remain after the boss, so each pass adds at least one until there are six.
  while (picked.length < DAILY_QUESTIONS - 1) {
    for (const category of order) {
      const next = byCategory.get(category)?.shift();
      if (next && picked.length < DAILY_QUESTIONS - 1) picked.push(next);
    }
  }
  return [...picked.sort((a, b) => a.difficulty - b.difficulty), boss].map((c) => c.id);
}

export interface StreakView {
  /** The streak as it stands today: 0 once it can no longer be saved. */
  current: number;
  best: number;
  /** Freezes left this ISO week. */
  freezesLeft: number;
  playedToday: boolean;
}

/**
 * A player's streak as it looks on `today` (WAT), before or after they play. Missing yesterday
 * still keeps it alive while this week's freeze is unused (the same rule `recordDailyPlay` applies).
 */
export function streakOn(state: StreakState, today: string): StreakView {
  const freezesLeft = state.freezeWeek === isoWeek(today) ? state.freezesLeft : 1;
  const view: StreakView = { current: 0, best: state.best, freezesLeft, playedToday: false };
  if (state.lastPlayDate === null) return view;
  const gap = daysBetween(state.lastPlayDate, today);
  if (gap <= 0) return { ...view, current: state.current, playedToday: true };
  if (gap === 1 || (gap === 2 && freezesLeft > 0)) return { ...view, current: state.current };
  return view;
}

/** LiveOps can swap a planned Daily's questions until 22:00 WAT the day before (doc 18 §11). */
export const DAILY_EDIT_CUTOFF_HOUR = 22;
export const DAILY_PLAN_DAYS = 30;

/** Whether a Daily on `playDate` can still change at `now`: after today, and before tomorrow's cut-off. */
export function dailyEditable(playDate: string, now: number): boolean {
  const today = watDate(now);
  const ahead = daysBetween(today, playDate);
  if (ahead >= 2) return true;
  return ahead === 1 && new Date(now + 3_600_000).getUTCHours() < DAILY_EDIT_CUTOFF_HOUR;
}

/** Support restores only a streak that broke recently (doc 18 §8), at most once every 30 days. */
export const STREAK_RESTORE_WINDOW_DAYS = 14;
export const STREAK_RESTORE_EVERY_DAYS = 30;

/** The run before the player's current one, from their Daily results. */
export interface LostRun {
  /** Its length: the streak on its last Daily. */
  streak: number;
  /** Its last Daily (WAT). */
  lastPlayDate: string;
}

/**
 * Support's streak restore (doc 18 §8). A streak that broke and was not played since stays alive
 * as if the player had played yesterday; one they have started again joins the run they lost.
 * Only a break in the last 14 days counts. Null when there is nothing to restore.
 */
export function restoreStreak(state: StreakState, today: string, lost: LostRun | null): StreakState | null {
  if (state.lastPlayDate === null) return null;
  const recent = (date: string) => daysBetween(date, today) <= STREAK_RESTORE_WINDOW_DAYS;
  if (streakOn(state, today).current === 0) {
    if (state.current === 0 || !recent(state.lastPlayDate)) return null;
    return { ...state, lastPlayDate: addDays(today, -1) };
  }
  if (!lost || lost.streak <= 0 || !recent(lost.lastPlayDate)) return null;
  const current = state.current + lost.streak;
  return { ...state, current, best: Math.max(state.best, current) };
}

/** 'G' for a right answer and 'R' for a wrong or missing one, in question order (`daily_results.grid`). */
export function dailyGrid(correct: readonly boolean[]): string {
  return correct.map((c) => (c ? 'G' : 'R')).join('');
}

export function gridEmoji(grid: string): string {
  return [...grid].map((c) => (c === 'G' ? '🟩' : '🟥')).join('');
}

export interface DailyShare {
  number: number;
  correct: number;
  total: number;
  totalMs: number;
  grid: string;
  streak: number;
  url: string;
}

/**
 * The share text (PRD US-8 AC2): squares, score, time and streak, never the answers.
 *   Who Sabi? #142 6/7 ⏱ 58s
 *   🟩🟩🟩🟥🟩🟩🟩 🔥12
 *   whosabi.ng/daily/142
 */
export function dailyShareText(share: DailyShare): string {
  const seconds = Math.round(share.totalMs / 1000);
  const streak = share.streak > 1 ? ` 🔥${share.streak}` : '';
  return `Who Sabi? #${share.number} ${share.correct}/${share.total} ⏱ ${seconds}s\n${gridEmoji(share.grid)}${streak}\n${share.url}`;
}

/** XP for a finished Daily (GDD §5.1): per answer, plus the finish. */
export function dailyXp(correct: number, total: number = DAILY_QUESTIONS): number {
  return (
    correct * XP_REWARDS.correctAnswer + (total - correct) * XP_REWARDS.wrongAnswer + XP_REWARDS.matchComplete
  );
}

const TIME_SLOTS = 1_000_000;

/** The day's sorted-set score: more points first, then the faster total time (TRD §5.5). */
export function dailyBoardScore(score: number, totalMs: number): number {
  const ms = Math.min(Math.max(0, Math.round(totalMs)), TIME_SLOTS - 1);
  return score * TIME_SLOTS + (TIME_SLOTS - 1 - ms);
}

export function pointsFromBoardScore(value: number): number {
  return Math.floor(value / TIME_SLOTS);
}

/** "You sabi pass N% of Naija today": the share of the other players who did worse. */
export function percentBeaten(below: number, players: number): number | null {
  if (players <= 1) return null;
  return Math.floor((100 * below) / (players - 1));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
