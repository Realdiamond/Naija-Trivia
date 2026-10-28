/**
 * The admin API for the Staff tab on phones (build plan step 2.9): signing a phone in with the
 * app's own Google sign-in, the console's list of signed-in phones and signing one out, the live
 * numbers the tab opens on, and staff alerts with their settings.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AdminPhoneDevSignIn,
  AdminPhoneSignIn,
  ErrorCode,
  StaffAlertsQuery,
  StaffAlertsSeen,
  StaffPhonePush,
  UpdateStaffAlertSetting,
  type AdminOverview,
  type AdminPhonesResponse,
  type AdminSessionResponse,
  type StaffAlertKind,
  type StaffAlertSettingsResponse,
  type StaffAlertsResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { ApiError, notFound, parse, unauthorized } from '../errors';
import { alertSettings } from './alerts';
import { writeAudit } from './audit';
import { loadAdmin, requireAdmin, type AdminContext, type AdminDeps } from './context';
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

  // ----- Staff alerts (step 2.9b): owners and admins, like staff tools on the phone -----

  async function alertsAdmin(request: FastifyRequest): Promise<AdminContext> {
    const admin = await requireAdmin(request, ctx);
    if (!canUsePhone(admin)) {
      throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', 'Staff alerts are for owners and admins.');
    }
    return admin;
  }

  // The phone sends its push token after signing in, and again when it changes.
  app.post('/admin/phones/push', async (request, reply) => {
    const admin = await alertsAdmin(request);
    if (!admin.phoneSessionId) {
      throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', 'Only a phone signed in to staff tools.');
    }
    const { push_token: token } = parse(StaffPhonePush, request.body);
    // A token belongs to one phone session: an older session on the same phone lets it go.
    await pool.query('UPDATE admin_phone_sessions SET push_token = NULL WHERE push_token = $1 AND id <> $2', [
      token,
      admin.phoneSessionId,
    ]);
    await pool.query('UPDATE admin_phone_sessions SET push_token = $2 WHERE id = $1', [
      admin.phoneSessionId,
      token,
    ]);
    return reply.code(204).send();
  });

  app.get('/admin/alerts', async (request): Promise<StaffAlertsResponse> => {
    const admin = await alertsAdmin(request);
    const { before } = parse(StaffAlertsQuery, request.query);
    const limit = 50;
    const [rows, seen] = await Promise.all([
      pool.query<{
        id: string;
        kind: StaffAlertKind;
        title: string;
        body: string;
        url: string | null;
        created_at: Date;
      }>(
        `SELECT id, kind, title, body, url, created_at FROM staff_alerts
          WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT $2`,
        [before ?? null, limit + 1],
      ),
      pool.query<{ seen: string; unread: number }>(
        `SELECT a.alerts_seen_id AS seen,
                (SELECT count(*)::int FROM staff_alerts s WHERE s.id > a.alerts_seen_id) AS unread
           FROM admin_users a WHERE a.id = $1`,
        [admin.id],
      ),
    ]);
    const seenId = BigInt(seen.rows[0]?.seen ?? '0');
    const page = rows.rows.slice(0, limit);
    return {
      alerts: page.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        url: r.url,
        created_at: r.created_at.toISOString(),
        unread: BigInt(r.id) > seenId,
      })),
      unread: seen.rows[0]?.unread ?? 0,
      next_before: rows.rows.length > limit ? page.at(-1)!.id : null,
    };
  });

  app.post('/admin/alerts/seen', async (request, reply) => {
    const admin = await alertsAdmin(request);
    const { up_to: upTo } = parse(StaffAlertsSeen, request.body);
    await pool.query('UPDATE admin_users SET alerts_seen_id = GREATEST(alerts_seen_id, $2) WHERE id = $1', [
      admin.id,
      upTo,
    ]);
    return reply.code(204).send();
  });

  app.get('/admin/alerts/settings', async (request): Promise<StaffAlertSettingsResponse> => {
    const admin = await alertsAdmin(request);
    return { settings: await alertSettings(pool, admin.id) };
  });

  app.put('/admin/alerts/settings', async (request): Promise<StaffAlertSettingsResponse> => {
    const admin = await alertsAdmin(request);
    const { kind, enabled } = parse(UpdateStaffAlertSetting, request.body);
    await pool.query(
      `INSERT INTO admin_alert_prefs (admin_id, kind, enabled) VALUES ($1, $2, $3)
       ON CONFLICT (admin_id, kind) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [admin.id, kind, enabled],
    );
    return { settings: await alertSettings(pool, admin.id) };
  });
}
