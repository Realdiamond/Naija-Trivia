/**
 * Home banners and events in the console (doc 18 §11, doc 16 §2, build plan step 2.7h): staff
 * schedule a banner, or Weekend Wahala's double XP on a category, with a start and an end; it
 * shows on Home while it runs and can be ended early. Owners, admins and LiveOps
 * (`liveops.config`); every change needs a reason and goes in the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminLiveEventCreate,
  AdminLiveEventEnd,
  ErrorCode,
  type AdminLiveEvent,
  type AdminLiveEventsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { withTransaction } from '../db';
import { ApiError, conflict, notFound, parse } from '../errors';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

interface EventRow {
  id: string;
  kind: AdminLiveEvent['kind'];
  title_en: string;
  title_pcm: string | null;
  body_en: string | null;
  body_pcm: string | null;
  action: AdminLiveEvent['action'];
  category_id: string | null;
  platforms: AdminLiveEvent['platforms'];
  starts_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  created_by: string;
}

const SELECT = `SELECT e.id, e.kind, e.title_en, e.title_pcm, e.body_en, e.body_pcm, e.action, e.category_id,
                       e.platforms, e.starts_at, e.ends_at, e.ended_at, a.name AS created_by
                  FROM live_events e JOIN admin_users a ON a.id = e.created_by`;

function view(row: EventRow, now: number): AdminLiveEvent {
  const over = row.ended_at !== null || row.ends_at.getTime() <= now;
  return {
    id: Number(row.id),
    kind: row.kind,
    title_en: row.title_en,
    title_pcm: row.title_pcm,
    body_en: row.body_en,
    body_pcm: row.body_pcm,
    action: row.action,
    category_id: row.category_id,
    platforms: row.platforms,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    ended_at: row.ended_at?.toISOString() ?? null,
    state: over ? 'ended' : row.starts_at.getTime() <= now ? 'live' : 'scheduled',
    created_by: row.created_by,
  };
}

export function adminEventRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, liveops } = deps;

  app.get('/admin/events', async (request): Promise<AdminLiveEventsResponse> => {
    await requireAdmin(request, ctx, 'liveops.config');
    const now = clock.now();
    const [coming, past] = await Promise.all([
      pool.query<EventRow>(
        `${SELECT} WHERE e.ended_at IS NULL AND e.ends_at > $1 ORDER BY e.starts_at, e.id`,
        [new Date(now)],
      ),
      pool.query<EventRow>(
        `${SELECT} WHERE e.ended_at IS NOT NULL OR e.ends_at <= $1
          ORDER BY coalesce(e.ended_at, e.ends_at) DESC, e.id DESC LIMIT 20`,
        [new Date(now)],
      ),
    ]);
    return { events: [...coming.rows, ...past.rows].map((r) => view(r, now)) };
  });

  app.post('/admin/events', async (request): Promise<AdminLiveEvent> => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const body = parse(AdminLiveEventCreate, request.body);
    const now = clock.now();
    if (Date.parse(body.ends_at) <= now) {
      throw new ApiError(400, ErrorCode.validation, 'That has already ended', 'Pick an end in the future.');
    }
    if (body.category_id) {
      const found = await pool.query('SELECT 1 FROM categories WHERE id = $1 AND active', [body.category_id]);
      if (!found.rowCount) {
        throw new ApiError(400, ErrorCode.validation, 'Not a category players can pick', body.category_id);
      }
    }
    const id = await withTransaction(pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO live_events (kind, title_en, title_pcm, body_en, body_pcm, action, category_id, platforms,
                                  starts_at, ends_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          body.kind,
          body.title_en,
          body.title_pcm,
          body.body_en,
          body.body_pcm,
          body.action,
          body.category_id,
          body.platforms,
          new Date(body.starts_at),
          new Date(body.ends_at),
          admin.id,
          new Date(now),
        ],
      );
      const eventId = inserted.rows[0]!.id;
      await writeAudit(client, {
        actor: admin.id,
        action: 'schedule_event',
        entity: 'live_event',
        entityId: eventId,
        reason: body.reason,
        after: { ...body, reason: undefined },
        ip: request.ip,
      });
      return eventId;
    });
    liveops.forget();
    return view((await pool.query<EventRow>(`${SELECT} WHERE e.id = $1`, [id])).rows[0]!, now);
  });

  /** Ends it now, whether it has started or not. */
  app.post('/admin/events/:id/end', async (request): Promise<AdminLiveEvent> => {
    const admin = await requireAdmin(request, ctx, 'liveops.config');
    const { id } = parse(IdParams, request.params);
    const body = parse(AdminLiveEventEnd, request.body);
    const now = clock.now();
    await withTransaction(pool, async (client) => {
      const ended = await client.query(
        'UPDATE live_events SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL AND ends_at > $2',
        [id, new Date(now)],
      );
      if (!ended.rowCount) {
        const exists = await client.query('SELECT 1 FROM live_events WHERE id = $1', [id]);
        if (!exists.rowCount) throw notFound('No such event.');
        throw conflict(ErrorCode.conflict, 'Already over', 'This event has ended.');
      }
      await writeAudit(client, {
        actor: admin.id,
        action: 'end_event',
        entity: 'live_event',
        entityId: String(id),
        reason: body.reason,
        ip: request.ip,
      });
    });
    liveops.forget();
    return view((await pool.query<EventRow>(`${SELECT} WHERE e.id = $1`, [id])).rows[0]!, now);
  });
}
