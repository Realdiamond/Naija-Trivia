/**
 * The console's analytics dashboards (doc 18 §9–10, build plan step 2.7j). Every dashboard takes
 * the same filters: a range of WAT days and a platform. Each metric follows its one definition in
 * doc 18 §10. Read from Postgres at launch; ClickHouse takes over in M3 without changing these.
 */
import { z } from 'zod';
import type { AdminPermission } from './admin';
import { Platform } from './common';

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ANALYTICS_BOARDS = ['engagement', 'growth', 'retention'] as const;
export const AnalyticsBoard = z.enum(ANALYTICS_BOARDS);
export type AnalyticsBoard = z.infer<typeof AnalyticsBoard>;

/** Who may open each dashboard (doc 18 §3). */
export const ANALYTICS_BOARD_PERMISSION: Record<AnalyticsBoard, AdminPermission> = {
  engagement: 'analytics.kpi',
  growth: 'analytics.kpi',
  retention: 'analytics.kpi',
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

export type AnalyticsResponse = EngagementBoard | GrowthBoard | RetentionBoard;
