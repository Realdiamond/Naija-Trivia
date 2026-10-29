/**
 * Threshold alerts (doc 18 §9 "Reports & alerts", build plan step 2.7m): a rule watches one
 * metric over the last few minutes and alerts staff when it crosses a line, then again when it
 * is back to normal. For example "sign-in codes verified below 85% over 15 minutes" or "players
 * active down 20% on the same time last week". Owners and admins make them (`alerts.manage`).
 */
import { z } from 'zod';

/** What a rule can watch, each over the rule's window and as defined in doc 18 §10. */
export const ALERT_METRICS = {
  active_players: { label: 'Players active', unit: 'players', ratio: false },
  signups: { label: 'Sign-ups', unit: 'sign-ups', ratio: false },
  matches: { label: 'Matches finished', unit: 'matches', ratio: false },
  purchases: { label: 'Store purchases', unit: 'purchases', ratio: false },
  otp_success: { label: 'Sign-in codes verified', unit: '% of codes sent', ratio: true },
  push_opened: { label: 'Pushes opened', unit: '% of pushes sent', ratio: true },
  reconnected: { label: 'Connections restored', unit: '% of connections lost', ratio: true },
  reports: { label: 'Question reports', unit: 'reports', ratio: false },
  integrity_flags: { label: 'Integrity flags raised', unit: 'flags', ratio: false },
} as const;
export const AlertMetric = z.enum(
  Object.keys(ALERT_METRICS) as [keyof typeof ALERT_METRICS, ...Array<keyof typeof ALERT_METRICS>],
);
export type AlertMetric = z.infer<typeof AlertMetric>;

/** A share (`ratio` metrics) needs at least this many attempts in the window to mean anything. */
export const ALERT_MIN_ATTEMPTS = 10;

export const AlertComparison = z.enum(['below', 'above', 'drop_pct_vs_last_week']);
export type AlertComparison = z.infer<typeof AlertComparison>;

export const AlertChannel = z.enum(['phone', 'email', 'slack']);
export type AlertChannel = z.infer<typeof AlertChannel>;

export const AlertRuleInput = z.object({
  name: z.string().trim().max(80).default(''),
  metric: AlertMetric,
  comparison: AlertComparison,
  /** A count, a percentage (0–100) for shares, or the drop in percent for `drop_pct_vs_last_week`. */
  threshold: z.number().min(0).max(1_000_000),
  window_minutes: z.number().int().min(5).max(1440),
  channels: z.array(AlertChannel).min(1).max(3),
});
export type AlertRuleInput = z.infer<typeof AlertRuleInput>;

/** Only what is sent changes: a name left out stays as it was (no default here). */
export const AlertRuleUpdate = AlertRuleInput.extend({ name: z.string().trim().max(80) })
  .partial()
  .extend({ enabled: z.boolean().optional() });
export type AlertRuleUpdate = z.infer<typeof AlertRuleUpdate>;

export interface AdminAlertRule extends AlertRuleInput {
  id: string;
  enabled: boolean;
  /** Since when the rule has been crossed; null while all is well. */
  firing_since: string | null;
  /** The metric at the last check (for a drop, the drop in percent); null before any or too few attempts. */
  last_value: number | null;
  last_checked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface AdminAlertRulesResponse {
  rules: AdminAlertRule[];
  /** Which ways out are set up on the server: email needs Resend and ALERT_EMAILS, Slack its webhook. */
  channels: Record<AlertChannel, boolean>;
}
