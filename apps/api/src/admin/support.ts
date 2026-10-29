/**
 * Support in the console (doc 18 §13, build plan step 2.7p): the queue of players' messages,
 * oldest open first, each with the player, their app and whether it reached the helpdesk; a
 * player's own messages on User 360; and answering one, in words the player sees in the app's
 * Help screen, or marking it answered by email. The contact address is masked. Audited.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminSupportTicketUpdate,
  type AdminSupportQueue,
  type AdminSupportTicket,
  type SupportTicketStatus,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { maskEmail } from '../auth/email';
import { notFound, parse } from '../errors';
import { ticketShown, type TicketRow } from '../support/routes';
import { writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';

const Params = z.object({ id: z.string().min(3).max(40) });
const Query = z.object({ status: z.enum(['open', 'answered']).default('open') });
const PAGE = 100;

interface AdminTicketRow extends TicketRow {
  user_id: string;
  player: string | null;
  email: string | null;
  platform: string;
  app_version: string | null;
  device: string | null;
  emailed_at: Date | null;
  answered_by: string | null;
}

const COLUMNS = `t.id, t.topic, t.message, t.status, t.answer, t.created_at, t.answered_at, t.user_id, u.username AS player,
  t.email, t.platform, t.app_version, t.device, t.emailed_at, a.name AS answered_by`;
const FROM = `support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN admin_users a ON a.id = t.answered_by`;

const shown = (t: AdminTicketRow): AdminSupportTicket => ({
  ...ticketShown(t),
  user_id: t.user_id,
  player: t.player,
  email: t.email ? maskEmail(t.email) : null,
  platform: t.platform,
  app_version: t.app_version,
  device: t.device,
  emailed: t.emailed_at !== null,
  answered_by: t.answered_by,
});

export function adminSupportRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;

  app.get('/admin/support', async (request): Promise<AdminSupportQueue> => {
    await requireAdmin(request, ctx, 'players.support');
    const { status } = parse(Query, request.query);
    const [rows, open] = await Promise.all([
      pool.query<AdminTicketRow>(
        `SELECT ${COLUMNS} FROM ${FROM} WHERE t.status = $1
          ORDER BY ${status === 'open' ? 't.created_at' : 't.answered_at DESC'}, t.id LIMIT ${PAGE}`,
        [status],
      ),
      pool.query<{ n: number }>("SELECT count(*)::int AS n FROM support_tickets WHERE status = 'open'"),
    ]);
    return {
      tickets: rows.rows.map(shown),
      open: open.rows[0]!.n,
      inbox: Boolean(config.supportInbox),
    };
  });

  app.get('/admin/users/:id/tickets', async (request): Promise<{ tickets: AdminSupportTicket[] }> => {
    await requireAdmin(request, ctx, 'players.view');
    const { id } = parse(Params, request.params);
    const rows = await pool.query<AdminTicketRow>(
      `SELECT ${COLUMNS} FROM ${FROM} WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 50`,
      [id],
    );
    return { tickets: rows.rows.map(shown) };
  });

  app.post('/admin/support/:id', async (request): Promise<AdminSupportTicket> => {
    const admin = await requireAdmin(request, ctx, 'players.support');
    const { id } = parse(Params, request.params);
    const body = parse(AdminSupportTicketUpdate, request.body);
    const before = (
      await pool.query<{ status: SupportTicketStatus; user_id: string }>(
        'SELECT status, user_id FROM support_tickets WHERE id = $1',
        [id],
      )
    ).rows[0];
    if (!before) throw notFound('No such message.');
    const answered = body.status === 'answered';
    await pool.query(
      `UPDATE support_tickets SET status = $2, answer = CASE WHEN $2 = 'answered' THEN coalesce($3, answer) END,
              answered_by = CASE WHEN $2 = 'answered' THEN $4 END, answered_at = CASE WHEN $2 = 'answered' THEN $5::timestamptz END
        WHERE id = $1`,
      [id, body.status, body.answer ?? null, admin.id, new Date(clock.now())],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: answered ? 'answer_ticket' : 'reopen_ticket',
      entity: 'user',
      entityId: before.user_id,
      before: { ticket: id, status: before.status },
      after: { ticket: id, status: body.status, in_app: Boolean(body.answer) },
      ip: request.ip,
    });
    const row = (await pool.query<AdminTicketRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE t.id = $1`, [id]))
      .rows[0]!;
    return shown(row);
  });
}
