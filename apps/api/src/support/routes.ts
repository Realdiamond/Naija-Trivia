/**
 * Writing to support from the app's Help screen (doc 16 §3, build plan step 2.7p). The message
 * carries the player's platform, app version and device, and is kept for User 360 and the
 * console's queue. With SUPPORT_INBOX set it is emailed there too, the helpdesk's inbox, with the
 * player's address to reply to and a link to their page in the console. A message that can't be
 * emailed is still kept, and the console says so.
 */
import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  SupportTicketRequest,
  type MySupportTicket,
  type MySupportTickets,
  type SupportTopic,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { ApiError, parse } from '../errors';
import { newId } from '../ids';

const HOUR = 3_600_000;
/** Messages a player can send in an hour. */
const PER_HOUR = 5;

export const TOPIC_LABEL: Record<SupportTopic, string> = {
  purchase: 'Coins or a purchase',
  streak: 'Daily streak',
  question: 'A question or answer',
  account: 'Account or username',
  sign_in: 'Signing in',
  ban: 'A ban or warning',
  other: 'Something else',
};

export interface TicketRow {
  id: string;
  topic: SupportTopic;
  message: string;
  status: MySupportTicket['status'];
  answer: string | null;
  created_at: Date;
  answered_at: Date | null;
}

export const ticketShown = (t: TicketRow): MySupportTicket => ({
  id: t.id,
  topic: t.topic,
  message: t.message,
  status: t.status,
  answer: t.answer,
  created_at: t.created_at.toISOString(),
  answered_at: t.answered_at?.toISOString() ?? null,
});

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function supportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, clock, config } = deps;

  app.post('/v1/support/tickets', async (request, reply): Promise<MySupportTicket> => {
    const auth = requireAuth(request);
    const body = parse(SupportTicketRequest, request.body);
    const now = clock.now();
    const recent = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM support_tickets WHERE user_id = $1 AND created_at > $2',
      [auth.userId, new Date(now - HOUR)],
    );
    if (recent.rows[0]!.n >= PER_HOUR) {
      throw new ApiError(
        429,
        ErrorCode.rateLimited,
        'You have sent a few messages already',
        'We read every one. Wait a little before sending another.',
        3600,
      );
    }
    const header = request.headers['x-app-version'];
    const appVersion = typeof header === 'string' && header.length <= 32 ? header : null;
    const id = newId('st', now);
    const row = (
      await pool.query<TicketRow>(
        `INSERT INTO support_tickets (id, user_id, topic, message, email, platform, app_version, device, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, topic, message, status, answer, created_at, answered_at`,
        [
          id,
          auth.userId,
          body.topic,
          body.message,
          body.email ?? null,
          auth.platform,
          appVersion,
          body.device ?? null,
          new Date(now),
        ],
      )
    ).rows[0]!;

    const sender = deps.auth.email;
    if (config.supportInbox && sender) {
      const player = (
        await pool.query<{ username: string | null }>('SELECT username FROM users WHERE id = $1', [
          auth.userId,
        ])
      ).rows[0]?.username;
      const page = `${config.adminWebUrl}/players/${encodeURIComponent(auth.userId)}?tab=support`;
      const facts = [
        `Topic: ${TOPIC_LABEL[body.topic]}`,
        `Player: ${player ?? 'a guest'} (${auth.userId})`,
        `Reply to: ${body.email ?? 'no email given: answer in the console and it shows in their app'}`,
        `App: ${auth.platform}${appVersion ? ` ${appVersion}` : ''}${body.device ? `, ${body.device}` : ''}`,
        `Their page in the console: ${page}`,
      ];
      try {
        await sender.send({
          to: config.supportInbox,
          subject: `${TOPIC_LABEL[body.topic]}: ${player ?? 'a guest'} (${id})`,
          text: `${body.message}\n\n--\n${facts.join('\n')}`,
          html: `<p style="white-space:pre-wrap">${escape(body.message)}</p><hr><p>${facts
            .map((f) => escape(f))
            .join('<br>')}</p>`,
          ...(body.email ? { replyTo: body.email } : {}),
        });
        await pool.query('UPDATE support_tickets SET emailed_at = $2 WHERE id = $1', [
          id,
          new Date(clock.now()),
        ]);
      } catch (err) {
        request.log.warn({ err, ticket: id }, 'support ticket not emailed; it is in the console');
      }
    }
    reply.code(201);
    return ticketShown(row);
  });

  app.get('/v1/support/tickets', async (request): Promise<MySupportTickets> => {
    const { userId } = requireAuth(request);
    const rows = await pool.query<TicketRow>(
      `SELECT id, topic, message, status, answer, created_at, answered_at FROM support_tickets
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId],
    );
    return { tickets: rows.rows.map(ticketShown) };
  });
}
