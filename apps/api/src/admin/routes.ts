/**
 * The admin API, part one (doc 09 §2.10, doc 18 §3, §16): staff sign-in, the audit log, and
 * staff and roles. Players are in players.ts, content in content.ts, phones in phoneRoutes.ts. Every request needs a staff session and the
 * permission for it, and goes into the audit log, reads included.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AdminAddStaff,
  AdminAuditQuery,
  AdminDevSignIn,
  AdminGoogleSignIn,
  AdminGrantRole,
  AdminRole,
  ErrorCode,
  PRIVILEGED_ROLES,
  type AdminAuditResponse,
  type AdminProfile,
  type AdminSessionResponse,
  type AdminStaffMember,
  type AdminStaffResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import type { Pool } from '../db';
import { ApiError, conflict, notFound, parse, unauthorized } from '../errors';
import { newId } from '../ids';
import { auditPage, writeAudit } from './audit';
import { bearerToken, loadAdmin, requireAdmin, type AdminDeps } from './context';
import { isActiveGrant, SYSTEM_ADMIN_ID, type GrantRow } from './permissions';
import { adminContentRoutes } from './content';
import { adminPhoneRoutes } from './phoneRoutes';
import { isPhoneToken, phoneSessionFor, revokePhoneSession } from './phones';
import { adminComplianceRoutes } from './compliance';
import { adminAlertRuleRoutes } from './alertRules';
import { adminAnalyticsRoutes } from './analytics';
import { adminCommerceRoutes } from './commerce';
import { adminDailyRoutes } from './dailyScheduler';
import { adminEventRoutes } from './events';
import { adminLiveOpsRoutes } from './liveops';
import { adminModerationRoutes } from './moderation';
import { adminPlayer360Routes } from './player360';
import { adminPlayerRoutes } from './players';
import { AdminSessions } from './sessions';

const StaffParams = z.object({ id: z.string().min(3).max(40) });
const RoleParams = StaffParams.extend({ role: AdminRole });

export function adminRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, redis, clock, config } = deps;
  const ctx: AdminDeps = { pool, sessions: new AdminSessions(redis, clock.now), now: clock.now };
  const signInLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  async function startSession(
    request: FastifyRequest,
    email: string,
    method: 'google' | 'dev',
  ): Promise<AdminSessionResponse> {
    const found = await pool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE email = $1 AND status = 'active' AND id <> $2",
      [email, SYSTEM_ADMIN_ID],
    );
    const id = found.rows[0]?.id;
    const admin = id ? await loadAdmin(pool, id, clock.now()) : null;
    if (!admin || admin.roles.length === 0) {
      await writeAudit(pool, {
        actor: 'system',
        action: 'sign_in_refused',
        entity: 'admin',
        entityId: email,
        ip: request.ip,
      });
      throw new ApiError(
        403,
        ErrorCode.forbidden,
        'No access',
        'This account is not on the staff list. Ask an owner to add you.',
      );
    }
    await pool.query('UPDATE admin_users SET last_login_at = $2 WHERE id = $1', [
      admin.id,
      new Date(clock.now()),
    ]);
    const session = await ctx.sessions.create(admin.id);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'sign_in',
      entity: 'admin',
      entityId: admin.id,
      after: { method },
      ip: request.ip,
    });
    return { token: session.token, expires_at: new Date(session.expiresAt).toISOString(), admin };
  }

  app.post('/admin/auth/google', signInLimit, async (request) => {
    const verifier = deps.auth.adminGoogle;
    if (!verifier) {
      throw new ApiError(
        503,
        ErrorCode.providerUnavailable,
        'Google sign-in is not set up',
        'Set ADMIN_GOOGLE_CLIENT_IDS on the API.',
      );
    }
    const { id_token: idToken } = parse(AdminGoogleSignIn, request.body);
    const identity = await verifier.verify(idToken).catch(() => {
      throw new ApiError(401, ErrorCode.idTokenInvalid, 'Sign-in could not be confirmed');
    });
    if (!identity.email || !identity.emailVerified) {
      throw unauthorized('Use a Google account with a confirmed email address.');
    }
    // Google Workspace only, when the team sets its domain (doc 18 §16).
    if (config.adminGoogleDomain && identity.hostedDomain !== config.adminGoogleDomain) {
      throw new ApiError(
        403,
        ErrorCode.forbidden,
        'No access',
        `Sign in with your @${config.adminGoogleDomain} account.`,
      );
    }
    return startSession(request, identity.email.toLowerCase(), 'google');
  });

  // Development and tests sign in by email alone; production never has this route.
  if (config.env !== 'production') {
    app.post('/admin/auth/dev', signInLimit, async (request) =>
      startSession(request, parse(AdminDevSignIn, request.body).email.toLowerCase(), 'dev'),
    );
  }

  app.post('/admin/auth/logout', async (request, reply) => {
    const token = bearerToken(request);
    // A phone signing out of staff tools ends its 30-day session.
    const phone = token && isPhoneToken(token) ? await phoneSessionFor(pool, token, clock.now()) : null;
    if (phone) await revokePhoneSession(pool, phone.id, phone.adminId, clock.now());
    const adminId = phone ? phone.adminId : token ? await ctx.sessions.adminFor(token) : null;
    if (token && !phone) await ctx.sessions.end(token);
    if (adminId) {
      await writeAudit(pool, {
        actor: adminId,
        action: 'sign_out',
        entity: 'admin',
        entityId: adminId,
        ip: request.ip,
      });
    }
    return reply.code(204).send();
  });

  app.get('/admin/me', async (request): Promise<AdminProfile> => {
    const { token: _token, phoneSessionId: _phone, ...admin } = await requireAdmin(request, ctx);
    return admin;
  });

  app.get('/admin/audit', async (request): Promise<AdminAuditResponse> => {
    const admin = await requireAdmin(request, ctx, 'audit.view');
    const query = parse(AdminAuditQuery, request.query);
    const page = await auditPage(pool, query);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'view_audit',
      entity: 'audit_log',
      after: { entity: query.entity, entity_id: query.entity_id, actor: query.actor },
      ip: request.ip,
    });
    return page;
  });

  // ----- Staff and roles (owners only; doc 18 §3) -----

  app.get('/admin/staff', async (request): Promise<AdminStaffResponse> => {
    const admin = await requireAdmin(request, ctx, 'staff.manage');
    const staff = await staffList(pool, clock.now());
    await writeAudit(pool, { actor: admin.id, action: 'view_staff', entity: 'admin', ip: request.ip });
    return { staff };
  });

  app.post('/admin/staff', async (request, reply) => {
    const admin = await requireAdmin(request, ctx, 'staff.manage');
    const body = parse(AdminAddStaff, request.body);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [newId('adm'), body.email.toLowerCase(), body.name],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw conflict(ErrorCode.conflict, 'Already on the staff list');
    await writeAudit(pool, {
      actor: admin.id,
      action: 'add_staff',
      entity: 'admin',
      entityId: id,
      after: { email: body.email.toLowerCase(), name: body.name },
      ip: request.ip,
    });
    return reply.code(201).send(await staffMember(pool, id, clock.now()));
  });

  app.post('/admin/staff/:id/roles', async (request): Promise<AdminStaffMember> => {
    const admin = await requireAdmin(request, ctx, 'staff.manage');
    const { id } = parse(StaffParams, request.params);
    const body = parse(AdminGrantRole, request.body);
    await requireStaff(pool, id);
    const previous = await grantOf(pool, id, body.role);
    // A new grant of a privileged role waits for a second owner, even if it replaces one.
    await pool.query(
      `INSERT INTO admin_role_grants (admin_id, role, granted_by, approved_by, expires_at)
       VALUES ($1, $2, $3, NULL, $4)
       ON CONFLICT (admin_id, role) DO UPDATE
         SET granted_by = EXCLUDED.granted_by, approved_by = NULL, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [id, body.role, admin.id, body.expires_at ?? null],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'grant_role',
      entity: 'admin',
      entityId: id,
      reason: body.reason,
      before: previous,
      after: { role: body.role, expires_at: body.expires_at ?? null },
      ip: request.ip,
    });
    return staffMember(pool, id, clock.now());
  });

  app.post('/admin/staff/:id/roles/:role/approve', async (request): Promise<AdminStaffMember> => {
    const admin = await requireAdmin(request, ctx, 'staff.manage');
    const { id, role } = parse(RoleParams, request.params);
    const grant = await grantOf(pool, id, role);
    if (!grant) throw notFound('That role has not been granted.');
    if (!PRIVILEGED_ROLES.includes(role) || grant.approved_by) {
      throw conflict(ErrorCode.conflict, 'Nothing to approve');
    }
    if (admin.id === grant.granted_by || admin.id === id) {
      throw conflict(
        ErrorCode.conflict,
        'A second person must approve',
        'Nobody approves a grant they made or their own.',
      );
    }
    await pool.query(
      'UPDATE admin_role_grants SET approved_by = $3 WHERE admin_id = $1 AND role = $2 AND approved_by IS NULL',
      [id, role, admin.id],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'approve_role',
      entity: 'admin',
      entityId: id,
      after: { role },
      ip: request.ip,
    });
    return staffMember(pool, id, clock.now());
  });

  app.delete('/admin/staff/:id/roles/:role', async (request): Promise<AdminStaffMember> => {
    const admin = await requireAdmin(request, ctx, 'staff.manage');
    const { id, role } = parse(RoleParams, request.params);
    const grant = await grantOf(pool, id, role);
    if (!grant) throw notFound('That role has not been granted.');
    if (role === 'owner') {
      // Someone must always be able to manage staff.
      const owners = (await staffList(pool, clock.now())).filter((s) =>
        s.grants.some((g) => g.role === 'owner' && g.active),
      );
      if (owners.every((o) => o.id === id)) {
        throw conflict(ErrorCode.conflict, 'The last owner stays', 'Make someone else an owner first.');
      }
    }
    await pool.query('DELETE FROM admin_role_grants WHERE admin_id = $1 AND role = $2', [id, role]);
    await writeAudit(pool, {
      actor: admin.id,
      action: 'revoke_role',
      entity: 'admin',
      entityId: id,
      before: grant,
      ip: request.ip,
    });
    return staffMember(pool, id, clock.now());
  });

  adminPlayerRoutes(app, deps, ctx);
  adminPlayer360Routes(app, deps, ctx);
  adminContentRoutes(app, deps, ctx);
  adminPhoneRoutes(app, deps, ctx);
  adminLiveOpsRoutes(app, deps, ctx);
  adminEventRoutes(app, deps, ctx);
  adminCommerceRoutes(app, deps, ctx);
  adminAnalyticsRoutes(app, deps, ctx);
  adminAlertRuleRoutes(app, deps, ctx);
  adminModerationRoutes(app, deps, ctx);
  adminDailyRoutes(app, deps, ctx);
  adminComplianceRoutes(app, deps, ctx);
}

async function requireStaff(pool: Pool, id: string): Promise<void> {
  const found = await pool.query('SELECT 1 FROM admin_users WHERE id = $1 AND id <> $2', [
    id,
    SYSTEM_ADMIN_ID,
  ]);
  if (found.rowCount === 0) throw notFound('No such staff member.');
}

async function grantOf(pool: Pool, id: string, role: AdminRole): Promise<GrantRow | null> {
  const found = await pool.query<GrantRow>(
    'SELECT role, granted_by, approved_by, expires_at FROM admin_role_grants WHERE admin_id = $1 AND role = $2',
    [id, role],
  );
  return found.rows[0] ?? null;
}

async function staffList(pool: Pool, now: number): Promise<AdminStaffMember[]> {
  const users = await pool.query<{
    id: string;
    email: string;
    name: string;
    status: AdminStaffMember['status'];
    last_login_at: Date | null;
    created_at: Date;
  }>(
    'SELECT id, email, name, status, last_login_at, created_at FROM admin_users WHERE id <> $1 ORDER BY created_at',
    [SYSTEM_ADMIN_ID],
  );
  const grants = await pool.query<GrantRow & { admin_id: string; created_at: Date }>(
    'SELECT admin_id, role, granted_by, approved_by, expires_at, created_at FROM admin_role_grants ORDER BY role',
  );
  return users.rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    last_login_at: u.last_login_at?.toISOString() ?? null,
    created_at: u.created_at.toISOString(),
    grants: grants.rows
      .filter((g) => g.admin_id === u.id)
      .map((g) => ({
        role: g.role,
        granted_by: g.granted_by,
        active: isActiveGrant(g, now),
        approved_by: g.approved_by,
        expires_at: g.expires_at?.toISOString() ?? null,
        created_at: g.created_at.toISOString(),
      })),
  }));
}

async function staffMember(pool: Pool, id: string, now: number): Promise<AdminStaffMember> {
  const member = (await staffList(pool, now)).find((s) => s.id === id);
  if (!member) throw notFound('No such staff member.');
  return member;
}
