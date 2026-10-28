/**
 * The Daily Sabi Challenge and leaderboards (doc 09 §2.6, PRD US-8, TRD §4.5, §5.5): the same
 * 7 questions for everyone from 00:00 to 23:59 WAT, played once, with the same serve → answer
 * contract as duels, then a shareable grid, the streak and the day's and week's boards.
 */
import { z } from 'zod';
import { HomeState, Tier } from './profile';
import { AnswerResponse } from './rounds';

export const DailyStreak = z.object({
  /** As it stands today: 0 once it can no longer be saved. */
  current: z.number().int().min(0),
  best: z.number().int().min(0),
  /** One free freeze a week covers one missed day (PRD US-8 AC3). */
  freezes_left: z.number().int().min(0),
});
export type DailyStreak = z.infer<typeof DailyStreak>;

export const DailyToday = z.object({
  /** The Daily's number, as in "Daily Sabi #142". */
  id: z.number().int().positive(),
  /** WAT date. */
  date: z.iso.date(),
  total: z.number().int().positive(),
  /** Category of each question; the last is the boss. */
  categories: z.array(z.string()),
  /** Finished today's Daily. */
  played: z.boolean(),
  /** Questions answered so far, to pick up where the player stopped. */
  answered: z.number().int().min(0),
  streak: DailyStreak,
  /** Midnight WAT, when the next Daily starts. */
  closes_at: z.iso.datetime(),
});
export type DailyToday = z.infer<typeof DailyToday>;

/** The answer reply, plus whether that was the last question. */
export const DailyAnswerResponse = AnswerResponse.extend({ finished: z.boolean() });
export type DailyAnswerResponse = z.infer<typeof DailyAnswerResponse>;

export const DailyReviewItem = z.object({
  seq: z.number().int().positive(),
  category_id: z.string(),
  text: z.string(),
  answer: z.string(),
  correct: z.boolean(),
  fact: z.string().nullable(),
});

export const DailyResult = z.object({
  id: z.number().int().positive(),
  date: z.iso.date(),
  total: z.number().int().positive(),
  correct_count: z.number().int().min(0),
  score: z.number().int().min(0),
  total_ms: z.number().int().min(0),
  /** 'G' right, 'R' wrong, in question order. */
  grid: z.string(),
  categories: z.array(z.string()),
  /** The share of today's other players you beat; null while you are the only one. */
  percentile: z.number().int().min(0).max(100).nullable(),
  players: z.number().int().min(0),
  /** Your place on your home state's board, when you have one. */
  state: z
    .object({ code: HomeState, rank: z.number().int().positive(), players: z.number().int() })
    .nullable(),
  /** The state with the best average today (at least 3 players). */
  leading_state: HomeState.nullable(),
  /** The streak after this Daily, and whether the week's freeze saved it. */
  streak: DailyStreak.extend({ used_freeze: z.boolean() }),
  xp: z.number().int().min(0),
  share_text: z.string(),
  share_url: z.string(),
  /** The questions, right answers and facts ("See answers and facts"). */
  review: z.array(DailyReviewItem),
});
export type DailyResult = z.infer<typeof DailyResult>;

export const LeaderboardScope = z.enum(['global', 'state', 'friends']);
export type LeaderboardScope = z.infer<typeof LeaderboardScope>;

export const LeaderboardQuery = z.object({ scope: LeaderboardScope.default('global') });

export const LeaderboardEntry = z.object({
  rank: z.number().int().positive(),
  /** Guests and 13–17s have no public name (doc 10 §3.3): the app shows "Guest" or "Player from Lagos". */
  kind: z.enum(['player', 'guest', 'restricted']),
  username: z.string().nullable(),
  avatar_id: z.string().nullable(),
  home_state: HomeState.nullable(),
  level: z.number().int(),
  tier: Tier,
  score: z.number().int(),
  you: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const LeaderboardResponse = z.object({
  board: z.enum(['daily', 'week']),
  /** The Daily's number, or the ISO week such as '2026-W45'. */
  period: z.string(),
  scope: LeaderboardScope,
  /** The state shown on a state board; null when the player has no home state. */
  state: HomeState.nullable(),
  players: z.number().int().min(0),
  resets_at: z.iso.datetime(),
  /** The top 100. */
  entries: z.array(LeaderboardEntry),
  /** Your own line, also when you are outside the top 100; null if you have not played. */
  me: LeaderboardEntry.nullable(),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;
