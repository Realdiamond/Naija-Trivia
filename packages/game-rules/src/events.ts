/**
 * Live events (doc 16 §2, build plan step 2.7h). Staff schedule them in the console; each shows
 * as a Home banner while it runs. Weekend Wahala pays double XP for duel answers in one
 * category (or in all of them).
 */
import { duelXp } from './economy';
import { XP_REWARDS } from './progression';

/** A plain Home banner, or Weekend Wahala's double XP. */
export const LIVE_EVENT_KINDS = ['banner', 'double_xp'] as const;
export type LiveEventKind = (typeof LIVE_EVENT_KINDS)[number];

/** Screens a Home banner can open. */
export const BANNER_ACTIONS = [
  'daily',
  'random',
  'party',
  'challenge',
  'leaderboards',
  'shop',
  'friends',
] as const;
export type BannerAction = (typeof BANNER_ACTIONS)[number];

export const XP_BOOST_MULTIPLIER = 2;
/** Events run at most this long (a Season is the longest template, doc 16 §2). */
export const MAX_EVENT_DAYS = 90;
/** Home shows at most this many banners at once, newest first. */
export const MAX_HOME_BANNERS = 2;

export interface XpBoost {
  /** null: every category. */
  category: string | null;
  multiplier: number;
}

/** Live from `starts_at` until `ends_at` (exclusive), unless staff ended it early. */
export function eventLive(
  event: { starts_at: number; ends_at: number; ended_at: number | null },
  now: number,
): boolean {
  return event.ended_at === null && event.starts_at <= now && now < event.ends_at;
}

/**
 * A duel's XP with the boosts running: the usual XP (duelXp), plus each boosted answer's XP again
 * for every extra multiple (the biggest boost covering its category). Seeing the duel through
 * earns the usual 50.
 */
export function boostedDuelXp(
  answers: readonly { correct: boolean; category: string | null }[],
  finished: boolean,
  boosts: readonly XpBoost[],
): number {
  let xp = duelXp(answers.filter((a) => a.correct).length, answers.length, finished);
  for (const answer of answers) {
    const multiplier = Math.max(
      1,
      ...boosts.filter((b) => b.category === null || b.category === answer.category).map((b) => b.multiplier),
    );
    xp += (answer.correct ? XP_REWARDS.correctAnswer : XP_REWARDS.wrongAnswer) * (multiplier - 1);
  }
  return xp;
}
