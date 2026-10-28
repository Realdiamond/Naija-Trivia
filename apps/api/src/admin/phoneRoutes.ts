/**
 * The admin API for the Staff tab on phones (build plan step 2.9a): signing a phone in with the
 * app's own Google sign-in, the console's list of signed-in phones and signing one out, and the
 * live numbers the tab opens on.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AdminPhoneDevSignIn,
  AdminPhoneSignIn,
  ErrorCode,
  type AdminOverview,
  type AdminPhonesResponse,
  type AdminSessionResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { ApiError, notFound, parse, unauthorized } from '../errors';
import { writeAudit } from './audit';
import { loadAdmin, requireAdmin, type AdminDeps } from './context';
import { liveNumbers } from './overview';
import { canUsePhone, createPhoneSession, revokePhoneSession } from './phones';
import { SYSTEM_ADMIN_ID } from './permissions';

const PhoneParams = z.object({ id: z.string().regex(/^aph_[0-9A-Z]{26}$/) });

export function adminPhoneRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;
  const signInLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  async function signInPhone(
    request: FastifyRequest,
    email: string,
    label: string,
    method: 'google' | 'dev',
  ): Promise<AdminSessionResponse> {
    const refuse = async (reason: string, detail: string) => {
      await writeAudit(pool, {
        actor: 'system',
        action: 'sign_in_refused',
        entity: 'admin',
        entityId: email,
        after: { method: `phone_${method}`, reason },
        ip: request.ip,
      });
      return new ApiError(403, ErrorCode.forbidden, 'No access', detail);
    };
    const found = await pool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email = $1 AND status = 'active' AND id <> $2",
      [email, SYSTEM_ADMIN_ID],
    );
    const admin = found.rows[0] ? await loadAdmin(pool, found.rows[0].id, clock.now()) : null;
    if (!admin || admin.roles.length === 0) {
      throw await refuse('not_staff', 'This account is not on the staff list. Ask an owner to add you.');
    }
    if (!canUsePhone(admin)) {
      throw await refuse('role', 'Staff tools on the phone are for owners and admins for now.');
    }
    const now = clock.now();
    const session = await createPhoneSession(pool, admin.id, label, now);
    await pool.query('UPDATE admin_users SET last_login_at = $2 WHERE id = $1', [admin.id, new Date(now)]);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'sign_in',
      entity: 'admin',
      entityId: admin.id,
      after: { method: `phone_${method}`, phone: label, session: session.id },
      ip: request.ip,
    });
    return { token: session.token, expires_at: new Date(session.expiresAt).toISOString(), admin };
  }

  // The app's own Google sign-in: its ID tokens are for the game's client ids (GOOGLE_CLIENT_IDS).
  app.post('/admin/auth/phone', signInLimit, async (request) => {
    const verifier = deps.auth.google;
    if (!verifier) {
      throw new ApiError(
        503,
        ErrorCode.providerUnavailable,
        'Google sign-in is not set up',
        'Set GOOGLE_CLIENT_IDS on the API.',
      );
    }
    const { id_token: idToken, label } = parse(AdminPhoneSignIn, request.body);
    const identity = await verifier.verify(idToken).catch(() => {
      throw new ApiError(401, ErrorCode.idTokenInvalid, 'Sign-in could not be confirmed');
    });
    if (!identity.email || !identity.emailVerified) {
      throw unauthorized('Use a Google account with a confirmed email address.');
    }
    if (config.adminGoogleDomain && identity.hostedDomain !== config.adminGoogleDomain) {
      throw new ApiError(
        403,
        ErrorCode.forbidden,
        'No access',
        `Sign in with your @${config.adminGoogleDomain} account.`,
      );
    }
    return signInPhone(request, identity.email.toLowerCase(), label, 'google');
  });

  // Development and tests only, like /admin/auth/dev.
  if (config.env !== 'production') {
    app.post('/admin/auth/phone/dev', signInLimit, async (request) => {
      const { email, label } = parse(AdminPhoneDevSignIn, request.body);
      return signInPhone(request, email.toLowerCase(), label, 'dev');
    });
  }

  // Owners and admins see every staff phone; anyone else only their own.
  app.get('/admin/phones', async (request): Promise<AdminPhonesResponse> => {
    const admin = await requireAdmin(request, ctx);
    const everyone = canUsePhone(admin);
    const rows = await pool.query<{
      id: string;
      admin_id: string;
      admin_name: string;
      label: string;
      created_at: Date;
      last_used_at: Date;
      expires_at: Date;
    }>(
      `SELECT s.id, s.admin_id, a.name AS admin_name, s.label, s.created_at, s.last_used_at, s.expires_at
         FROM admin_phone_sessions s JOIN admin_users a ON a.id = s.admin_id
        WHERE s.revoked_at IS NULL AND s.expires_at > $1 AND ($2 OR s.admin_id = $3)
        ORDER BY s.last_used_at DESC`,
      [new Date(clock.now()), everyone, admin.id],
    );
    return {
      phones: rows.rows.map((r) => ({
        id: r.id,
        admin_id: r.admin_id,
        admin_name: r.admin_name,
        label: r.label,
        created_at: r.created_at.toISOString(),
        last_used_at: r.last_used_at.toISOString(),
        expires_at: r.expires_at.toISOString(),
        current: r.id === admin.phoneSessionId,
      })),
    };
  });

  app.post('/admin/phones/:id/revoke', async (request, reply) => {
    const admin = await requireAdmin(request, ctx);
    const { id } = parse(PhoneParams, request.params);
    const owner = await pool.query<{ admin_id: string }>(
      'SELECT admin_id FROM admin_phone_sessions WHERE id = $1 AND revoked_at IS NULL',
      [id],
    );
    const target = owner.rows[0]?.admin_id;
    if (!target || (target !== admin.id && !canUsePhone(admin))) throw notFound('No such phone.');
    if (await revokePhoneSession(pool, id, admin.id, clock.now())) {
      await writeAudit(pool, {
        actor: admin.id,
        action: 'sign_out_phone',
        entity: 'admin',
        entityId: target,
        after: { session: id },
        ip: request.ip,
      });
    }
    return reply.code(204).send();
  });

  app.get('/admin/overview', async (request): Promise<AdminOverview> => {
    await requireAdmin(request, ctx, 'overview.view');
    return liveNumbers(pool, clock.now());
  });
}
