/**
 * Account deletion and the player's copy of their data (build plan step 2.8a, NDPA 2023, doc 08
 * §4, Google Play's account deletion rule). Erasure happens at once: the profile is cleared, the
 * sign-in methods, devices, sessions, friendships, staff notes and analytics events (merged guests'
 * included) are deleted, and duels, party games and Dailies stay with "Deleted player". Consent
 * records, the ledger, purchases, moderation and the audit log stay for their legal reasons.
 */
import { pseudonymousId } from '@whosabi/analytics/server';
import type { Pool } from '../db';
import { withTransaction } from '../db';
import { newId } from '../ids';

const DAY = 86_400_000;
export const DSAR_DAYS = 30;

export interface Erasure {
  dsarId: string;
  /** False when the account was already deleted. */
  erased: boolean;
}

/** Erases a player now; `by` is 'player' or the staff member's id. Closes any open erasure request. */
export async function eraseAccount(
  pool: Pool,
  analyticsKey: string,
  userId: string,
  now: number,
  by: { handledBy: string; source: 'app' | 'console'; note?: string },
): Promise<Erasure> {
  const at = new Date(now);
  return withTransaction(pool, async (client) => {
    const user = (
      await client.query<{ status: string }>('SELECT status FROM users WHERE id = $1 FOR UPDATE', [userId])
    ).rows[0];
    if (!user) throw new Error(`no user ${userId}`);
    const open = await client.query<{ id: string }>(
      `UPDATE dsar_requests SET status = 'completed', completed_at = $2, handled_by = $3
        WHERE user_id = $1 AND kind = 'erasure' AND status IN ('received', 'in_progress') RETURNING id`,
      [userId, at, by.handledBy],
    );
    let dsarId = open.rows[0]?.id;
    if (!dsarId) {
      dsarId = newId('ds', now);
      await client.query(
        `INSERT INTO dsar_requests (id, user_id, kind, status, due_at, completed_at, created_at, source, handled_by, note)
         VALUES ($1, $2, 'erasure', 'completed', $3, $4, $4, $5, $6, $7)`,
        [dsarId, userId, new Date(now + DSAR_DAYS * DAY), at, by.source, by.handledBy, by.note ?? null],
      );
    }
    if (user.status === 'deleted') return { dsarId, erased: false };

    const guests = await client.query<{ guest_id: string }>(
      'SELECT guest_id FROM user_merges WHERE into_user_id = $1',
      [userId],
    );
    const ids = [userId, ...guests.rows.map((g) => g.guest_id)];
    await client.query(
      `UPDATE users SET status = 'deleted', username = NULL, display_name = NULL, avatar_id = NULL, home_state = NULL,
              discoverable = false, banned_until = NULL, deleted_at = $2, updated_at = $2
        WHERE id = $1`,
      [userId, at],
    );
    await client.query('DELETE FROM auth_identities WHERE user_id = ANY($1)', [ids]);
    await client.query('DELETE FROM devices WHERE user_id = ANY($1)', [ids]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await client.query('DELETE FROM user_notes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM friendships WHERE user_a = $1 OR user_b = $1', [userId]);
    await client.query('DELETE FROM analytics_events WHERE user_pid = ANY($1)', [
      ids.map((id) => pseudonymousId(id, analyticsKey)),
    ]);
    return { dsarId, erased: true };
  });
}

/**
 * Everything we hold about a player that they can take away (the NDPA's right of access), as one
 * JSON document. Staff notes and the reasons behind moderation are internal and stay out.
 */
export async function exportAccount(
  pool: Pool,
  userId: string,
  now: number,
): Promise<Record<string, unknown>> {
  const q = async <T>(sql: string, params: unknown[] = [userId]) =>
    (await pool.query(sql, params)).rows as T[];
  const [profile] = await q<Record<string, unknown>>(
    `SELECT id, username, status, age_band, home_state, language, family_mode, discoverable, data_saver,
            level, xp, signup_platform, created_at
       FROM users WHERE id = $1`,
  );
  const [signIns, consents, duels, dailies, party, ledger, purchases, devices, notices] = await Promise.all([
    q(`SELECT provider, subject, created_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at`),
    q(
      `SELECT purpose, granted, policy_version, source, created_at FROM consent_records WHERE user_id = $1 ORDER BY id`,
    ),
    q(
      `SELECT d.id, d.source, d.state, d.created_at, d.completed_at,
              CASE WHEN d.player_a = $1 THEN d.score_a ELSE d.score_b END AS your_score,
              CASE WHEN d.player_a = $1 THEN d.score_b ELSE d.score_a END AS their_score,
              CASE WHEN d.winner_id IS NULL THEN NULL WHEN d.winner_id = $1 THEN 'won' ELSE 'lost' END AS result
         FROM duels d WHERE d.player_a = $1 OR d.player_b = $1 ORDER BY d.created_at`,
    ),
    q(
      `SELECT c.play_date, r.score, r.correct_count, r.grid, r.streak, r.completed_at
         FROM daily_results r JOIN daily_challenges c ON c.id = r.daily_id WHERE r.user_id = $1 ORDER BY c.play_date`,
    ),
    q(
      `SELECT g.room_code, g.ended_at, r.rank, r.score, r.correct_count
         FROM party_results r JOIN party_games g ON g.id = r.game_id WHERE r.user_id = $1 ORDER BY g.started_at`,
    ),
    q(
      `SELECT t.created_at, e.amount, a.currency, t.reason
         FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
         JOIN ledger_transactions t ON t.id = e.transaction_id
        WHERE a.owner_user_id = $1 ORDER BY e.id`,
    ),
    q(
      `SELECT store, product_id, coins, status, created_at FROM purchases WHERE user_id = $1 ORDER BY created_at`,
    ),
    q(`SELECT platform, model, browser, app_version, last_seen_at FROM devices WHERE user_id = $1`),
    q(
      `SELECT action, message, ends_at, created_at FROM moderation_actions
        WHERE target_user_id = $1 AND action IN ('warn', 'rename', 'ban', 'unban') ORDER BY id`,
    ),
  ]);
  return {
    exported_at: new Date(now).toISOString(),
    profile,
    sign_in_methods: signIns,
    consents,
    duels,
    dailies,
    party_games: party,
    coins_and_gems: ledger,
    purchases,
    devices,
    notices_from_the_team: notices,
  };
}
