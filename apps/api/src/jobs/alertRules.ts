/**
 * Threshold alerts (doc 18 §9 "Reports & alerts", build plan step 2.7m): every minute, each
 * enabled rule's metric over its window (the last 15 minutes, say), as doc 18 §10 defines it.
 * Crossing the line alerts staff once, on the rule's channels (staff phones, email, Slack); going
 * back says so once. A share with too few attempts behind it (3 codes sent in the night) proves
 * nothing, so the rule stays as it was. One worker checks at a time.
 */
import {
  ALERT_METRICS,
  ALERT_MIN_ATTEMPTS,
  type AlertChannel,
  type AlertComparison,
  type AlertMetric,
} from '@whosabi/shared-types';
import { raiseStaffAlert } from '../admin/alerts';
import type { EmailSender } from '../auth/email';
import type { Pool } from '../db';
import type { JobDeps } from './deps';

const MINUTE = 60_000;
const WEEK = 7 * 24 * 60 * MINUTE;
/** A rule is checked at most this often, however many workers tick. */
const CHECK_EVERY_MS = MINUTE;
/** One player, signed in or not, in the analytics events (as on the Overview). */
const PLAYER = "coalesce(nullif(user_pid, ''), nullif(anon_id, ''))";

/** Where alerts go besides staff phones; each is optional. */
export interface AlertOutlets {
  email?: EmailSender;
  emailTo: string[];
  slackWebhookUrl?: string;
  fetch?: typeof fetch;
}

interface RuleRow {
  id: string;
  name: string;
  metric: AlertMetric;
  comparison: AlertComparison;
  threshold: string;
  window_minutes: number;
  channels: AlertChannel[];
  firing_since: Date | null;
}

/** A count, or a share as a percentage with the attempts behind it. */
interface Measured {
  value: number;
  attempts: number | null;
}

async function count(pool: Pool, sql: string, from: Date, to: Date): Promise<Measured> {
  const row = await pool.query<{ n: number }>(sql, [from, to]);
  return { value: row.rows[0]!.n, attempts: null };
}

async function shareOf(pool: Pool, done: string, tried: string, from: Date, to: Date): Promise<Measured> {
  const row = await pool.query<{ done: number; tried: number }>(
    `SELECT count(*) FILTER (WHERE event = $3)::int AS done, count(*) FILTER (WHERE event = $4)::int AS tried
       FROM analytics_events WHERE ts >= $1 AND ts < $2 AND event IN ($3, $4)`,
    [from, to, done, tried],
  );
  const { done: d, tried: t } = row.rows[0]!;
  return { value: t > 0 ? (d / t) * 100 : 0, attempts: t };
}

/** The metric over [from, to), as doc 18 §10 defines it. */
export function measure(pool: Pool, metric: AlertMetric, from: Date, to: Date): Promise<Measured> {
  switch (metric) {
    case 'active_players':
      return count(
        pool,
        `SELECT count(DISTINCT ${PLAYER})::int AS n FROM analytics_events WHERE ts >= $1 AND ts < $2`,
        from,
        to,
      );
    case 'signups':
      // A sign-up is a player's first account sign-in, not their guest start (as on the Overview).
      return count(
        pool,
        `SELECT count(*)::int AS n FROM (
           SELECT user_id FROM auth_identities WHERE provider <> 'guest_device'
            GROUP BY user_id HAVING min(created_at) >= $1 AND min(created_at) < $2) s`,
        from,
        to,
      );
    case 'matches':
      return count(
        pool,
        `SELECT ((SELECT count(*) FROM duels
                   WHERE state IN ('complete', 'forfeit') AND completed_at >= $1 AND completed_at < $2)
               + (SELECT count(*) FROM party_games WHERE ended_at >= $1 AND ended_at < $2)
               + (SELECT count(*) FROM daily_results WHERE completed_at >= $1 AND completed_at < $2))::int AS n`,
        from,
        to,
      );
    case 'purchases':
      return count(
        pool,
        `SELECT count(*)::int AS n FROM purchases
          WHERE environment = 'production' AND status <> 'pending' AND created_at >= $1 AND created_at < $2`,
        from,
        to,
      );
    case 'reports':
      return count(
        pool,
        'SELECT count(*)::int AS n FROM question_reports WHERE created_at >= $1 AND created_at < $2',
        from,
        to,
      );
    case 'integrity_flags':
      return count(
        pool,
        'SELECT count(*)::int AS n FROM integrity_flags WHERE created_at >= $1 AND created_at < $2',
        from,
        to,
      );
    case 'otp_success':
      return shareOf(pool, 'otp_verified', 'otp_sent', from, to);
    case 'push_opened':
      return shareOf(pool, 'push_opened', 'push_sent', from, to);
    case 'reconnected':
      return shareOf(pool, 'connection_restored', 'connection_lost', from, to);
  }
}

/** Too few attempts behind a share: it says nothing yet. */
const tooFew = (m: Measured) => m.attempts !== null && m.attempts < ALERT_MIN_ATTEMPTS;

/** What the rule compares with its threshold now, or null when it can't say. */
async function valueOf(
  pool: Pool,
  rule: RuleRow,
  now: number,
): Promise<{ value: number; current: number; before?: number } | null> {
  const window = rule.window_minutes * MINUTE;
  const current = await measure(pool, rule.metric, new Date(now - window), new Date(now));
  if (tooFew(current)) return null;
  if (rule.comparison !== 'drop_pct_vs_last_week') return { value: current.value, current: current.value };
  // The same minutes a week ago: the drop in percent (negative when it grew).
  const before = await measure(pool, rule.metric, new Date(now - WEEK - window), new Date(now - WEEK));
  if (tooFew(before) || before.value === 0) return null;
  return {
    value: ((before.value - current.value) / before.value) * 100,
    current: current.value,
    before: before.value,
  };
}

function crossed(comparison: AlertComparison, value: number, threshold: number): boolean {
  if (comparison === 'below') return value < threshold;
  if (comparison === 'above') return value > threshold;
  return value >= threshold;
}

const round = (n: number) => Math.round(n * 10) / 10;

function describe(rule: RuleRow, value: number, current: number, before: number | undefined) {
  const metric = ALERT_METRICS[rule.metric];
  const name = rule.name || metric.label;
  const threshold = Number(rule.threshold);
  const unit = (n: number) => (metric.ratio ? `${round(n)}%` : `${round(n)} ${metric.unit}`);
  const over = `over the last ${rule.window_minutes} minutes`;
  if (rule.comparison === 'drop_pct_vs_last_week') {
    return {
      name,
      fired: `${name}: down ${round(value)}% on last week`,
      detail: `${unit(current)} ${over}, against ${unit(before ?? 0)} at the same time last week (alert at ${round(threshold)}% down).`,
      now: `${round(value)}% down on last week ${over}.`,
    };
  }
  return {
    name,
    fired: `${name}: ${unit(value)}, ${rule.comparison} ${unit(threshold)}`,
    detail: `${unit(value)} ${over} (alert ${rule.comparison} ${unit(threshold)}).`,
    now: `Now ${unit(value)} ${over}.`,
  };
}

async function sendOut(
  deps: JobDeps,
  outlets: AlertOutlets,
  channels: AlertChannel[],
  title: string,
  body: string,
): Promise<void> {
  const sends: Array<Promise<unknown>> = [];
  if (channels.includes('email') && outlets.email && outlets.emailTo.length > 0) {
    for (const to of outlets.emailTo) {
      sends.push(
        outlets.email.send({
          to,
          subject: `Who Sabi? alert: ${title}`,
          text: `${title}\n\n${body}`,
          html: `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body)}</p>`,
        }),
      );
    }
  }
  if (channels.includes('slack') && outlets.slackWebhookUrl) {
    sends.push(
      (outlets.fetch ?? fetch)(outlets.slackWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `*${title}*\n${body}` }),
        signal: AbortSignal.timeout(10_000),
      }).then((res) => {
        if (!res.ok) throw new Error(`slack answered ${res.status}`);
      }),
    );
  }
  // An email or Slack that fails is logged; the phones (in the database) still have the alert.
  for (const result of await Promise.allSettled(sends)) {
    if (result.status === 'rejected') deps.log.warn({ err: result.reason }, 'alert not delivered');
  }
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export interface AlertCheckResult {
  checked: number;
  fired: number;
  resolved: number;
}

export async function checkAlertRules(deps: JobDeps, outlets: AlertOutlets): Promise<AlertCheckResult> {
  const now = deps.clock.now();
  const result: AlertCheckResult = { checked: 0, fired: 0, resolved: 0 };
  // One worker at a time; the rows' check times keep a second worker from repeating a minute.
  if ((await deps.redis.set('job:alert-rules', '1', 'PX', 50_000, 'NX')) !== 'OK') return result;
  try {
    const due = await deps.pool.query<RuleRow>(
      `SELECT id, name, metric, comparison, threshold, window_minutes, channels, firing_since
         FROM alert_rules
        WHERE enabled AND (last_checked_at IS NULL OR last_checked_at <= $1)
        ORDER BY id`,
      [new Date(now - CHECK_EVERY_MS)],
    );
    for (const rule of due.rows) {
      result.checked += 1;
      const measured = await valueOf(deps.pool, rule, now);
      let firingSince = rule.firing_since;
      if (measured) {
        const isCrossed = crossed(rule.comparison, measured.value, Number(rule.threshold));
        const text = describe(rule, measured.value, measured.current, measured.before);
        if (isCrossed && !rule.firing_since) {
          firingSince = new Date(now);
          result.fired += 1;
          await raiseAlert(
            deps,
            outlets,
            rule,
            `alert_rule:${rule.id}:fired:${now}`,
            text.fired,
            text.detail,
            now,
          );
        } else if (!isCrossed && rule.firing_since) {
          firingSince = null;
          result.resolved += 1;
          await raiseAlert(
            deps,
            outlets,
            rule,
            `alert_rule:${rule.id}:ok:${now}`,
            `Back to normal: ${text.name}`,
            text.now,
            now,
          );
        }
      }
      await deps.pool.query(
        'UPDATE alert_rules SET last_value = $2, last_checked_at = $3, firing_since = $4 WHERE id = $1',
        [rule.id, measured ? round(measured.value) : null, new Date(now), firingSince],
      );
    }
    return result;
  } finally {
    await deps.redis.del('job:alert-rules');
  }
}

async function raiseAlert(
  deps: JobDeps,
  outlets: AlertOutlets,
  rule: RuleRow,
  dedupeKey: string,
  title: string,
  body: string,
  now: number,
): Promise<void> {
  if (rule.channels.includes('phone')) {
    await raiseStaffAlert(deps.pool, { kind: 'problem', title, body, dedupeKey, now });
  }
  await sendOut(deps, outlets, rule.channels, title, body);
}
