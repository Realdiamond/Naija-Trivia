/**
 * Bans (build plan step 2.7d, doc 10 §2): a banned player can't sign in or refresh until the ban
 * ends; one with an end lifts itself the next time they try, back to the account they had.
 */
import { ErrorCode } from '@whosabi/shared-types';
import type { PoolClient } from '../db';
import { ApiError } from '../errors';

export const APPEALS_EMAIL = 'help@whosabi.ng';

export interface BanState {
  id: string;
  status: string;
  banned_until: Date | null;
}

/**
 * Lifts a ban, in the caller's transaction: the player goes back to a guest, a 13–17 account or
 * a full account, by what they have. Returns the status now.
 */
export async function unban(
  client: PoolClient,
  userId: string,
  now: number,
  by: { actor: string; reason: string },
): Promise<string> {
  const back = await client.query<{ status: string }>(
    `UPDATE users SET banned_until = NULL, updated_at = $2,
            status = (CASE
              WHEN NOT EXISTS (SELECT 1 FROM auth_identities WHERE user_id = $1 AND provider <> 'guest_device') THEN 'guest'
              WHEN age_band = '13_17' THEN 'restricted'
              ELSE 'active' END)::user_status
      WHERE id = $1 RETURNING status`,
    [userId, new Date(now)],
  );
  await client.query(
    `INSERT INTO moderation_actions (target_user_id, action, reason, actor, created_at)
     VALUES ($1, 'unban', $3, $4, $2)`,
    [userId, new Date(now), by.reason, by.actor],
  );
  return back.rows[0]!.status;
}

/** Ends a ban whose time is up, in the caller's transaction; returns the status now. */
export async function liftEndedBan(client: PoolClient, user: BanState, now: number): Promise<string> {
  if (user.status !== 'banned' || !user.banned_until || user.banned_until.getTime() > now) return user.status;
  return unban(client, user.id, now, { actor: 'system', reason: 'The ban ended' });
}

/** What a banned player is told when they try to sign in. */
export function bannedError(until: Date | null): ApiError {
  const when = until?.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
  return new ApiError(
    403,
    ErrorCode.accountUnavailable,
    'This account is not available',
    `${until ? `This account is suspended until ${when}.` : 'This account is banned.'} To appeal, write to ${APPEALS_EMAIL}.`,
  );
}
