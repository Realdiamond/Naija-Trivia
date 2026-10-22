/**
 * Accounts behind sign-in methods (TRD FR-AUTH-3, FR-AUTH-4, FR-AUTH-8).
 *
 * When a phone number, Google or Apple identity signs in, and the request carries the current
 * session (`merge_guest`):
 *   - new identity + a guest session      → the guest becomes the account (same id: nothing moves)
 *   - new identity + an account session   → the identity is linked to that account
 *   - new identity + no session           → a new account
 *   - known identity + a guest session    → the guest's progress moves into that account
 *   - known identity otherwise            → a plain sign-in
 */
import { levelForXp } from '@whosabi/game-rules';
import { ErrorCode, type Platform } from '@whosabi/shared-types';
import type { PoolClient } from '../db';
import { ApiError } from '../errors';
import { newId } from '../ids';
import type { AccessClaims } from './tokens';

export type IdentityProvider = 'phone' | 'google' | 'apple';

export interface AccountRow {
  id: string;
  username: string | null;
  status: 'guest' | 'active' | 'restricted' | 'banned' | 'deleted';
  level: number;
  xp: string | number;
}

export interface SignInInput {
  provider: IdentityProvider;
  subject: string;
  /** SHA-256 of the E.164 number, for contact discovery (TRD FR-SOC-2). */
  phoneHash?: Buffer;
  platform: Platform;
  /** The session the request came with, if any and if the client asked to keep it. */
  current: AccessClaims | null;
  now: number;
}

export interface SignInResult {
  user: AccountRow;
  isNew: boolean;
  mergedGuest: boolean;
  /** The guest's device, so the new session stays tied to it (one live session per device). */
  deviceId: string | null;
}

const ACCOUNT_COLUMNS = 'id, username, status, level, xp';

export async function signInWithIdentity(client: PoolClient, input: SignInInput): Promise<SignInResult> {
  const { provider, subject, now } = input;
  // Two first sign-ins with the same number at once must not create two accounts.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`identity:${provider}:${subject}`]);
  const found = await client.query<{ user_id: string }>(
    'SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2',
    [provider, subject],
  );
  const ownerId = found.rows[0]?.user_id ?? null;
  const currentId = input.current?.userId ?? null;

  // Lock both rows in id order, so concurrent sign-ins can't deadlock.
  const ids = [...new Set([ownerId, currentId].filter((id): id is string => id !== null))].sort();
  const locked = await client.query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
    [ids],
  );
  const byId = new Map(locked.rows.map((u) => [u.id, u]));
  const owner = ownerId ? byId.get(ownerId)! : null;
  const current = currentId ? (byId.get(currentId) ?? null) : null;
  const deviceId = current?.status === 'guest' ? await guestDevice(client, current.id) : null;

  let user: AccountRow;
  let isNew = false;
  let mergedGuest = false;
  if (owner) {
    if (owner.status === 'banned' || owner.status === 'deleted') {
      throw new ApiError(
        403,
        ErrorCode.accountUnavailable,
        'This account is not available',
        'Contact support.',
      );
    }
    if (current && current.status === 'guest' && current.id !== owner.id) {
      await mergeGuestInto(client, current, owner, now);
      mergedGuest = true;
    }
    user = owner;
  } else {
    if (current?.status === 'guest') {
      user = await becomeAccount(client, current.id, now);
      isNew = true;
      mergedGuest = true;
    } else if (current && (current.status === 'active' || current.status === 'restricted')) {
      user = current; // a new sign-in method for this account
    } else {
      user = (
        await client.query<AccountRow>(
          `INSERT INTO users (id, status, signup_platform, last_platform, last_seen_at, acquisition_source,
                              created_at, updated_at)
           VALUES ($1, 'active', $2, $2, $3, 'organic', $3, $3)
           RETURNING ${ACCOUNT_COLUMNS}`,
          [newId('u', now), input.platform, new Date(now)],
        )
      ).rows[0]!;
      isNew = true;
    }
    await client.query(
      `INSERT INTO auth_identities (id, user_id, provider, subject, phone_hash, verified_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [newId('ai', now), user.id, provider, subject, input.phoneHash ?? null, new Date(now)],
    );
  }

  const refreshed = await client.query<AccountRow>(
    `UPDATE users SET last_platform = $2, last_seen_at = $3 WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
    [user.id, input.platform, new Date(now)],
  );
  return { user: refreshed.rows[0]!, isNew, mergedGuest, deviceId };
}

/**
 * FR-AUTH-4: a guest signing in to an existing account keeps their progress there. Their
 * duels, answers, ratings, seen questions, consents, devices and XP move to the account; the
 * guest is retired and the link is kept for analytics. A duel between the guest and that
 * same account would become a duel against yourself, so an unfinished one is cancelled and a
 * finished one stays as history.
 *
 * Every table keyed by a user must be handled here; later steps add coins and friends.
 */
export async function mergeGuestInto(
  client: PoolClient,
  guest: AccountRow,
  account: AccountRow,
  now: number,
): Promise<void> {
  const at = new Date(now);
  const g = guest.id;
  const x = account.id;
  const betweenThem = `((player_a = $1 AND player_b = $2) OR (player_a = $2 AND player_b = $1))`;

  await client.query(
    `UPDATE duels SET state = 'cancelled', turn_user_id = NULL, turn_deadline = NULL, completed_at = $3
      WHERE ${betweenThem}
        AND state IN ('created', 'wait_b_r1r2', 'wait_a_r2r3', 'wait_b_r3', 'tiebreak')`,
    [g, x, at],
  );
  const moved = (
    await client.query<{ id: string }>(
      `SELECT id FROM duels WHERE (player_a = $1 OR player_b = $1) AND NOT ${betweenThem}`,
      [g, x],
    )
  ).rows.map((r) => r.id);
  if (moved.length > 0) {
    await client.query(
      `UPDATE duels SET
              player_a = CASE WHEN player_a = $1 THEN $2 ELSE player_a END,
              player_b = CASE WHEN player_b = $1 THEN $2 ELSE player_b END,
              turn_user_id = CASE WHEN turn_user_id = $1 THEN $2 ELSE turn_user_id END,
              winner_id = CASE WHEN winner_id = $1 THEN $2 ELSE winner_id END
        WHERE id = ANY($3)`,
      [g, x, moved],
    );
    await client.query('UPDATE duel_answers SET user_id = $2 WHERE user_id = $1 AND duel_id = ANY($3)', [
      g,
      x,
      moved,
    ]);
    await client.query('UPDATE duel_rounds SET picked_by = $2 WHERE picked_by = $1 AND duel_id = ANY($3)', [
      g,
      x,
      moved,
    ]);
  }

  // The account's own ratings win; the guest's fill any scope the account has not played.
  await client.query(
    `UPDATE ratings SET user_id = $2
      WHERE user_id = $1 AND scope NOT IN (SELECT scope FROM ratings WHERE user_id = $2)`,
    [g, x],
  );
  await client.query('DELETE FROM ratings WHERE user_id = $1', [g]);

  await client.query(
    `INSERT INTO user_question_seen (user_id, question_id, seen_at)
     SELECT $2, question_id, seen_at FROM user_question_seen WHERE user_id = $1
     ON CONFLICT (user_id, question_id)
       DO UPDATE SET seen_at = GREATEST(user_question_seen.seen_at, EXCLUDED.seen_at)`,
    [g, x],
  );
  await client.query('DELETE FROM user_question_seen WHERE user_id = $1', [g]);

  await client.query('UPDATE consent_records SET user_id = $2 WHERE user_id = $1', [g, x]);
  await client.query('UPDATE devices SET user_id = $2 WHERE user_id = $1', [g, x]);
  // The guest's device now belongs to the account: guest sign-in there is refused from now on.
  await client.query(
    "UPDATE auth_identities SET user_id = $2 WHERE user_id = $1 AND provider = 'guest_device'",
    [g, x],
  );
  await client.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [
    g,
    at,
  ]);

  const xp = Number(account.xp) + Number(guest.xp);
  await client.query('UPDATE users SET xp = $2, level = $3, updated_at = $4 WHERE id = $1', [
    x,
    xp,
    levelForXp(xp).level,
    at,
  ]);
  await client.query(
    `UPDATE users SET xp = 0, updated_at = $2, deleted_at = $2, status = 'deleted' WHERE id = $1`,
    [g, at],
  );
  await client.query('INSERT INTO user_merges (guest_id, into_user_id, merged_at) VALUES ($1, $2, $3)', [
    g,
    x,
    at,
  ]);
}

/** A guest becomes an account; one who said they are 13–17 gets a restricted one (doc 10 §3.3). */
async function becomeAccount(client: PoolClient, userId: string, now: number): Promise<AccountRow> {
  return (
    await client.query<AccountRow>(
      `UPDATE users SET status = CASE WHEN age_band = '13_17' THEN 'restricted'::user_status ELSE 'active' END,
              updated_at = $2
        WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [userId, new Date(now)],
    )
  ).rows[0]!;
}

async function guestDevice(client: PoolClient, userId: string): Promise<string | null> {
  const result = await client.query<{ subject: string }>(
    "SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = 'guest_device' ORDER BY created_at LIMIT 1",
    [userId],
  );
  return result.rows[0]?.subject ?? null;
}
