/**
 * Moderation and integrity (doc 18 §8 and §12, doc 10 §2, build plan step 2.7d). Moderators,
 * admins and owners (`players.moderate`) warn a player (who reads it next time they open the
 * game), take a username away (they pick a new one), hide a player from the boards others see,
 * and ban: up to 30 days, or longer and for good with an admin. A ban signs the player out
 * everywhere. Every action needs a reason and is in the audit log and `moderation_actions`.
 * The integrity queue lists the nightly job's flags; nothing bans anyone automatically.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminIntegrityQuery,
  AdminIntegrityReview,
  ErrorCode,
  MODERATOR_BAN_DAYS,
  type AdminIntegrityFlag,
  type AdminIntegrityResponse,
  type AdminPlayerAction,
  type AdminPlayerActionResponse,
  type AdminSafetyResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { withTransaction, type Pool, type PoolClient } from '../db';
import { ApiError, conflict, notFound, parse } from '../errors';
import { unban } from '../moderation/bans';
import { writeAudit } from './audit';
import { requireAdmin, type AdminContext, type AdminDeps } from './context';

const DAY = 86_400_000;
const UserParams = z.object({ id: z.string().min(3).max(40) });
const FlagParams = z.object({ id: z.coerce.number().int().positive() });

type ModerationAction = Extract<
  AdminPlayerAction,
  { type: 'warn' | 'rename' | 'shadow_restrict' | 'unrestrict' | 'ban' | 'unban' }
>;

const nothingToDo = (detail: string) => conflict(ErrorCode.conflict, 'Nothing to change', detail);

interface Target {
  status: string;
  username: string | null;
  banned_until: Date | null;
  hidden_from_boards: boolean;
}

/** One moderation action on a player, in one transaction with its record and audit entry. */
export async function moderate(
  deps: Pick<AppDeps, 'pool' | 'clock'>,
  admin: AdminContext,
  userId: string,
  action: ModerationAction,
  ip: string,
): Promise<AdminPlayerActionResponse> {
  const now = deps.clock.now();
  const at = new Date(now);
  const senior = admin.roles.includes('owner') || admin.roles.includes('admin');
  if (action.type === 'ban' && (action.days === null || action.days > MODERATOR_BAN_DAYS) && !senior) {
    throw new ApiError(
      403,
      ErrorCode.forbidden,
      'Needs an admin',
      `Moderators ban for up to ${MODERATOR_BAN_DAYS} days. Longer, or for good, needs an admin (doc 18 §8).`,
    );
  }
  return withTransaction(deps.pool, async (client) => {
    const target = (
      await client.query<Target>(
        'SELECT status, username, banned_until, hidden_from_boards FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      )
    ).rows[0]!;
    if (target.status === 'deleted' || target.status === 'bot') {
      throw conflict(ErrorCode.conflict, 'Not possible', 'This account is deleted or is the Sabi Bot.');
    }
    const record = (extra: { message?: string; endsAt?: Date | null; details?: object } = {}) =>
      client.query(
        `INSERT INTO moderation_actions (target_user_id, action, reason, actor, created_at, message, ends_at, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          action.type,
          action.reason,
          admin.id,
          at,
          extra.message ?? null,
          extra.endsAt ?? null,
          extra.details ? JSON.stringify(extra.details) : null,
        ],
      );
    const audit = (before: unknown, after: unknown) =>
      writeAudit(client, {
        actor: admin.id,
        action: action.type,
        entity: 'user',
        entityId: userId,
        reason: action.reason,
        before,
        after,
        ip,
      });

    switch (action.type) {
      case 'warn':
        await record({ message: action.message });
        await audit(null, { message: action.message });
        return { done: 'Warned. They read it the next time they open the game.' };

      case 'rename':
        if (!target.username) throw nothingToDo('This player has no username.');
        await client.query('UPDATE users SET username = NULL, updated_at = $2 WHERE id = $1', [userId, at]);
        await record({ details: { old_username: target.username } });
        await audit({ username: target.username }, { username: null });
        return { done: `Took "${target.username}" away. They pick a new username next time they play.` };

      case 'shadow_restrict':
      case 'unrestrict': {
        const hide = action.type === 'shadow_restrict';
        if (target.hidden_from_boards === hide) {
          throw nothingToDo(hide ? 'Already hidden from the boards.' : 'Not hidden from the boards.');
        }
        await client.query('UPDATE users SET hidden_from_boards = $2, updated_at = $3 WHERE id = $1', [
          userId,
          hide,
          at,
        ]);
        await record();
        await audit({ hidden_from_boards: !hide }, { hidden_from_boards: hide });
        return {
          done: hide
            ? 'Hidden from the boards other players see. They still play and see themselves.'
            : 'Back on the boards.',
        };
      }

      case 'ban': {
        const until = action.days === null ? null : new Date(now + action.days * DAY);
        await client.query(
          "UPDATE users SET status = 'banned', banned_until = $2, updated_at = $3 WHERE id = $1",
          [userId, until, at],
        );
        // Out at once: no session can be refreshed (an open app notices within 15 minutes).
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
          [userId, at],
        );
        await record({ endsAt: until });
        await audit(
          { status: target.status, banned_until: target.banned_until },
          { status: 'banned', banned_until: until },
        );
        return {
          done: until
            ? `Banned for ${action.days} day${action.days === 1 ? '' : 's'}, and signed out everywhere.`
            : 'Banned for good, and signed out everywhere.',
        };
      }

      case 'unban': {
        if (target.status !== 'banned') throw nothingToDo('This player is not banned.');
        const status = await unban(client, userId, now, { actor: admin.id, reason: action.reason });
        await audit({ status: 'banned', banned_until: target.banned_until }, { status });
        return { done: 'Ban lifted. They can sign in again.' };
      }
    }
  });
}

interface FlagRow {
  id: string;
  user_id: string;
  username: string | null;
  kind: AdminIntegrityFlag['kind'];
  score: number;
  evidence: Record<string, unknown>;
  status: AdminIntegrityFlag['status'];
  created_at: Date;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
}

const FLAG_SELECT = `
  SELECT f.id, f.user_id, u.username::text AS username, f.kind, f.score, f.evidence, f.status, f.created_at,
         a.name AS reviewed_by, f.reviewed_at, f.review_note
    FROM integrity_flags f
    JOIN users u ON u.id = f.user_id
    LEFT JOIN admin_users a ON a.id = f.reviewed_by`;

const flagView = (r: FlagRow): AdminIntegrityFlag => ({
  ...r,
  id: Number(r.id),
  created_at: r.created_at.toISOString(),
  reviewed_at: r.reviewed_at?.toISOString() ?? null,
});

async function flagsFor(db: Pool | PoolClient, ids: string[]): Promise<AdminIntegrityFlag[]> {
  const rows = await db.query<FlagRow>(
    `${FLAG_SELECT} WHERE f.user_id = ANY($1) ORDER BY f.created_at DESC LIMIT 50`,
    [ids],
  );
  return rows.rows.map(flagView);
}

export function adminModerationRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock } = deps;

  /** User 360's Safety tab: moderation history and integrity flags (merged guests included). */
  app.get('/admin/users/:id/safety', async (request): Promise<AdminSafetyResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const { id } = parse(UserParams, request.params);
    const ids = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1
       UNION ALL SELECT guest_id FROM user_merges WHERE into_user_id = $1`,
      [id],
    );
    if (!ids.rows.some((r) => r.id === id)) throw notFound('No such player.');
    const [moderation, flags] = await Promise.all([
      pool.query<{
        id: string;
        action: string;
        reason: string;
        message: string | null;
        ends_at: Date | null;
        details: Record<string, unknown> | null;
        actor: string;
        created_at: Date;
        seen_at: Date | null;
      }>(
        `SELECT m.id, m.action, m.reason, m.message, m.ends_at, m.details,
                CASE WHEN m.actor = 'system' THEN 'Automatic' ELSE coalesce(a.name, m.actor) END AS actor,
                m.created_at, m.seen_at
           FROM moderation_actions m LEFT JOIN admin_users a ON a.id = m.actor
          WHERE m.target_user_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
        [id],
      ),
      flagsFor(
        pool,
        ids.rows.map((r) => r.id),
      ),
    ]);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'view_user_tab',
      entity: 'user',
      entityId: id,
      after: { tab: 'safety' },
      ip: request.ip,
    });
    return {
      moderation: moderation.rows.map((m) => ({
        ...m,
        id: Number(m.id),
        ends_at: m.ends_at?.toISOString() ?? null,
        created_at: m.created_at.toISOString(),
        seen_at: m.seen_at?.toISOString() ?? null,
      })),
      flags,
    };
  });

  /** The integrity queue, riskiest first. */
  app.get('/admin/integrity', async (request): Promise<AdminIntegrityResponse> => {
    await requireAdmin(request, ctx, 'players.moderate');
    const { status } = parse(AdminIntegrityQuery, request.query);
    const rows = await pool.query<FlagRow>(
      `${FLAG_SELECT} WHERE f.status = $1
        ORDER BY ${status === 'open' ? 'f.score DESC, f.created_at' : 'f.reviewed_at DESC'} LIMIT 100`,
      [status],
    );
    return { flags: rows.rows.map(flagView) };
  });

  /** Nothing in it, or acted on (the action itself is taken on User 360). */
  app.post('/admin/integrity/:id', async (request): Promise<AdminIntegrityFlag> => {
    const admin = await requireAdmin(request, ctx, 'players.moderate');
    const { id } = parse(FlagParams, request.params);
    const body = parse(AdminIntegrityReview, request.body);
    const updated = await pool.query<{ user_id: string }>(
      `UPDATE integrity_flags SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = $5
        WHERE id = $1 AND status = 'open' RETURNING user_id`,
      [id, body.status, body.note, admin.id, new Date(clock.now())],
    );
    if (!updated.rows[0]) throw notFound('No such open flag.');
    await writeAudit(pool, {
      actor: admin.id,
      action: 'review_flag',
      entity: 'user',
      entityId: updated.rows[0].user_id,
      reason: body.note,
      after: { flag: id, status: body.status },
      ip: request.ip,
    });
    return (await pool.query<FlagRow>(`${FLAG_SELECT} WHERE f.id = $1`, [id])).rows.map(flagView)[0]!;
  });
}
