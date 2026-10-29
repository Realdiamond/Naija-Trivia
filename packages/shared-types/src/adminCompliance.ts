/**
 * Compliance in the console beyond data requests (doc 18 §14, build plan step 2.7n): what we
 * keep and for how long (doc 08 §4) with the nightly retention job's runs, consent rates by
 * purpose and platform, and the quarterly review of staff access the DPO confirms.
 */
import { z } from 'zod';
import type { AdminRole } from './admin';

/** One line of doc 08 §4, with the retention job's last run and the oldest record still held. */
export interface RetentionStatus {
  rule: string;
  data: string;
  keep: string;
  /** Who removes it: the nightly retention job, the analytics loader, or nobody (kept by law). */
  by: 'retention job' | 'analytics loader' | 'kept';
  last_run_at: string | null;
  /** Rows removed (or stripped of raw timing) by the last run. */
  last_rows: number | null;
  /** Anything older than this should be gone; null when nothing is removed. */
  cutoff: string | null;
  /** The oldest record still held; when it is older than the cutoff, the job is behind. */
  oldest: string | null;
  behind: boolean;
}

export interface ConsentRate {
  purpose: string;
  platform: string;
  /** Players whose latest answer for the purpose is yes, out of those who answered. */
  granted: number;
  answered: number;
}

export interface AccessReviewStaff {
  id: string;
  name: string;
  email: string;
  status: string;
  last_login_at: string | null;
  roles: Array<{
    role: AdminRole;
    granted_by: string;
    approved_by: string | null;
    expires_at: string | null;
  }>;
}

export interface AdminComplianceOverview {
  retention: RetentionStatus[];
  consent: ConsentRate[];
  access: {
    staff: AccessReviewStaff[];
    last_review: { at: string; by: string; note: string } | null;
    /** Reviews are due every quarter (doc 18 §14). */
    due: boolean;
  };
}

export const AccessReviewRequest = z.object({
  note: z.string().trim().min(3).max(500),
});
export type AccessReviewRequest = z.infer<typeof AccessReviewRequest>;
