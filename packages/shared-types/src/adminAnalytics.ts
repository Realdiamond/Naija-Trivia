/**
 * The console's analytics dashboards (doc 18 §9–10, build plan steps 2.7j–2.7l). Every dashboard
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
  'funnels',
  'gameplay',
  'content',
  'monetisation',
  'economy',
  'tech',
  'integrity',
] as const;
export const AnalyticsBoard = z.enum(ANALYTICS_BOARDS);
export type AnalyticsBoard = z.infer<typeof AnalyticsBoard>;

/** Who may open each dashboard (doc 18 §3). */
export const ANALYTICS_BOARD_PERMISSION: Record<AnalyticsBoard, AdminPermission> = {
  engagement: 'analytics.kpi',
  growth: 'analytics.kpi',
  retention: 'analytics.kpi',
  funnels: 'analytics.kpi',
  gameplay: 'analytics.product',
  content: 'analytics.content',
  monetisation: 'analytics.money',
  economy: 'analytics.money',
  tech: 'analytics.tech',
  integrity: 'analytics.integrity',
};

/** Ready-made funnels (doc 18 §9): each step is any of its events, done after the step before. */
export const READY_FUNNELS: Record<
  string,
  { title: string; steps: Array<{ label: string; events: string[] }> }
> = {
  first_time: {
    title: 'First time',
    steps: [
      { label: 'Opened the app', events: ['first_opened'] },
      { label: 'Finished the taste test', events: ['taste_test_completed'] },
      { label: 'Finished a match', events: ['duel_completed', 'party_game_completed', 'daily_completed'] },
      { label: 'Signed up', events: ['signup_completed'] },
    ],
  },
  daily: {
    title: 'Daily',
    steps: [
      { label: 'Started the Daily', events: ['daily_started'] },
      { label: 'Finished it', events: ['daily_completed'] },
      { label: 'Shared the result', events: ['daily_shared'] },
    ],
  },
  duel: {
    title: 'Duel',
    steps: [
      { label: 'Started a duel', events: ['duel_created'] },
      { label: 'Played a round', events: ['duel_round_played'] },
      { label: 'Finished a duel', events: ['duel_completed'] },
    ],
  },
  party: {
    title: 'Party room',
    steps: [
      { label: 'Made a room', events: ['party_room_created'] },
      { label: 'Finished a game', events: ['party_game_completed'] },
    ],
  },
  purchase: {
    title: 'Purchase',
    steps: [
      { label: 'Opened the shop', events: ['store_viewed'] },
      { label: 'Started paying', events: ['purchase_started'] },
      { label: 'Paid', events: ['purchase_completed'] },
    ],
  },
};
/** A funnel built on the page: 2–5 events in order, each within the window of the first. */
export const FUNNEL_MAX_STEPS = 5;

/** The longest range a dashboard covers in one go. */
export const ANALYTICS_MAX_DAYS = 92;

export const AnalyticsQuery = z.object({
  /** First and last WAT day, both included; the last 30 days to today when left out. */
  from: IsoDay.optional(),
  to: IsoDay.optional(),
  platform: z.union([Platform, z.literal('all')]).default('all'),
  /** Funnels only: a ready-made funnel, or `custom` with its event names in order. */
  funnel: z.string().max(40).optional(),
  steps: z.string().max(400).optional(),
  /** Funnels only: hours from the first step for the others to happen (1 to 168; 24 by default). */
  window: z.coerce.number().int().min(1).max(168).optional(),
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

/**
 * Funnels (doc 18 §9): players who did the first step in the range, then each next step after
 * the one before and within the window of the first. A player is their account once signed in,
 * their device before (as everywhere on these dashboards).
 */
export interface FunnelsBoard extends AnalyticsRange {
  board: 'funnels';
  /** A ready-made funnel's id, or `custom`. */
  funnel: string;
  window_hours: number;
  steps: Array<{
    label: string;
    events: string[];
    players: number;
    /** Of the first step's players, and of the step before's; null for the first step. */
    of_first: number | null;
    of_previous: number | null;
  }>;
  ready: Array<{ id: string; title: string }>;
  /** Every event a funnel can use. */
  events: string[];
}

/** Content performance (doc 18 §9): how questions play, from the answers in the range. */
export interface ContentBoard extends AnalyticsRange {
  board: 'content';
  summary: {
    answers: number;
    questions_played: number;
    correct_rate: number | null;
    reports: number;
    /** Question reports per 1,000 answers (`reports_per_1k`). */
    reports_per_1k: number | null;
    /** Questions with at least 30 answers that 90% or more got right, or 15% or fewer. */
    too_easy: number;
    too_hard: number;
  };
  categories: Array<{
    category: string;
    answers: number;
    correct_rate: number;
    avg_ms: number;
    reports: number;
  }>;
  /** The 50 most-played questions. */
  questions: Array<{
    id: string;
    text: string;
    category: string;
    difficulty: number;
    plays: number;
    correct_rate: number;
    avg_ms: number;
    reports: number;
    flag: 'too_easy' | 'too_hard' | null;
  }>;
}

/** Platforms & tech health (doc 18 §9), from what the apps and the server report. */
export interface TechBoard extends AnalyticsRange {
  board: 'tech';
  summary: {
    /** Cold starts: the middle one and the slowest tenth, in ms. */
    cold_start_p50_ms: number | null;
    cold_start_p90_ms: number | null;
    /** Sign-in codes verified ÷ sent; pushes opened ÷ sent; connections back ÷ lost. */
    otp_success: number | null;
    push_opened: number | null;
    reconnected: number | null;
    /** Web vitals at the 75th percentile (Google's mark). */
    web_lcp_p75_ms: number | null;
    web_inp_p75_ms: number | null;
    web_cls_p75: number | null;
  };
  cold_start_by_ram: Array<{ ram: string; opens: number; p50_ms: number | null }>;
  versions: Array<{ platform: string; app_version: string; players: number }>;
  otp: Array<{ provider: string; sent: number; verified: number; failed: number }>;
  push: Array<{ type: string; sent: number; received: number; opened: number }>;
  connection: Array<{ mode: string; lost: number; restored: number; gap_p50_ms: number | null }>;
}

/** Integrity (doc 18 §9): the nightly checks' flags and what moderators did. Every platform. */
export interface IntegrityBoard extends AnalyticsRange {
  board: 'integrity';
  summary: { flags: number; open_now: number; dismissed: number; actioned: number; actions: number };
  days: Array<{ day: string; flags: number; actions: number }>;
  kinds: Array<{ kind: string; flags: number; open: number; dismissed: number; actioned: number }>;
  actions: Array<{ action: string; count: number }>;
}

export type AnalyticsResponse =
  | EngagementBoard
  | GrowthBoard
  | RetentionBoard
  | FunnelsBoard
  | GameplayBoard
  | ContentBoard
  | MonetisationBoard
  | EconomyBoard
  | TechBoard
  | IntegrityBoard;
