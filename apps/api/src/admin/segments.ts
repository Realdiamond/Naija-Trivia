/**
 * Segments in the console (doc 18 §9, build plan step 2.7o): build a group of players from who
 * they are and what they do, see its size, save it, follow its size day by day, and export its
 * players as pseudonymous ids once a second person approves (doc 18 §8, four eyes). Analysts,
 * growth, owners and admins build them (`segments.manage`); owners and admins approve exports
 * (`segments.approve`), never their own. Every save, export, decision and download is audited.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pseudonymousId } from '@whosabi/analytics/server';
import { addDays, watDate } from '@whosabi/game-rules';
import {
  ErrorCode,
  SegmentDefinition,
  SegmentExportDecision,
  SegmentExportRequest,
  SegmentInput,
  type AdminSegment,
  type AdminSegmentExport,
  type AdminSegmentsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import type { Pool } from '../db';
import { ApiError, conflict, notFound, parse } from '../errors';
import { newId } from '../ids';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';
import { compileSegment } from './segmentSql';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const Params = z.object({ id: z.string().min(3).max(40) });
/** An approved export can be downloaded for a day. */
const EXPORT_HOURS = 24;
/** A segment bigger than this is counted but not exported: export a narrower one. */
export const EXPORT_MAX_ROWS = 200_000;
const TREND_DAYS = 30;

/** How many players a segment holds now. */
export async function countSegment(pool: Pool, definition: SegmentDefinition, now: number): Promise<number> {
  const { where, params } = compileSegment(definition, now);
  const row = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM users u WHERE ${where}`,
    params,
  );
  return row.rows[0]!.n;
}

interface SegmentRow {
  id: string;
  name: string;
  definition: SegmentDefinition;
  created_by: string;
  created_at: Date;
  last_count: number | null;
  last_computed_at: Date | null;
}

interface ExportRow {
  id: string;
  segment_id: string;
  segment_name: string;
  reason: string;
  requested_by: string;
  requested_by_id: string;
  status: AdminSegmentExport['status'];
  decided_by: string | null;
  decided_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

const exportShown = (e: ExportRow, viewer: string): AdminSegmentExport => ({
  id: e.id,
  segment_id: e.segment_id,
  segment_name: e.segment_name,
  reason: e.reason,
  requested_by: e.requested_by,
  status: e.status,
  decided_by: e.decided_by,
  decided_at: e.decided_at?.toISOString() ?? null,
  expires_at: e.expires_at?.toISOString() ?? null,
  created_at: e.created_at.toISOString(),
  yours: e.requested_by_id === viewer,
});

const EXPORT_COLUMNS = `x.id, x.segment_id, s.name AS segment_name, x.reason, coalesce(r.name, x.requested_by) AS requested_by,
  x.requested_by AS requested_by_id, x.status, d.name AS decided_by, x.decided_at, x.expires_at, x.created_at`;
const EXPORT_FROM = `segment_exports x JOIN segments s ON s.id = x.segment_id
  LEFT JOIN admin_users r ON r.id = x.requested_by LEFT JOIN admin_users d ON d.id = x.decided_by`;

export function adminSegmentRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;

  const loadSegment = async (id: string): Promise<SegmentRow> => {
    const row = (
      await pool.query<SegmentRow>(
        `SELECT s.id, s.name, s.definition, coalesce(a.name, s.created_by) AS created_by, s.created_at,
                s.last_count, s.last_computed_at
           FROM segments s LEFT JOIN admin_users a ON a.id = s.created_by WHERE s.id = $1`,
        [id],
      )
    ).rows[0];
    if (!row) throw notFound('No such segment.');
    return row;
  };
  const loadExport = async (id: string): Promise<ExportRow> => {
    const row = (
      await pool.query<ExportRow>(`SELECT ${EXPORT_COLUMNS} FROM ${EXPORT_FROM} WHERE x.id = $1`, [id])
    ).rows[0];
    if (!row) throw notFound('No such export.');
    return row;
  };

  app.get('/admin/segments', async (request): Promise<AdminSegmentsResponse> => {
    const admin = await requireAdmin(request, ctx, 'segments.manage');
    const now = clock.now();
    const [segments, counts, exports] = await Promise.all([
      pool.query<SegmentRow>(
        `SELECT s.id, s.name, s.definition, coalesce(a.name, s.created_by) AS created_by, s.created_at,
                s.last_count, s.last_computed_at
           FROM segments s LEFT JOIN admin_users a ON a.id = s.created_by ORDER BY s.created_at DESC, s.id`,
      ),
      pool.query<{ segment_id: string; day: string; players: number }>(
        `SELECT segment_id, to_char(day, 'YYYY-MM-DD') AS day, players FROM segment_counts
          WHERE day > $1::date ORDER BY day`,
        [addDays(watDate(now), -TREND_DAYS)],
      ),
      pool.query<ExportRow>(
        `SELECT ${EXPORT_COLUMNS} FROM ${EXPORT_FROM}
          WHERE x.status = 'pending' OR x.decided_at > $1 ORDER BY x.created_at DESC LIMIT 50`,
        [new Date(now - 7 * DAY)],
      ),
    ]);
    return {
      segments: segments.rows.map((s): AdminSegment => ({
        id: s.id,
        name: s.name,
        definition: s.definition,
        created_by: s.created_by,
        created_at: s.created_at.toISOString(),
        last_count: s.last_count,
        last_computed_at: s.last_computed_at?.toISOString() ?? null,
        trend: counts.rows
          .filter((c) => c.segment_id === s.id)
          .map((c) => ({ day: c.day, players: c.players })),
      })),
      exports: exports.rows.map((e) => exportShown(e, admin.id)),
    };
  });

  /** The size of a segment being built, before it is saved. */
  app.post('/admin/segments/count', async (request) => {
    await requireAdmin(request, ctx, 'segments.manage');
    const { definition } = parse(z.object({ definition: SegmentDefinition }), request.body);
    return { players: await countSegment(pool, definition, clock.now()) };
  });

  app.post('/admin/segments', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'segments.manage');
    const input = parse(SegmentInput, request.body);
    const now = clock.now();
    const players = await countSegment(pool, input.definition, now);
    const id = newId('sg', now);
    await pool.query(
      `INSERT INTO segments (id, name, definition, created_by, last_count, last_computed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [id, input.name, JSON.stringify(input.definition), admin.id, players, new Date(now)],
    );
    await pool.query(
      `INSERT INTO segment_counts (segment_id, day, players) VALUES ($1, $2, $3)
       ON CONFLICT (segment_id, day) DO UPDATE SET players = EXCLUDED.players`,
      [id, watDate(now), players],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'create_segment',
      entity: 'segment',
      entityId: id,
      after: input,
      ip: request.ip,
    });
    reply.code(201);
    return { id, players };
  });

  app.delete('/admin/segments/:id', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'segments.manage');
    const { id } = parse(Params, request.params);
    const before = await loadSegment(id);
    await pool.query('DELETE FROM segments WHERE id = $1', [id]);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'delete_segment',
      entity: 'segment',
      entityId: id,
      before: { name: before.name, definition: before.definition },
      ip: request.ip,
    });
    return reply.code(204).send();
  });

  /** Ask to export a segment's players; someone else approves it. */
  app.post('/admin/segments/:id/exports', async (request, reply): Promise<AdminSegmentExport> => {
    const admin = await requireAdmin(request, ctx, 'segments.manage');
    const { id } = parse(Params, request.params);
    const { reason } = parse(SegmentExportRequest, request.body);
    const segment = await loadSegment(id);
    const now = clock.now();
    if ((await countSegment(pool, segment.definition, now)) > EXPORT_MAX_ROWS) {
      throw conflict(
        ErrorCode.validation,
        'Too many players to export',
        `Exports hold at most ${EXPORT_MAX_ROWS.toLocaleString('en-NG')} players: narrow the segment.`,
      );
    }
    const exportId = newId('sx', now);
    await pool.query(
      `INSERT INTO segment_exports (id, segment_id, reason, requested_by, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [exportId, id, reason, admin.id, new Date(now)],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'request_segment_export',
      entity: 'segment',
      entityId: id,
      reason,
      after: { export: exportId },
      ip: request.ip,
    });
    reply.code(201);
    return exportShown(await loadExport(exportId), admin.id);
  });

  app.post('/admin/segment-exports/:id/decision', async (request): Promise<AdminSegmentExport> => {
    const admin = await requireAdmin(request, ctx, 'segments.approve');
    const { id } = parse(Params, request.params);
    const { approve } = parse(SegmentExportDecision, request.body);
    const before = await loadExport(id);
    if (before.requested_by_id === admin.id) {
      throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', 'Someone else approves your own export.');
    }
    if (before.status !== 'pending') {
      throw conflict(ErrorCode.validation, 'Already decided', 'This export was decided already.');
    }
    const now = clock.now();
    await pool.query(
      `UPDATE segment_exports SET status = $2, decided_by = $3, decided_at = $4, expires_at = $5 WHERE id = $1`,
      [
        id,
        approve ? 'approved' : 'rejected',
        admin.id,
        new Date(now),
        approve ? new Date(now + EXPORT_HOURS * HOUR) : null,
      ],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: approve ? 'approve_segment_export' : 'reject_segment_export',
      entity: 'segment',
      entityId: before.segment_id,
      after: { export: id },
      ip: request.ip,
    });
    return exportShown(await loadExport(id), admin.id);
  });

  /**
   * The approved export as CSV: each player's pseudonymous id (the one the analytics use), their
   * platform, state and age band. Only the person who asked, for a day after it was approved.
   */
  app.get('/admin/segment-exports/:id/download', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'segments.manage');
    const { id } = parse(Params, request.params);
    const found = await loadExport(id);
    const now = clock.now();
    if (found.requested_by_id !== admin.id) {
      throw new ApiError(
        403,
        ErrorCode.forbidden,
        'Not allowed',
        'Only the person who asked can download it.',
      );
    }
    if (found.status !== 'approved' || !found.expires_at || found.expires_at.getTime() < now) {
      throw new ApiError(
        403,
        ErrorCode.forbidden,
        'Not available',
        found.status === 'approved' ? 'This export has expired: ask again.' : 'This export is not approved.',
      );
    }
    const segment = await loadSegment(found.segment_id);
    const { where, params } = compileSegment(segment.definition, now);
    const players = await pool.query<{
      id: string;
      platform: string | null;
      home_state: string | null;
      age_band: string | null;
    }>(
      `SELECT u.id, coalesce(u.last_platform, u.signup_platform) AS platform, u.home_state, u.age_band::text AS age_band
         FROM users u WHERE ${where} ORDER BY u.id LIMIT ${EXPORT_MAX_ROWS}`,
      params,
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'download_segment_export',
      entity: 'segment',
      entityId: found.segment_id,
      after: { export: id, rows: players.rowCount },
      ip: request.ip,
    });
    const lines = players.rows.map((p) =>
      [
        pseudonymousId(p.id, config.analyticsKey),
        p.platform ?? '',
        p.home_state ?? '',
        p.age_band ?? '',
      ].join(','),
    );
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="whosabi-segment-${found.segment_id}.csv"`)
      .send(['player,platform,home_state,age_band', ...lines].join('\n') + '\n');
  });
}

/** Each saved segment's size today, for its trend; once a day, after 02:00 WAT. */
export async function countSegments(deps: Pick<AppDeps, 'pool' | 'redis' | 'clock'>): Promise<number | null> {
  const now = deps.clock.now();
  if (new Date(now + HOUR).getUTCHours() < 2) return null;
  const day = watDate(now);
  if ((await deps.redis.set(`job:segment-counts:${day}`, '1', 'EX', 2 * 24 * 3600, 'NX')) !== 'OK')
    return null;
  const segments = await deps.pool.query<{ id: string; definition: SegmentDefinition }>(
    'SELECT id, definition FROM segments ORDER BY id',
  );
  for (const s of segments.rows) {
    const players = await countSegment(deps.pool, s.definition, now);
    await deps.pool.query(
      `INSERT INTO segment_counts (segment_id, day, players) VALUES ($1, $2, $3)
       ON CONFLICT (segment_id, day) DO UPDATE SET players = EXCLUDED.players`,
      [s.id, day, players],
    );
    await deps.pool.query('UPDATE segments SET last_count = $2, last_computed_at = $3 WHERE id = $1', [
      s.id,
      players,
      new Date(now),
    ]);
  }
  return segments.rows.length;
}
