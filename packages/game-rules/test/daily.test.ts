import { describe, expect, it } from 'vitest';
import { NEW_STREAK, recordDailyPlay } from '../src/calendar';
import {
  dailyBoardScore,
  dailyGrid,
  dailyShareText,
  dailyXp,
  percentBeaten,
  pickDailyQuestions,
  pointsFromBoardScore,
  dailyEditable,
  restoreStreak,
  streakOn,
  type DailyCandidate,
} from '../src/daily';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const CATEGORIES = ['slang', 'nollywood', 'music', 'food', 'mixed'];

function pool(perCategory: number, difficulty = (i: number) => (i % 3) + 1): DailyCandidate[] {
  return CATEGORIES.flatMap((category) =>
    Array.from({ length: perCategory }, (_, i) => ({
      id: `${category}-${i}`,
      category,
      difficulty: difficulty(i),
      lastUsed: null,
    })),
  );
}

describe('picking the Daily', () => {
  it('takes one question per category, a sixth from a repeat, and the hardest as the boss', () => {
    const candidates = pool(4);
    candidates.push({ id: 'boss', category: 'music', difficulty: 5, lastUsed: null });
    const ids = pickDailyQuestions(candidates, seeded(1))!;
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids[6]).toBe('boss');
    const categories = ids.slice(0, 6).map((id) => candidates.find((c) => c.id === id)!.category);
    expect(new Set(categories)).toEqual(new Set(CATEGORIES));
    const difficulties = ids.slice(0, 6).map((id) => candidates.find((c) => c.id === id)!.difficulty);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
  });

  it('prefers questions never used in a Daily, then the ones used longest ago', () => {
    const candidates: DailyCandidate[] = pool(2).map((c) => ({ ...c, lastUsed: '2026-10-01' }));
    candidates.push({ id: 'old', category: 'food', difficulty: 1, lastUsed: '2026-01-05' });
    candidates.push({ id: 'new', category: 'slang', difficulty: 1, lastUsed: null });
    for (let seed = 1; seed < 20; seed++) {
      const ids = pickDailyQuestions(candidates, seeded(seed))!;
      expect(ids).toContain('new');
      expect(ids).toContain('old');
    }
  });

  it('keeps a fresh hard question for the boss over a harder one used before', () => {
    const candidates = pool(3);
    candidates.push({ id: 'used-5', category: 'mixed', difficulty: 5, lastUsed: '2026-10-01' });
    candidates.push({ id: 'fresh-4', category: 'food', difficulty: 4, lastUsed: null });
    expect(pickDailyQuestions(candidates, seeded(3))![6]).toBe('fresh-4');
  });

  it('still makes a Daily from fewer categories, and none from fewer than 7 questions', () => {
    const two: DailyCandidate[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({
      id,
      category: i % 2 ? 'food' : 'slang',
      difficulty: 2,
      lastUsed: null,
    }));
    expect(pickDailyQuestions(two, seeded(4))).toHaveLength(7);
    expect(pickDailyQuestions(two.slice(0, 6), seeded(4))).toBeNull();
  });
});

describe('streaks as the player sees them', () => {
  const played = (dates: string[]) => dates.reduce((s, d) => recordDailyPlay(s, d).state, NEW_STREAK);

  it('shows the streak while it can still be extended, and 0 once it is lost', () => {
    const s = played(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(streakOn(s, '2026-11-04')).toMatchObject({ current: 3, playedToday: true });
    expect(streakOn(s, '2026-11-05')).toMatchObject({ current: 3, playedToday: false });
    // Missed the 5th: this week's freeze keeps it alive on the 6th.
    expect(streakOn(s, '2026-11-06')).toMatchObject({ current: 3, freezesLeft: 1 });
    expect(streakOn(s, '2026-11-07').current).toBe(0);
  });

  it('agrees with recordDailyPlay once the freeze is spent', () => {
    // Monday 2 Nov, then Wednesday 4 Nov (freeze used), then Friday 6 Nov: no freeze left.
    const s = played(['2026-11-02', '2026-11-04']);
    expect(s.current).toBe(2);
    expect(streakOn(s, '2026-11-06')).toMatchObject({ current: 0, freezesLeft: 0 });
    expect(recordDailyPlay(s, '2026-11-06').state.current).toBe(1);
    // A new ISO week brings a new freeze.
    const later = played(['2026-11-07']);
    expect(streakOn(later, '2026-11-09')).toMatchObject({ current: 1, freezesLeft: 1 });
  });

  it('is 0 for someone who never played', () => {
    expect(streakOn(NEW_STREAK, '2026-11-02')).toEqual({
      current: 0,
      best: 0,
      freezesLeft: 1,
      playedToday: false,
    });
  });
});

describe('the result', () => {
  it('builds the grid and a share text without answers', () => {
    const grid = dailyGrid([true, true, true, false, true, true, true]);
    expect(grid).toBe('GGGRGGG');
    expect(
      dailyShareText({
        number: 142,
        correct: 6,
        total: 7,
        totalMs: 58_400,
        grid,
        streak: 12,
        url: 'whosabi.ng/daily/142',
      }),
    ).toBe('Who Sabi? #142 6/7 ⏱ 58s\n🟩🟩🟩🟥🟩🟩🟩 🔥12\nwhosabi.ng/daily/142');
    expect(
      dailyShareText({ number: 1, correct: 0, total: 7, totalMs: 1, grid: 'RRRRRRR', streak: 1, url: 'x' }),
    ).toBe('Who Sabi? #1 0/7 ⏱ 0s\n🟥🟥🟥🟥🟥🟥🟥\nx');
  });

  it('gives the XP from the mockup: 6 of 7 is 112', () => {
    expect(dailyXp(6)).toBe(112);
    expect(dailyXp(0)).toBe(64);
  });

  it('orders the board by points, then by the faster time', () => {
    const fastLow = dailyBoardScore(900, 20_000);
    const slowHigh = dailyBoardScore(901, 100_000);
    const fastHigh = dailyBoardScore(901, 50_000);
    expect(slowHigh).toBeGreaterThan(fastLow);
    expect(fastHigh).toBeGreaterThan(slowHigh);
    expect(pointsFromBoardScore(fastHigh)).toBe(901);
    expect(pointsFromBoardScore(dailyBoardScore(1960, 0))).toBe(1960);
  });

  it('says how many of the others you beat', () => {
    expect(percentBeaten(0, 1)).toBeNull();
    expect(percentBeaten(9, 10)).toBe(100);
    expect(percentBeaten(0, 10)).toBe(0);
    expect(percentBeaten(41, 51)).toBe(82);
  });
});

describe('restoreStreak', () => {
  const played = (dates: string[]) => dates.reduce((s, d) => recordDailyPlay(s, d).state, NEW_STREAK);

  it('keeps a broken streak alive when the player has not played since', () => {
    const s = played(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06']);
    expect(streakOn(s, '2026-11-10').current).toBe(0);
    const restored = restoreStreak(s, '2026-11-10', null)!;
    expect(restored).toMatchObject({ current: 4, lastPlayDate: '2026-11-09' });
    expect(streakOn(restored, '2026-11-10')).toMatchObject({ current: 4, playedToday: false });
    expect(recordDailyPlay(restored, '2026-11-10').state.current).toBe(5);
  });

  it('joins the lost run to the one started since', () => {
    const s = played(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-08', '2026-11-09']);
    expect(s.current).toBe(2);
    const restored = restoreStreak(s, '2026-11-09', { streak: 3, lastPlayDate: '2026-11-04' })!;
    expect(restored).toMatchObject({ current: 5, best: 5, lastPlayDate: '2026-11-09' });
  });

  it('has nothing to restore for an old break, a live unbroken streak or a new player', () => {
    const s = played(['2026-11-02', '2026-11-03']);
    expect(restoreStreak(s, '2026-11-30', null)).toBeNull();
    expect(restoreStreak(s, '2026-11-04', null)).toBeNull();
    const again = played(['2026-10-01', '2026-11-08']);
    expect(restoreStreak(again, '2026-11-09', { streak: 1, lastPlayDate: '2026-10-01' })).toBeNull();
    expect(restoreStreak(NEW_STREAK, '2026-11-09', null)).toBeNull();
  });
});

describe('dailyEditable', () => {
  // 2 November 2026, as WAT hours.
  const at = (hour: number, day = 2) => Date.UTC(2026, 10, day, hour - 1, 0);
  it('lets a Daily change until 22:00 WAT the day before, never on its day or after', () => {
    expect(dailyEditable('2026-11-05', at(23))).toBe(true);
    expect(dailyEditable('2026-11-03', at(21))).toBe(true);
    expect(dailyEditable('2026-11-03', at(22))).toBe(false);
    expect(dailyEditable('2026-11-02', at(9))).toBe(false);
    expect(dailyEditable('2026-11-01', at(9))).toBe(false);
  });
});
