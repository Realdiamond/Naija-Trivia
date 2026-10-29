/**
 * Experiments in the console (doc 13 §4, doc 18 §11, build plan step 2.7s), for LiveOps, admins
 * and owners (`liveops.config`): write one down as a draft (key, hypothesis, variants and
 * weights, who it is for, the primary metric and guardrails), change it while it's a draft, start
 * it, stop it. Variants and audience can't change once it has run, so every player keeps their
 * variant. Each one shows how many players saw each variant; results are read in Explore until
 * the experiments UI (v1.1). Starts and stops need a reason; everything is audited.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminExperimentAction,
  AdminExperimentInput,
  ErrorCode,
  type AdminExperiment,
  type AdminExperimentsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { conflict, notFound, parse } from '../errors';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const Params = z.object({ key: z.string().min(3).max(40) });

interface ExperimentRow extends Omit<AdminExperiment, 'started_at' | 'stopped_at' | 'exposed'> {
  started_at: Date | null;
  stopped_at: Date | null;
}

const COLUMNS = `e.key, e.description, e.hypothesis, e.variants, e.audience, e.primary_metric, e.guardrails, e.status,
  e.started_at, e.stopped_at, coalesce(a.name, e.created_by) AS created_by`;
const FROM = 'experiments e LEFT JOIN admin_users a ON a.id = e.created_by';

export function adminExperimentRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, liveops } = deps;

  const load = async (key: string): Promise<ExperimentRow> => {
    const row = (await pool.query<ExperimentRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE e.key = $1`, [key]))
      .rows[0];
    if (!row) throw notFound('No such experiment.');
    return row;
  };

  app.get('/admin/experiments', async (request): Promise<AdminExperimentsResponse> => {
    await requireAdmin(request, ctx, 'liveops.config');
    const rows = await pool.query<ExperimentRow>(
      `SELECT ${COLUMNS} FROM ${FROM}
        ORDER BY CASE e.status WHEN 'running' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, e.created_at DESC`,
    );
    const exposed = await pool.query<{ experiment: string; variant: string; players: number }>(
      `SELECT x.key AS experiment, ev.props->>'variant' AS variant,
              count(DISTINCT coalesce(nullif(ev.user_pid, ''), nullif(ev.anon_id, '')))::int AS players
         FROM experiments x JOIN analytics_events ev
           ON ev.event = 'experiment_exposed' AND ev.props->>'experiment' = x.key AND ev.ts >= x.started_at
          AND (x.stopped_at IS NULL OR ev.ts < x.stopped_at)
        WHERE x.started_at IS NOT NULL
        GROUP BY 1, 2`,
    );
    return {
      experiments: rows.rows.map((e) => ({
        ...e,
        started_at: e.started_at?.toISOString() ?? null,
        stopped_at: e.stopped_at?.toISOString() ?? null,
        exposed: Object.fromEntries(
          exposed.rows.filter((x) => x.experiment === e.key).map((x) => [x.variant, x.players]),
        ),
      })),
    };
  });

  /** A new draft, or changes to one; a key that has run already can't be reused. */
  app.post('/admin/experiments', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const input = parse(AdminExperimentInput, request.body);
    const now = new Date(clock.now());
    const saved = await pool.query(
      `INSERT INTO experiments (key, description, hypothesis, variants, audience, primary_metric, guardrails,
                                created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, hypothesis = EXCLUDED.hypothesis,
              variants = EXCLUDED.variants, audience = EXCLUDED.audience, primary_metric = EXCLUDED.primary_metric,
              guardrails = EXCLUDED.guardrails, updated_at = EXCLUDED.updated_at
        WHERE experiments.status = 'draft'`,
      [
        input.key,
        input.description,
        input.hypothesis,
        JSON.stringify(input.variants),
        JSON.stringify(input.audience),
        input.primary_metric,
        input.guardrails,
        admin.id,
        now,
      ],
    );
    if (saved.rowCount === 0) {
      throw conflict(
        ErrorCode.conflict,
        'This experiment has already run',
        'Its variants and audience stay as they were: give a new one its own key.',
      );
    }
    await writeAudit(pool, {
      actor: admin.id,
      action: 'save_experiment',
      entity: 'experiment',
      entityId: input.key,
      after: input,
      ip: request.ip,
    });
    reply.code(201);
    return load(input.key);
  });

  /** Start a draft, or stop a running one (a stopped experiment doesn't start again). */
  app.post('/admin/experiments/:key', async (request) => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const { key } = parse(Params, request.params);
    const { action, reason } = parse(AdminExperimentAction, request.body);
    const now = new Date(clock.now());
    const changed = await pool.query(
      action === 'start'
        ? "UPDATE experiments SET status = 'running', started_at = $2, updated_at = $2 WHERE key = $1 AND status = 'draft'"
        : "UPDATE experiments SET status = 'stopped', stopped_at = $2, updated_at = $2 WHERE key = $1 AND status = 'running'",
      [key, now],
    );
    if (changed.rowCount === 0) {
      await load(key);
      throw conflict(
        ErrorCode.conflict,
        action === 'start' ? 'Only a draft can start' : 'Only a running experiment can stop',
      );
    }
    await writeAudit(pool, {
      actor: admin.id,
      action: `${action}_experiment`,
      entity: 'experiment',
      entityId: key,
      reason,
      ip: request.ip,
    });
    liveops.forget();
    return load(key);
  });
}
