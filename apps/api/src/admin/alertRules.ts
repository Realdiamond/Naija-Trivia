/**
 * Threshold alert rules in the console (doc 18 §9 "Reports & alerts", build plan step 2.7m):
 * owners and admins make, change, switch off and delete them (`alerts.manage`); the worker
 * checks them every minute (jobs/alertRules.ts). Every change is in the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AlertRuleInput,
  AlertRuleUpdate,
  type AdminAlertRule,
  type AdminAlertRulesResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { notFound, parse } from '../errors';
import { newId } from '../ids';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const Params = z.object({ id: z.string().min(3).max(40) });

interface RuleRow {
  id: string;
  name: string;
  metric: AdminAlertRule['metric'];
  comparison: AdminAlertRule['comparison'];
  threshold: string;
  window_minutes: number;
  channels: AdminAlertRule['channels'];
  enabled: boolean;
  firing_since: Date | null;
  last_value: string | null;
  last_checked_at: Date | null;
  created_by: string;
  created_at: Date;
}

const COLUMNS = `id, name, metric, comparison, threshold, window_minutes, channels, enabled, firing_since,
                 last_value, last_checked_at, created_by, created_at`;

const shown = (r: RuleRow): AdminAlertRule => ({
  id: r.id,
  name: r.name,
  metric: r.metric,
  comparison: r.comparison,
  threshold: Number(r.threshold),
  window_minutes: r.window_minutes,
  channels: r.channels,
  enabled: r.enabled,
  firing_since: r.firing_since?.toISOString() ?? null,
  last_value: r.last_value === null ? null : Number(r.last_value),
  last_checked_at: r.last_checked_at?.toISOString() ?? null,
  created_by: r.created_by,
  created_at: r.created_at.toISOString(),
});

export function adminAlertRuleRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, config, clock } = deps;

  const load = async (id: string): Promise<RuleRow> => {
    const row = (await pool.query<RuleRow>(`SELECT ${COLUMNS} FROM alert_rules WHERE id = $1`, [id])).rows[0];
    if (!row) throw notFound('No such alert rule.');
    return row;
  };

  app.get('/admin/alert-rules', async (request): Promise<AdminAlertRulesResponse> => {
    await requireAdmin(request, ctx, 'alerts.manage');
    const rules = await pool.query<RuleRow>(`SELECT ${COLUMNS} FROM alert_rules ORDER BY created_at, id`);
    return {
      rules: rules.rows.map(shown),
      channels: {
        phone: true,
        email: Boolean(config.resend) && config.alertEmails.length > 0,
        slack: Boolean(config.slackAlertsWebhookUrl),
      },
    };
  });

  app.post('/admin/alert-rules', async (request, reply): Promise<AdminAlertRule> => {
    const admin = await requireAdmin(request, ctx, 'alerts.manage');
    const rule = parse(AlertRuleInput, request.body);
    const id = newId('ar', clock.now());
    const created = await pool.query<RuleRow>(
      `INSERT INTO alert_rules (id, name, metric, comparison, threshold, window_minutes, channels, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
      [
        id,
        rule.name,
        rule.metric,
        rule.comparison,
        rule.threshold,
        rule.window_minutes,
        [...new Set(rule.channels)],
        admin.id,
        new Date(clock.now()),
      ],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'create_alert_rule',
      entity: 'alert_rule',
      entityId: id,
      after: rule,
      ip: request.ip,
    });
    reply.code(201);
    return shown(created.rows[0]!);
  });

  app.post('/admin/alert-rules/:id', async (request): Promise<AdminAlertRule> => {
    const admin = await requireAdmin(request, ctx, 'alerts.manage');
    const { id } = parse(Params, request.params);
    const change = parse(AlertRuleUpdate, request.body);
    const before = await load(id);
    // A changed rule is judged afresh at the next check: a new alert if it is still crossed.
    const reset =
      change.metric || change.comparison || change.threshold !== undefined || change.window_minutes;
    const updated = await pool.query<RuleRow>(
      `UPDATE alert_rules
          SET name = coalesce($2, name), metric = coalesce($3, metric), comparison = coalesce($4, comparison),
              threshold = coalesce($5, threshold), window_minutes = coalesce($6, window_minutes),
              channels = coalesce($7, channels), enabled = coalesce($8, enabled),
              firing_since = CASE WHEN $9 OR $8 = false THEN NULL ELSE firing_since END,
              last_value = CASE WHEN $9 THEN NULL ELSE last_value END,
              last_checked_at = CASE WHEN $9 THEN NULL ELSE last_checked_at END
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [
        id,
        change.name ?? null,
        change.metric ?? null,
        change.comparison ?? null,
        change.threshold ?? null,
        change.window_minutes ?? null,
        change.channels ? [...new Set(change.channels)] : null,
        change.enabled ?? null,
        Boolean(reset),
      ],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'update_alert_rule',
      entity: 'alert_rule',
      entityId: id,
      before: shown(before),
      after: change,
      ip: request.ip,
    });
    return shown(updated.rows[0]!);
  });

  app.delete('/admin/alert-rules/:id', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'alerts.manage');
    const { id } = parse(Params, request.params);
    const before = await load(id);
    await pool.query('DELETE FROM alert_rules WHERE id = $1', [id]);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'delete_alert_rule',
      entity: 'alert_rule',
      entityId: id,
      before: shown(before),
      ip: request.ip,
    });
    return reply.code(204).send();
  });
}
