/**
 * Staff tools on a phone (build plan step 2.9a, the owner's decisions of 28 Oct 2026). A staff
 * member signs in to the app with Google using the email on the staff list; the app then shows
 * them the Staff tab, which opens a 30-day session for that phone (the app asks for the
 * fingerprint or phone PIN each time the tab opens). Owners and admins only, for now. Sessions
 * are listed in the console and can be signed out there; only the token's hash is kept.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AdminProfile, AdminRole } from '@whosabi/shared-types';
import type { Pool } from '../db';
import { ulid } from '../ids';

export const PHONE_ROLES: readonly AdminRole[] = ['owner', 'admin'];
export const PHONE_SESSION_DAYS = 30;
const DAY = 24 * 3_600_000;
/** `last_used_at` is written at most this often. */
const TOUCH_MS = 5 * 60_000;

export const canUsePhone = (admin: Pick<AdminProfile, 'roles'>) =>
  PHONE_ROLES.some((role) => admin.roles.includes(role));

/** Phone tokens look different from the console's, so the two are never mixed up. */
export const isPhoneToken = (token: string) => /^aph_[A-Za-z0-9_-]{43}$/.test(token);

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createPhoneSession(
  pool: Pool,
  adminId: string,
  label: string,
  now: number,
): Promise<{ id: string; token: string; expiresAt: number }> {
  const token = `aph_${randomBytes(32).toString('base64url')}`;
  const id = `aph_${ulid(now)}`;
  const expiresAt = now + PHONE_SESSION_DAYS * DAY;
  await pool.query(
    `INSERT INTO admin_phone_sessions (id, admin_id, token_hash, label, created_at, expires_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $5)`,
    [id, adminId, hash(token), label, new Date(now), new Date(expiresAt)],
  );
  return { id, token, expiresAt };
}

/** The phone session's id and admin, or null for an unknown, ended or signed-out phone. */
export async function phoneSessionFor(
  pool: Pool,
  token: string,
  now: number,
): Promise<{ id: string; adminId: string } | null> {
  if (!isPhoneToken(token)) return null;
  const found = await pool.query<{ id: string; admin_id: string; last_used_at: Date }>(
    `SELECT id, admin_id, last_used_at FROM admin_phone_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [hash(token), new Date(now)],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (now - row.last_used_at.getTime() > TOUCH_MS) {
    await pool.query('UPDATE admin_phone_sessions SET last_used_at = $2 WHERE id = $1', [
      row.id,
      new Date(now),
    ]);
  }
  return { id: row.id, adminId: row.admin_id };
}

export async function revokePhoneSession(pool: Pool, id: string, by: string, now: number): Promise<boolean> {
  const result = await pool.query(
    'UPDATE admin_phone_sessions SET revoked_at = $3, revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL',
    [id, by, new Date(now)],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * A player signed in with Google: if that email is on the staff list, remember which player
 * account is theirs, so the app shows them the Staff tab. Nothing is kept for anyone else.
 */
export async function linkStaffPlayer(pool: Pool, email: string, playerId: string): Promise<void> {
  await pool.query(`UPDATE admin_users SET player_id = NULL WHERE player_id = $2 AND email <> $1`, [
    email,
    playerId,
  ]);
  await pool.query(`UPDATE admin_users SET player_id = $2 WHERE email = $1 AND status = 'active'`, [
    email,
    playerId,
  ]);
}
