/**
 * Compliance in the console (doc 18 §14, build plan step 2.8a): the data request queue with its
 * 30-day clock. Support logs a request a player made by email or in the help centre; the DPO (and
 * owners) export a player's data and erase an account for them. Each step is in the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminDsarQuery,
  AdminDsarStart,
  AdminReasoned,
  ErrorCode,
  type AdminDsar,
  type AdminDsarResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { DSAR_DAYS, eraseAccount, exportAccount } from '../compliance/erase';
import { ApiError, notFound, parse } from '../errors';
import { newId } from '../ids';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const DAY = 86_400_000;
const UserParams = z.object({ id: z.string().min(3).max(40) });

interface DsarRow {
  id: string;
  user_id: string;
  username: string | null;
  kind: AdminDsar['kind'];
  status: AdminDsar['status'];
  source: AdminDsar['source'];
  note: string | null;
  started_by: string | null;
  handled_by: string | null;
  due_at: Date;
  completed_at: Date | null;
  created_at: Date;
}

export function adminComplianceRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;

  async function exists(id: string): Promise<void> {
    const found = await pool.query('SELECT 1 FROM users WHERE id = $1', [id]);
    if (found.rowCount === 0) throw notFound('No such player.');
  }

  app.get('/admin/dsar', async (request): Promise<AdminDsarResponse> => {
    await requireAdmin(request, ctx, 'compliance.view');
    const { status } = parse(AdminDsarQuery, request.query);
    const rows = await pool.query<DsarRow>(
      `SELECT r.id, r.user_id, u.username::text AS username, r.kind, r.status, r.source, r.note,
              s.name AS started_by,
              CASE WHEN r.handled_by = 'player' THEN 'The player' ELSE coalesce(h.name, r.handled_by) END AS handled_by,
              r.due_at, r.completed_at, r.created_at
         FROM dsar_requests r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN admin_users s ON s.id = r.started_by
         LEFT JOIN admin_users h ON h.id = r.handled_by
        WHERE ${status === 'open' ? "r.status IN ('received', 'in_progress')" : "r.status IN ('completed', 'rejected')"}
        ORDER BY ${status === 'open' ? 'r.due_at' : 'r.completed_at DESC'} LIMIT 200`,
    );
    return {
      requests: rows.rows.map((r) => ({
        ...r,
        due_at: r.due_at.toISOString(),
        completed_at: r.completed_at?.toISOString() ?? null,
        created_at: r.created_at.toISOString(),
      })),
    };
  });

  /** Logged by support (or the DPO) for the DPO to complete within 30 days. */
  app.post('/admin/users/:id/dsar', async (request) => {
    const admin = await requireAdmin(request, ctx);
    if (!admin.permissions.includes('players.support') && !admin.permissions.includes('compliance.view')) {
      throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', 'Support and the DPO log data requests.');
    }
    const { id } = parse(UserParams, request.params);
    const body = parse(AdminDsarStart, request.body);
    await exists(id);
    const now = clock.now();
    const dsarId = newId('ds', now);
    await pool.query(
      `INSERT INTO dsar_requests (id, user_id, kind, status, due_at, created_at, source, started_by, note)
       VALUES ($1, $2, $3, 'received', $4, $5, 'console', $6, $7)`,
      [dsarId, id, body.kind, new Date(now + DSAR_DAYS * DAY), new Date(now), admin.id, body.note],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'start_dsar',
      entity: 'user',
      entityId: id,
      reason: body.note,
      after: { dsar: dsarId, kind: body.kind },
      ip: request.ip,
    });
    return { dsar_id: dsarId };
  });

  /** The player's data as they would download it; completes any open access request. */
  app.post('/admin/users/:id/export', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'compliance.view');
    const { id } = parse(UserParams, request.params);
    const body = parse(AdminReasoned, request.body);
    await exists(id);
    const now = clock.now();
    // Logged before anything leaves (doc 18 §16).
    await writeAudit(pool, {
      actor: admin.id,
      action: 'export_user',
      entity: 'user',
      entityId: id,
      reason: body.reason,
      ip: request.ip,
    });
    const data = await exportAccount(pool, id, now);
    await pool.query(
      `UPDATE dsar_requests SET status = 'completed', completed_at = $2, handled_by = $3
        WHERE user_id = $1 AND kind = 'access' AND status IN ('received', 'in_progress')`,
      [id, new Date(now), admin.id],
    );
    return reply
      .header('content-disposition', `attachment; filename="whosabi-${id}.json"`)
      .header('cache-control', 'no-store')
      .type('application/json')
      .send(JSON.stringify(data, null, 2));
  });

  app.post('/admin/users/:id/erase', async (request) => {
    const admin = await requireAdmin(request, ctx, 'compliance.erase');
    const { id } = parse(UserParams, request.params);
    const body = parse(AdminReasoned, request.body);
    await exists(id);
    const erased = await eraseAccount(pool, config.analyticsKey, id, clock.now(), {
      handledBy: admin.id,
      source: 'console',
      note: body.reason,
    });
    await writeAudit(pool, {
      actor: admin.id,
      action: 'erase_user',
      entity: 'user',
      entityId: id,
      reason: body.reason,
      after: { dsar: erased.dsarId, erased: erased.erased },
      ip: request.ip,
    });
    return { dsar_id: erased.dsarId, erased: erased.erased };
  });
}
