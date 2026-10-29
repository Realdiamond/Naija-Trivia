/**
 * Compliance beyond data requests (doc 18 §14, build plan step 2.7n), for the DPO, owners and
 * admins (`compliance.view`): what we keep and for how long (doc 08 §4) with the retention job's
 * last run and the oldest record still held; consent rates by purpose and platform; and the
 * staff list for the quarterly access review, which the DPO or an owner records
 * (`compliance.review`, audited).
 */
import type { FastifyInstance } from 'fastify';
import {
  AccessReviewRequest,
  type AccessReviewStaff,
  type AdminComplianceOverview,
  type AdminRole,
  type RetentionStatus,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { parse } from '../errors';
import { RETENTION_RULES } from '../jobs/retention';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const DAY = 86_400_000;
/** A quarter, give or take: a review older than this is due again. */
const REVIEW_EVERY_DAYS = 92;
/** The job runs nightly in batches: a day or two behind is not "behind". */
const GRACE_MS = 2 * DAY;

/** Doc 08 §4, in the order it lists them, with where each record's age is read from. */
const POLICY: Array<{
  rule: string;
  data: string;
  keep: string;
  by: RetentionStatus['by'];
  oldest: string | null;
}> = [
  {
    rule: 'duel_timing',
    data: 'Duel answers: raw timing',
    keep: '180 days, then only the answers and points',
    by: 'retention job',
    oldest: `SELECT min(served_at) AS at FROM duel_answers
              WHERE client_elapsed_ms IS NOT NULL OR rtt_est_ms IS NOT NULL OR tab_hidden_ms IS NOT NULL`,
  },
  {
    rule: 'party_results',
    data: 'Party games and results',
    keep: '2 years',
    by: 'retention job',
    oldest: 'SELECT min(coalesce(ended_at, started_at)) AS at FROM party_games',
  },
  {
    rule: 'daily_results',
    data: 'Daily results',
    keep: '2 years',
    by: 'retention job',
    oldest: 'SELECT min(completed_at) AS at FROM daily_results',
  },
  {
    rule: 'practice_sets',
    data: 'Practice sets (the questions sent for Practice)',
    keep: '35 days',
    by: 'retention job',
    oldest: 'SELECT min(issued_at) AS at FROM practice_sets',
  },
  {
    rule: 'practice_results',
    data: 'Practice results',
    keep: '2 years',
    by: 'retention job',
    oldest: 'SELECT min(received_at) AS at FROM practice_results',
  },
  {
    rule: 'analytics_events',
    data: 'Analytics events (raw)',
    keep: 'ANALYTICS_RETENTION_DAYS (at most 13 months)',
    by: 'analytics loader',
    oldest: 'SELECT min(ts) AS at FROM analytics_events',
  },
  {
    rule: 'integrity_flags',
    data: 'Integrity flags',
    keep: '2 years',
    by: 'retention job',
    oldest: 'SELECT min(created_at) AS at FROM integrity_flags',
  },
  {
    rule: 'question_reports',
    data: 'Question reports',
    keep: '2 years',
    by: 'retention job',
    oldest: 'SELECT min(created_at) AS at FROM question_reports',
  },
  {
    rule: 'support_tickets',
    data: 'Messages to support',
    keep: '2 years',
    by: 'retention job',
    oldest: 'SELECT min(created_at) AS at FROM support_tickets',
  },
  {
    rule: 'consent_records',
    data: 'Consent records',
    keep: 'The account’s life and 6 years after',
    by: 'retention job',
    oldest: `SELECT min(u.deleted_at) AS at FROM consent_records c JOIN users u ON u.id = c.user_id
              WHERE u.status = 'deleted'`,
  },
  {
    rule: 'admin_audit_log',
    data: 'Admin audit log',
    keep: '6 years (append-only; nothing removes it before then)',
    by: 'kept',
    oldest: 'SELECT min(created_at) AS at FROM admin_audit_log',
  },
];

export function adminComplianceOverviewRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;

  app.get('/admin/compliance/overview', async (request): Promise<AdminComplianceOverview> => {
    await requireAdmin(request, ctx, 'compliance.view');
    const now = clock.now();
    const days = (rule: string) =>
      rule === 'analytics_events'
        ? config.analyticsRetentionDays
        : RETENTION_RULES.find((r) => r.rule === rule)?.days;

    const [runs, oldest, consent, staff, review] = await Promise.all([
      pool.query<{ rule: string; rows: number; ran_at: Date }>(
        `SELECT DISTINCT ON (rule) rule, rows, ran_at FROM retention_runs ORDER BY rule, ran_at DESC`,
      ),
      Promise.all(POLICY.map((p) => (p.oldest ? pool.query<{ at: Date | null }>(p.oldest) : null))),
      // Each player's latest answer for each purpose, by the platform they last played on.
      pool.query<{ purpose: string; platform: string; granted: number; answered: number }>(
        `SELECT c.purpose, coalesce(u.last_platform, u.signup_platform, 'unknown') AS platform,
                count(*) FILTER (WHERE c.granted)::int AS granted, count(*)::int AS answered
           FROM (SELECT DISTINCT ON (user_id, purpose) user_id, purpose, granted
                   FROM consent_records ORDER BY user_id, purpose, created_at DESC, id DESC) c
           JOIN users u ON u.id = c.user_id
          WHERE u.status <> 'deleted'
          GROUP BY 1, 2 ORDER BY 1, 2`,
      ),
      pool.query<{
        id: string;
        name: string;
        email: string;
        status: string;
        last_login_at: Date | null;
        role: AdminRole | null;
        granted_by: string | null;
        approved_by: string | null;
        expires_at: Date | null;
      }>(
        `SELECT a.id, a.name, a.email, a.status, a.last_login_at, g.role,
                gb.name AS granted_by, ab.name AS approved_by, g.expires_at
           FROM admin_users a
           LEFT JOIN admin_role_grants g ON g.admin_id = a.id
           LEFT JOIN admin_users gb ON gb.id = g.granted_by
           LEFT JOIN admin_users ab ON ab.id = g.approved_by
          WHERE a.status <> 'removed'
          ORDER BY a.name, a.id, g.role`,
      ),
      pool.query<{ created_at: Date; by: string; reason: string | null }>(
        `SELECT l.created_at, coalesce(a.name, l.actor) AS by, l.reason
           FROM admin_audit_log l LEFT JOIN admin_users a ON a.id = l.actor
          WHERE l.action = 'access_review' ORDER BY l.created_at DESC LIMIT 1`,
      ),
    ]);

    const lastRun = new Map(runs.rows.map((r) => [r.rule, r]));
    const retention: RetentionStatus[] = POLICY.map((p, i) => {
      const keepDays = p.by === 'kept' ? undefined : days(p.rule);
      const cutoff = keepDays === undefined ? null : now - keepDays * DAY;
      const at = oldest[i]?.rows[0]?.at ?? null;
      const run = lastRun.get(p.rule);
      return {
        rule: p.rule,
        data: p.data,
        keep: p.keep,
        by: p.by,
        last_run_at: run?.ran_at.toISOString() ?? null,
        last_rows: run?.rows ?? null,
        cutoff: cutoff === null ? null : new Date(cutoff).toISOString(),
        oldest: at?.toISOString() ?? null,
        behind: cutoff !== null && at !== null && at.getTime() < cutoff - GRACE_MS,
      };
    });

    const byStaff = new Map<string, AccessReviewStaff>();
    for (const row of staff.rows) {
      const person = byStaff.get(row.id) ?? {
        id: row.id,
        name: row.name,
        email: row.email,
        status: row.status,
        last_login_at: row.last_login_at?.toISOString() ?? null,
        roles: [],
      };
      if (row.role) {
        person.roles.push({
          role: row.role,
          granted_by: row.granted_by ?? 'unknown',
          approved_by: row.approved_by,
          expires_at: row.expires_at?.toISOString() ?? null,
        });
      }
      byStaff.set(row.id, person);
    }
    const last = review.rows[0];
    return {
      retention,
      consent: consent.rows,
      access: {
        staff: [...byStaff.values()],
        last_review: last
          ? { at: last.created_at.toISOString(), by: last.by, note: last.reason ?? '' }
          : null,
        due: !last || last.created_at.getTime() < now - REVIEW_EVERY_DAYS * DAY,
      },
    };
  });

  app.post('/admin/compliance/access-review', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'compliance.review');
    const { note } = parse(AccessReviewRequest, request.body);
    const staff = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM admin_users WHERE status <> 'removed'",
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'access_review',
      entity: 'staff',
      reason: note,
      after: { staff: staff.rows[0]!.n },
      ip: request.ip,
    });
    return reply.code(204).send();
  });
}
