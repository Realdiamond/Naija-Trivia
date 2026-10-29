/**
 * Segments (doc 18 §9, build plan step 2.7o): a group of players by who they are and what they
 * do ("5+ duels in the last 7 days, home state Lagos, plays on the web, never purchased"), its
 * size and trend, saved, and exported as pseudonymous ids once a second person approves.
 * Analysts, growth, owners and admins build them (`segments.manage`); owners and admins approve
 * exports (`segments.approve`), never their own.
 */
import { z } from 'zod';
import { Platform } from './common';
import { AgeBand, HomeState } from './profile';

const Days = z.number().int().min(1).max(365);
const Count = z.number().int().min(0).max(1_000_000);

/** One condition; a segment is all of its conditions at once. */
export const SegmentRule = z.discriminatedUnion('field', [
  z.object({ field: z.literal('platform'), in: z.array(Platform).min(1).max(3) }),
  z.object({ field: z.literal('home_state'), in: z.array(HomeState).min(1).max(37) }),
  z.object({ field: z.literal('age_band'), in: z.array(AgeBand).min(1).max(2) }),
  z.object({ field: z.literal('account'), is: z.enum(['guest', 'signed_up']) }),
  z.object({ field: z.literal('joined_within_days'), days: Days }),
  z.object({ field: z.literal('active_within_days'), days: Days }),
  z.object({ field: z.literal('inactive_for_days'), days: Days }),
  z.object({ field: z.literal('duels_finished'), min: Count, within_days: Days }),
  z.object({ field: z.literal('purchased'), ever: z.boolean() }),
  z.object({ field: z.literal('coins_at_least'), n: Count }),
  z.object({ field: z.literal('level_at_least'), n: z.number().int().min(1).max(1000) }),
  z.object({ field: z.literal('streak_at_least'), n: Count }),
]);
export type SegmentRule = z.infer<typeof SegmentRule>;

export const SegmentDefinition = z.object({ rules: z.array(SegmentRule).min(1).max(10) });
export type SegmentDefinition = z.infer<typeof SegmentDefinition>;

export const SegmentInput = z.object({
  name: z.string().trim().min(2).max(80),
  definition: SegmentDefinition,
});
export type SegmentInput = z.infer<typeof SegmentInput>;

/** The segment's size on a WAT day, counted each night. */
export interface SegmentCount {
  day: string;
  players: number;
}

export interface AdminSegment {
  id: string;
  name: string;
  definition: SegmentDefinition;
  created_by: string;
  created_at: string;
  /** Its size when last counted (saving counts it; so does the nightly job). */
  last_count: number | null;
  last_computed_at: string | null;
  /** The last 30 days' counts, oldest first. */
  trend: SegmentCount[];
}

export interface AdminSegmentExport {
  id: string;
  segment_id: string;
  segment_name: string;
  reason: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  /** An approved export can be downloaded until then. */
  expires_at: string | null;
  created_at: string;
  /** Asked for by the staff member looking: only they can download it, and they can't approve it. */
  yours: boolean;
}

export interface AdminSegmentsResponse {
  segments: AdminSegment[];
  /** Exports waiting for a decision, and those decided in the last week. */
  exports: AdminSegmentExport[];
}

export const SegmentExportRequest = z.object({ reason: z.string().trim().min(10).max(500) });
export type SegmentExportRequest = z.infer<typeof SegmentExportRequest>;

export const SegmentExportDecision = z.object({ approve: z.boolean() });
export type SegmentExportDecision = z.infer<typeof SegmentExportDecision>;
