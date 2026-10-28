/**
 * Who is calling the admin API (doc 09 §2.10): `Authorization: Bearer <staff session>`. Roles
 * are read from Postgres on every request, so a removed role or a suspended account stops
 * working at once; the console only hides what the server would refuse anyway.
 */
import type { FastifyRequest } from 'fastify';
import { ErrorCode, type AdminPermission, type AdminProfile, type AdminRole } from '@whosabi/shared-types';
import type { Pool } from '../db';
import { ApiError, unauthorized } from '../errors';
import { isActiveGrant, permissionsFor, type GrantRow } from './permissions';
import type { AdminSessions } from './sessions';

export interface AdminDeps {
  pool: Pool;
  sessions: AdminSessions;
  now: () => number;
}

export interface AdminContext extends AdminProfile {
  token: string;
}

export function bearerToken(request: FastifyRequest): string | null {
  return /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? null;
}

export async function loadAdmin(pool: Pool, adminId: string, now: number): Promise<AdminProfile | null> {
  const found = await pool.query<{ id: string; email: string; name: string; status: string }>(
    'SELECT id, email, name, status FROM admin_users WHERE id = $1',
    [adminId],
  );
  const admin = found.rows[0];
  if (!admin || admin.status !== 'active') return null;
  const grants = await pool.query<GrantRow>(
    'SELECT role, granted_by, approved_by, expires_at FROM admin_role_grants WHERE admin_id = $1',
    [adminId],
  );
  const roles: AdminRole[] = grants.rows.filter((g) => isActiveGrant(g, now)).map((g) => g.role);
  roles.sort();
  return { id: admin.id, email: admin.email, name: admin.name, roles, permissions: permissionsFor(roles) };
}

export async function requireAdmin(
  request: FastifyRequest,
  deps: { pool: Pool; sessions: AdminSessions; now: () => number },
  permission?: AdminPermission,
): Promise<AdminContext> {
  const token = bearerToken(request);
  const adminId = token ? await deps.sessions.adminFor(token) : null;
  const admin = adminId ? await loadAdmin(deps.pool, adminId, deps.now()) : null;
  if (!token || !admin) throw unauthorized('Sign in to the admin console again.');
  if (permission && !admin.permissions.includes(permission)) {
    throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', `Your roles don't include ${permission}.`);
  }
  return { ...admin, token };
}
