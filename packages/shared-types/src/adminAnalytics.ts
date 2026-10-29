/**
 * The console's analytics dashboards (doc 18 §9–10, build plan steps 2.7j–2.7k). Every dashboard
 * takes the same filters: a range of WAT days and a platform. Each metric follows its one definition in
 * doc 18 §10. Read from Postgres at launch; ClickHouse takes over in M3 without changing these.
 */
import { z } from 'zod';
import type { AdminPermission, MoneyByCurrency } from './admin';
import { Platform } from './common';

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ANALYTICS_BOARDS = [
  'engagement',
  'growth',
  'retention',
  'gameplay',
  'monetisation',
  'economy',
] as const;
export const AnalyticsBoard = z.enum(ANALYTICS_BOARDS);
export type AnalyticsBoard = z.infer<typeof AnalyticsBoard>;

/** Who may open each dashboard (doc 18 §3). */
export const ANALYTICS_BOARD_PERMISSION: Record<AnalyticsBoard, AdminPermission> = {
  engagement: 'analytics.kpi',
  growth: 'analytics.kpi',
  retention: 'analytics.kpi',
  gameplay: 'analytics.product',
  monetisation: 'analytics.money',
  economy: 'analytics.money',
};

/** The longest range a dashboard covers in one go. */
export const ANALYTICS_MAX_DAYS = 92;

export const AnalyticsQuery = z.object({
  /** First and last WAT day, both included; the last 30 days to today when left out. */
  from: IsoDay.optional(),
  to: IsoDay.optional(),
  platform: z.union([Platform, z.literal('all')]).default('all'),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export interface AnalyticsRange {
  from: string;
  to: string;
  platform: Platform | 'all';
}

/** Engagement & time (doc 18 §9). */
export interface EngagementBoard extends AnalyticsRange {
  board: 'engagement';
  summary: {
    /** The average day's players over the range. */
    dau: number;
    /** Players in the 7 and 30 days up to the range's last day. */
    wau: number;
    mau: number;
    /** Average DAU ÷ MAU, 0–1. */
    stickiness: number;
    sessions_per_dau: number;
    minutes_per_dau: number;
    /** Dailies finished ÷ Dailies started, 0–1; null before anyone starts one. */
    daily_completion: number | null;
  };
  days: Array<{
    day: string;
    dau: number;
    sessions: number;
    minutes: number;
    daily_started: number;
    daily_completed: number;
  }>;
  /** Sessions by how long the app was in front (`time_spent`). */
  session_lengths: Array<{ bucket: string; sessions: number }>;
  /** Time on each screen, from players who allow behaviour analytics; the 12 longest. */
  screens: Array<{ screen: string; minutes: number }>;
  /** Players by weekday (0 = Monday) and WAT hour, for the heatmap. */
  hours: Array<{ weekday: number; hour: number; players: number }>;
}

/** Growth & invites (doc 18 §9). */
export interface GrowthBoard extends AnalyticsRange {
  board: 'growth';
  summary: {
    new_players: number;
    signups: number;
    invites_shared: number;
    invites_opened: number;
    /** Invites shared per new player × invites opened per invite shared; null without new players. */
    k_factor: number | null;
    /** Of the new players who first came on the web: how many signed up, and how many later played in the app. */
    web_new_players: number;
    web_to_account: number;
    web_to_app: number;
  };
  days: Array<{
    day: string;
    new_players: number;
    android: number;
    ios: number;
    web: number;
    signups: number;
  }>;
  /** How new players' first open came about. */
  sources: Array<{ source: string; players: number }>;
  signup_methods: Array<{ method: string; signups: number }>;
  /** Invites by where they were shared, then where they were opened. */
  invite_channels: Array<{ channel: string; shared: number }>;
  invites_opened_by: Array<{ type: string; in_app: number; on_web: number }>;
}

/** Retention (doc 18 §9): cohorts of new players by the week they first played. */
export interface RetentionBoard extends AnalyticsRange {
  board: 'retention';
  /** Each share is 0–1, or null while the day has not come yet for the whole cohort. */
  summary: { d1: number | null; d7: number | null; d30: number | null };
  cohorts: Array<{
    /** The Monday the week starts. */
    week: string;
    players: number;
    d1: number | null;
    d7: number | null;
    d30: number | null;
  }>;
  /** Share of all new players in the range active again n days later, n = 0…30. */
  curve: Array<{ day: number; share: number | null }>;
}

/**
 * Gameplay (doc 18 §9). Matches come from the game's own tables and count every platform; answers
 * and lifelines come from the events and follow the platform filter.
 */
export interface GameplayBoard extends AnalyticsRange {
  board: 'gameplay';
  summary: {
    duels_finished: number;
    /** Forfeits ÷ duels finished (forfeits included), 0–1; null without any. */
    forfeit_rate: number | null;
    /** The middle duel's time from start to finish, in hours; null without any. */
    duel_hours_median: number | null;
    party_games: number;
    /** Average players a party game, and the share of them playing as web guests (0–1). */
    party_players_avg: number | null;
    web_guest_share: number | null;
    dailies_finished: number;
    /** Right answers ÷ answers, 0–1. */
    correct_rate: number | null;
  };
  days: Array<{ day: string; duels: number; party_games: number; dailies: number }>;
  /** What became of the duels started in the range. */
  duel_outcomes: Array<{ outcome: string; duels: number }>;
  /** How the duels started in the range were set up: a friend, a random opponent, a link… */
  duel_sources: Array<{ source: string; duels: number }>;
  party_sizes: Array<{ size: string; games: number }>;
  /** Dailies finished by right answers, 0–7. */
  daily_scores: Array<{ correct: number; players: number }>;
  categories: Array<{ category: string; answers: number; correct_rate: number }>;
  lifelines: Array<{ type: string; with_coins: number; with_ads: number }>;
}

/**
 * Monetisation (doc 18 §9): store purchases (real ones only, as on Commerce) and ads. Money from
 * the stores is in naira; ad money is AdMob's estimate in the currency it reports.
 */
export interface MonetisationBoard extends AnalyticsRange {
  board: 'monetisation';
  summary: {
    store_revenue_ngn: number;
    purchases: number;
    refunds: number;
    payers: number;
    /** Players who paid ÷ players active in the range, 0–1. */
    payer_conversion: number | null;
    /** Store naira per player who paid, and per player-day (ARPPU, ARPDAU). */
    arppu_ngn: number | null;
    arpdau_ngn: number | null;
    /** AdMob's estimate, by currency. */
    ad_revenue: MoneyByCurrency;
    ads_shown: number;
    /** Ads shown ÷ ads asked for, 0–1. */
    fill_rate: number | null;
    rewarded_views: number;
    rewarded_per_dau: number | null;
  };
  days: Array<{
    day: string;
    store_ngn: number;
    purchases: number;
    rewarded_views: number;
    ads_shown: number;
  }>;
  by_product: Array<{ product_id: string; purchases: number; revenue_ngn: number }>;
  /** Ads shown by format and placement. */
  ad_placements: Array<{ format: string; placement: string; shown: number }>;
}

/** Economy (doc 18 §9): coins earned and spent on players' balances; every platform. */
export interface EconomyBoard extends AnalyticsRange {
  board: 'economy';
  summary: {
    earned: number;
    spent: number;
    /** Coins earned ÷ coins spent: above 1, more coins are coming in than going out. */
    inflation: number | null;
    /** Today's balances: players holding coins, and the middle balance among them. */
    holders: number;
    balance_median: number | null;
  };
  days: Array<{ day: string; earned: number; spent: number }>;
  /** Where coins came from and went, by ledger reason (a guest's coins moving into an account are neither). */
  sources: Array<{ reason: string; coins: number }>;
  sinks: Array<{ reason: string; coins: number }>;
  balances: Array<{ bucket: string; players: number }>;
}

export type AnalyticsResponse =
  EngagementBoard | GrowthBoard | RetentionBoard | GameplayBoard | MonetisationBoard | EconomyBoard;
