/**
 * Staff alerts (build plan step 2.9b, the owner's decisions of 28 Oct 2026): problems, every
 * sign-up and the payment journey, pushed to the phones of owners and admins at once, day or
 * night, and listed in the Staff tab. Every kind is on until someone switches it off. When many of
 * one kind arrive together (a burst of sign-ups, say), they go out as one push.
 */
import type { StaffAlertKind, StaffAlertSetting } from '@whosabi/shared-types';
import type { Pool, PoolClient } from '../db';
import type { JobDeps } from '../jobs/deps';
import { INVALID_TOKEN, PushRejected, type OutgoingPush, type PushTransport } from '../push/transport';
import { loadAdmin } from './context';
import { canUsePhone } from './phones';

export interface NewAlert {
  kind: StaffAlertKind;
  title: string;
  body: string;
  url?: string | null;
  /** At most one alert per key, ever (e.g. one "no Daily" per date). */
  dedupeKey?: string;
  now: number;
}

/** Records an alert; the worker pushes it. Inside a transaction, it is kept only if that commits. */
export async function raiseStaffAlert(db: Pool | PoolClient, alert: NewAlert): Promise<void> {
  await db.query(
    `INSERT INTO staff_alerts (kind, title, body, url, dedupe_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      alert.kind,
      alert.title,
      alert.body.slice(0, 300),
      alert.url ?? null,
      alert.dedupeKey ?? null,
      new Date(alert.now),
    ],
  );
}

export const ALERT_KINDS: ReadonlyArray<Omit<StaffAlertSetting, 'enabled'>> = [
  {
    kind: 'problem',
    label: 'Problems',
    description: 'A question taken out by player reports, no Daily for tomorrow, a background job failing.',
  },
  { kind: 'signup', label: 'New sign-ups', description: 'Each player who makes an account.' },
  {
    kind: 'payment_opened',
    label: 'Opened the payment screen',
    description: 'Someone looks at buying. Starts when the shop opens.',
  },
  {
    kind: 'payment_started',
    label: 'Started paying',
    description: 'Someone begins a payment. Starts when the shop opens.',
  },
  { kind: 'payment_paid', label: 'Paid', description: 'A payment went through. Starts when the shop opens.' },
];

/** Many of one kind at once go out as one push. */
const GROUP_FROM = 4;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

const GROUPED: Record<StaffAlertKind, (n: number) => string> = {
  problem: (n) => `${n} problems need you`,
  signup: (n) => `${n} new sign-ups 🎉`,
  payment_opened: (n) => `${n} people opened the payment screen`,
  payment_started: (n) => `${n} people started paying`,
  payment_paid: (n) => `${n} payments went through 💰`,
};

interface Claimed {
  id: string;
  kind: StaffAlertKind;
  title: string;
  body: string;
  url: string | null;
  attempts: number;
}

interface Phone {
  session_id: string;
  admin_id: string;
  push_token: string;
}

/** The worker's staff-alert job. Returns how many alerts went out. */
export async function sendStaffAlerts(deps: JobDeps, transport: PushTransport, limit = 200): Promise<number> {
  const { pool, clock, log } = deps;
  const now = clock.now();
  const claimed = await pool.query<Claimed>(
    `UPDATE staff_alerts SET attempts = attempts + 1, locked_until = $2
      WHERE id IN (SELECT id FROM staff_alerts
                    WHERE delivered_at IS NULL AND (locked_until IS NULL OR locked_until <= $1)
                    ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, title, body, url, attempts`,
    [new Date(now), new Date(now + LOCK_MS), limit],
  );
  if (claimed.rows.length === 0) return 0;

  const phones = await staffPhones(pool, now);
  const muted = new Set(
    (
      await pool.query<{ admin_id: string; kind: string }>(
        'SELECT admin_id, kind FROM admin_alert_prefs WHERE NOT enabled',
      )
    ).rows.map((r) => `${r.admin_id}:${r.kind}`),
  );

  const byKind = new Map<StaffAlertKind, Claimed[]>();
  for (const alert of claimed.rows) byKind.set(alert.kind, [...(byKind.get(alert.kind) ?? []), alert]);

  const done: string[] = [];
  const retry: string[] = [];
  for (const [kind, alerts] of byKind) {
    const pushes: Array<{ alerts: Claimed[]; push: OutgoingPush }> =
      alerts.length >= GROUP_FROM
        ? [
            {
              alerts,
              push: staffPush(
                kind,
                GROUPED[kind](alerts.length),
                'Open the Staff tab to see them.',
                '/staff/alerts',
              ),
            },
          ]
        : alerts.map((a) => ({
            alerts: [a],
            push: staffPush(kind, a.title, a.body, a.url ?? '/staff/alerts'),
          }));
    for (const { alerts: group, push } of pushes) {
      let failed = false;
      for (const phone of phones) {
        if (muted.has(`${phone.admin_id}:${kind}`)) continue;
        try {
          const result = await transport.send(
            { id: phone.session_id, platform: 'android', token: phone.push_token },
            push,
          );
          if (result === INVALID_TOKEN) {
            await pool.query('UPDATE admin_phone_sessions SET push_token = NULL WHERE id = $1', [
              phone.session_id,
            ]);
          }
        } catch (err) {
          if (err instanceof PushRejected) {
            log.error({ err, phone: phone.session_id }, 'staff alert refused');
          } else {
            log.warn({ err, phone: phone.session_id }, 'staff alert not sent; trying again');
            failed = true;
          }
        }
      }
      // A failure is tried again (for every phone: a repeat beats a miss), a few times at most.
      for (const a of group) (failed && a.attempts < MAX_ATTEMPTS ? retry : done).push(a.id);
    }
  }
  if (done.length > 0) {
    await pool.query('UPDATE staff_alerts SET delivered_at = $2, locked_until = NULL WHERE id = ANY($1)', [
      done,
      new Date(now),
    ]);
  }
  if (retry.length > 0) {
    await pool.query('UPDATE staff_alerts SET locked_until = $2 WHERE id = ANY($1)', [
      retry,
      new Date(now + 30_000),
    ]);
  }
  return done.length;
}

function staffPush(kind: StaffAlertKind, title: string, body: string, url: string): OutgoingPush {
  return {
    type: 'staff_alert',
    title,
    body,
    url,
    channel: 'staff',
    data: { kind },
    collapseKey: null,
    ttlSeconds: 24 * 3600,
  };
}

/** Signed-in staff phones with pushes on, of people who may use staff tools. */
async function staffPhones(pool: Pool, now: number): Promise<Phone[]> {
  const rows = (
    await pool.query<Phone>(
      `SELECT s.id AS session_id, s.admin_id, s.push_token
         FROM admin_phone_sessions s JOIN admin_users a ON a.id = s.admin_id
        WHERE s.revoked_at IS NULL AND s.expires_at > $1 AND s.push_token IS NOT NULL AND a.status = 'active'`,
      [new Date(now)],
    )
  ).rows;
  const allowed = new Map<string, boolean>();
  for (const id of new Set(rows.map((r) => r.admin_id))) {
    const admin = await loadAdmin(pool, id, now);
    allowed.set(id, admin !== null && canUsePhone(admin));
  }
  return rows.filter((r) => allowed.get(r.admin_id));
}

/** One staff member's switches: every kind, on unless they switched it off. */
export async function alertSettings(pool: Pool, adminId: string): Promise<StaffAlertSetting[]> {
  const off = new Set(
    (
      await pool.query<{ kind: string }>(
        'SELECT kind FROM admin_alert_prefs WHERE admin_id = $1 AND NOT enabled',
        [adminId],
      )
    ).rows.map((r) => r.kind),
  );
  return ALERT_KINDS.map((k) => ({ ...k, enabled: !off.has(k.kind) }));
}
