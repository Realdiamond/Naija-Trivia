/**
 * User 360's other tabs (doc 18 §7.2, build plan step 2.7b): sessions and time, matches, money,
 * devices and notes, plus what support can do for a player (doc 18 §8): grant coins within the
 * daily limit, restore a streak that broke, and sign them out everywhere. Each look at a tab and
 * each action is in the audit log; every action needs a reason.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pseudonymousId } from '@whosabi/analytics/server';
import { restoreStreak, STREAK_RESTORE_EVERY_DAYS, watDate, type LostRun } from '@whosabi/game-rules';
import {
  ADMIN_GRANT_DAILY_LIMIT,
  AdminNoteRequest,
  AdminPlayerAction,
  ErrorCode,
  SUPPORT_ACTIONS,
  SUPPORT_GRANT_DAILY_LIMIT,
  type AdminDevicesResponse,
  type AdminMatchesResponse,
  type AdminMoneyResponse,
  type AdminNotesResponse,
  type AdminPlayerActionResponse,
  type AdminSessionsResponse,
  type Platform,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { loadStreak, saveStreak } from '../daily/repo';
import { withTransaction, type Pool } from '../db';
import { grantCoins, userAccount, type CoinChange } from '../economy/ledger';
import { ApiError, conflict, notFound, parse } from '../errors';
import { writeAudit } from './audit';
import { watMidnight } from './console';
import { requireAdmin, requirePermission, type AdminContext, type AdminDeps } from './context';
import { moderate } from './moderation';

const UserParams = z.object({ id: z.string().min(3).max(40) });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 90;
const SESSIONS_SHOWN = 50;

interface Player {
  id: string;
  status: string;
  platform: Platform;
  /** The player and any guest accounts merged into them: one person (doc 18 AD-3). */
  ids: string[];
}

async function player(pool: Pool, id: string): Promise<Player> {
  const found = await pool.query<{
    id: string;
    status: string;
    last_platform: Platform | null;
    signup_platform: Platform | null;
    guests: string[];
  }>(
    `SELECT u.id, u.status, u.last_platform, u.signup_platform,
            coalesce(array_agg(m.guest_id ORDER BY m.merged_at) FILTER (WHERE m.guest_id IS NOT NULL), '{}') AS guests
       FROM users u LEFT JOIN user_merges m ON m.into_user_id = u.id
      WHERE u.id = $1 GROUP BY u.id`,
    [id],
  );
  const row = found.rows[0];
  if (!row) throw notFound('No such player.');
  return {
    id: row.id,
    status: row.status,
    platform: row.last_platform ?? row.signup_platform ?? 'android',
    ids: [row.id, ...row.guests],
  };
}

/** Minutes in front each WAT day, split at midnight so a late session counts on both days (AD-2). */
export function minutesByDay(
  backgrounded: ReadonlyArray<{ at: number; ms: number }>,
  now: number,
  days = HISTORY_DAYS,
): Array<{ day: string; minutes: number }> {
  const first = watMidnight(now) - (days - 1) * DAY;
  const totals = new Array<number>(days).fill(0);
  for (const { at, ms } of backgrounded) {
    let start = at - ms;
    while (start < at) {
      const day = Math.floor((start - first) / DAY);
      const dayEnd = first + (day + 1) * DAY;
      const end = Math.min(at, dayEnd);
      if (day >= 0 && day < days) totals[day]! += end - start;
      start = end;
    }
  }
  return totals.map((ms, i) => ({
    day: watDate(first + i * DAY),
    minutes: Math.round((ms / MINUTE) * 10) / 10,
  }));
}

const minutes = (ms: number) => Math.round((ms / MINUTE) * 10) / 10;

function priceShown(micros: string | null, currency: string | null): string | null {
  if (micros === null || !currency) return null;
  const amount = Number(micros) / 1e6;
  return currency === 'NGN' ? `₦${amount.toLocaleString('en-NG')}` : `${currency} ${amount}`;
}

const limitReached = (detail: string) => new ApiError(403, ErrorCode.forbidden, 'Over the limit', detail);

export function adminPlayer360Routes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, config, clock, events } = deps;

  const viewed = (admin: AdminContext, id: string, tab: string, ip: string) =>
    writeAudit(pool, {
      actor: admin.id,
      action: 'view_user_tab',
      entity: 'user',
      entityId: id,
      after: { tab },
      ip,
    });

  app.get('/admin/users/:id/sessions', async (request): Promise<AdminSessionsResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const who = await player(pool, parse(UserParams, request.params).id);
    const now = clock.now();
    const since = new Date(watMidnight(now) - (HISTORY_DAYS - 1) * DAY);
    const pids = who.ids.map((u) => pseudonymousId(u, config.analyticsKey));
    const [sessions, backgrounded, areas, hours] = await Promise.all([
      pool.query<{
        session_id: string;
        started_at: Date;
        ended_at: Date;
        foreground_ms: string | null;
        platform: string;
        app_version: string;
        network: string;
        events: string;
      }>(
        `SELECT session_id, min(ts) AS started_at, max(ts) AS ended_at,
                sum((props->>'foreground_ms')::bigint) FILTER (WHERE event = 'app_backgrounded') AS foreground_ms,
                (array_agg(platform ORDER BY ts DESC))[1] AS platform,
                coalesce((array_agg(app_version ORDER BY ts DESC) FILTER (WHERE app_version <> ''))[1], '') AS app_version,
                coalesce((array_agg(network_type ORDER BY ts DESC) FILTER (WHERE network_type <> ''))[1], '') AS network,
                count(*) AS events
           FROM analytics_events
          WHERE user_pid = ANY($1) AND source = 'client' AND session_id <> ''
          GROUP BY session_id ORDER BY min(ts) DESC LIMIT ${SESSIONS_SHOWN}`,
        [pids],
      ),
      pool.query<{ ts: Date; platform: string; session_id: string; ms: string }>(
        `SELECT ts, platform, session_id, (props->>'foreground_ms')::bigint AS ms
           FROM analytics_events
          WHERE user_pid = ANY($1) AND event = 'app_backgrounded' AND ts >= $2`,
        [pids, since],
      ),
      pool.query<{ area: string; ms: string }>(
        `SELECT split_part(screen, '.', 1) AS area, sum(ms)::bigint AS ms FROM (
           SELECT props->>'prev_screen' AS screen, (props->>'prev_screen_ms')::bigint AS ms
             FROM analytics_events
            WHERE user_pid = ANY($1) AND event = 'screen_viewed' AND ts >= $2 AND props->>'prev_screen' <> ''
           UNION ALL
           SELECT props->>'screen', (props->>'screen_ms')::bigint
             FROM analytics_events
            WHERE user_pid = ANY($1) AND event = 'app_backgrounded' AND ts >= $2 AND props ? 'screen_ms'
         ) s GROUP BY 1 ORDER BY 2 DESC`,
        [pids, since],
      ),
      pool.query<{ hour: number; n: string }>(
        `SELECT extract(hour FROM (ts AT TIME ZONE 'UTC') + interval '1 hour')::int AS hour, count(*) AS n
           FROM analytics_events WHERE user_pid = ANY($1) AND ts >= $2 GROUP BY 1`,
        [pids, since],
      ),
    ]);
    await viewed(admin, who.id, 'sessions', request.ip);

    const byPlatform = new Map<string, number>();
    const inSessions = new Set<string>();
    let total = 0;
    for (const row of backgrounded.rows) {
      const ms = Number(row.ms);
      total += ms;
      byPlatform.set(row.platform, (byPlatform.get(row.platform) ?? 0) + ms);
      inSessions.add(row.session_id);
    }
    const byHour = new Array<number>(24).fill(0);
    for (const row of hours.rows) byHour[row.hour] = Number(row.n);
    return {
      sessions: sessions.rows.map((r) => ({
        id: r.session_id,
        started_at: r.started_at.toISOString(),
        ended_at: r.ended_at.toISOString(),
        foreground_minutes: r.foreground_ms === null ? null : minutes(Number(r.foreground_ms)),
        platform: r.platform,
        app_version: r.app_version,
        network: r.network,
        events: Number(r.events),
      })),
      minutes_by_day: minutesByDay(
        backgrounded.rows.map((r) => ({ at: r.ts.getTime(), ms: Number(r.ms) })),
        now,
      ),
      minutes_by_platform: [...byPlatform]
        .map(([platform, ms]) => ({ platform, minutes: minutes(ms) }))
        .sort((a, b) => b.minutes - a.minutes),
      minutes_by_area: areas.rows.map((r) => ({ area: r.area, minutes: minutes(Number(r.ms)) })),
      average_session_minutes: inSessions.size ? minutes(total / inSessions.size) : 0,
      by_hour: byHour,
    };
  });

  app.get('/admin/users/:id/matches', async (request): Promise<AdminMatchesResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const who = await player(pool, parse(UserParams, request.params).id);
    const [duels, dailies, party] = await Promise.all([
      pool.query<{
        id: string;
        source: string;
        state: string;
        winner_id: string | null;
        you: number;
        them: number;
        coins: number | null;
        opponent: string | null;
        created_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT d.id, d.source, d.state, d.winner_id, d.created_at, d.completed_at, o.username::text AS opponent,
                CASE WHEN d.player_a = ANY($1) THEN d.score_a ELSE d.score_b END AS you,
                CASE WHEN d.player_a = ANY($1) THEN d.score_b ELSE d.score_a END AS them,
                CASE WHEN d.player_a = ANY($1) THEN d.coins_a ELSE d.coins_b END AS coins
           FROM duels d
           LEFT JOIN users o ON o.id = CASE WHEN d.player_a = ANY($1) THEN d.player_b ELSE d.player_a END
          WHERE d.player_a = ANY($1) OR d.player_b = ANY($1)
          ORDER BY d.created_at DESC LIMIT 50`,
        [who.ids],
      ),
      pool.query<{
        id: number;
        date: string;
        score: number;
        correct: number;
        grid: string;
        streak: number;
        coins: number;
      }>(
        `SELECT r.daily_id AS id, to_char(c.play_date, 'YYYY-MM-DD') AS date, r.score, r.correct_count AS correct,
                r.grid, r.streak, r.coins
           FROM daily_results r JOIN daily_challenges c ON c.id = r.daily_id
          WHERE r.user_id = ANY($1) ORDER BY r.daily_id DESC LIMIT 60`,
        [who.ids],
      ),
      pool.query<{
        id: string;
        room_code: string;
        rank: number;
        score: number;
        players: number;
        ended_at: Date | null;
      }>(
        `SELECT g.id, g.room_code, r.rank, r.score, g.player_count AS players, g.ended_at
           FROM party_results r JOIN party_games g ON g.id = r.game_id
          WHERE r.user_id = ANY($1) ORDER BY g.started_at DESC LIMIT 50`,
        [who.ids],
      ),
    ]);
    await viewed(admin, who.id, 'matches', request.ip);
    return {
      duels: duels.rows.map((d) => ({
        id: d.id,
        opponent: d.opponent,
        source: d.source,
        state: d.state,
        result:
          d.state !== 'complete' && d.state !== 'forfeit'
            ? null
            : d.winner_id === null
              ? 'draw'
              : who.ids.includes(d.winner_id)
                ? 'win'
                : 'loss',
        score: { you: d.you, opponent: d.them },
        coins: d.coins,
        created_at: d.created_at.toISOString(),
        completed_at: d.completed_at?.toISOString() ?? null,
      })),
      dailies: dailies.rows,
      party_games: party.rows.map((g) => ({ ...g, ended_at: g.ended_at?.toISOString() ?? null })),
    };
  });

  app.get('/admin/users/:id/money', async (request): Promise<AdminMoneyResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const who = await player(pool, parse(UserParams, request.params).id);
    const accounts = [userAccount(who.id, 'coins'), userAccount(who.id, 'gems')];
    const [wallet, ledger, purchases, ads] = await Promise.all([
      pool.query<{ currency: 'coins' | 'gems'; balance: string }>(
        'SELECT currency, balance FROM ledger_accounts WHERE id = ANY($1)',
        [accounts],
      ),
      pool.query<{
        id: string;
        amount: string;
        currency: string;
        reason: string;
        ref_type: string | null;
        ref_id: string | null;
        created_at: Date;
      }>(
        `SELECT e.id::text AS id, e.amount, a.currency, t.reason, t.ref_type, t.ref_id, t.created_at
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id
           JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE e.account_id = ANY($1) ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
        [accounts],
      ),
      pool.query<{
        id: string;
        store: string;
        product_id: string;
        coins: number | null;
        price_micros: string | null;
        currency: string | null;
        status: string;
        environment: string;
        created_at: Date;
        refunded_at: Date | null;
      }>(
        `SELECT id, store, product_id, coins, price_micros, currency, status, environment, created_at, refunded_at
           FROM purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [who.id],
      ),
      pool.query<{ source: string; ad_unit: string; amount: number; received_at: Date }>(
        `SELECT source, ad_unit, reward_amount AS amount, received_at
           FROM ad_rewards WHERE user_id = $1 ORDER BY received_at DESC LIMIT 50`,
        [who.id],
      ),
    ]);
    await viewed(admin, who.id, 'money', request.ip);
    const balance = (currency: 'coins' | 'gems') =>
      Number(wallet.rows.find((r) => r.currency === currency)?.balance ?? 0);
    return {
      coins: balance('coins'),
      gems: balance('gems'),
      ledger: ledger.rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        created_at: r.created_at.toISOString(),
      })),
      purchases: purchases.rows.map((p) => ({
        id: p.id,
        store: p.store,
        product_id: p.product_id,
        coins: p.coins,
        price: priceShown(p.price_micros, p.currency),
        status: p.status,
        environment: p.environment,
        created_at: p.created_at.toISOString(),
        refunded_at: p.refunded_at?.toISOString() ?? null,
      })),
      ad_rewards: ads.rows.map((a) => ({ ...a, received_at: a.received_at.toISOString() })),
    };
  });

  app.get('/admin/users/:id/devices', async (request): Promise<AdminDevicesResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const who = await player(pool, parse(UserParams, request.params).id);
    const devices = await pool.query<{
      platform: string;
      model: string | null;
      browser: string | null;
      app_version: string | null;
      push: boolean;
      last_seen_at: Date;
    }>(
      `SELECT platform, model, browser, app_version, push_token IS NOT NULL AS push, last_seen_at
         FROM devices WHERE user_id = ANY($1) ORDER BY last_seen_at DESC LIMIT 20`,
      [who.ids],
    );
    await viewed(admin, who.id, 'devices', request.ip);
    return { devices: devices.rows.map((d) => ({ ...d, last_seen_at: d.last_seen_at.toISOString() })) };
  });

  async function notes(id: string): Promise<AdminNotesResponse> {
    const rows = await pool.query<{ id: string; author: string; body: string; created_at: Date }>(
      `SELECT n.id, a.name AS author, n.body, n.created_at
         FROM user_notes n JOIN admin_users a ON a.id = n.author_id
        WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 100`,
      [id],
    );
    return {
      notes: rows.rows.map((n) => ({ ...n, id: Number(n.id), created_at: n.created_at.toISOString() })),
    };
  }

  app.get('/admin/users/:id/notes', async (request): Promise<AdminNotesResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const who = await player(pool, parse(UserParams, request.params).id);
    await viewed(admin, who.id, 'notes', request.ip);
    return notes(who.id);
  });

  /** Anyone who can see a player can leave a note for the next person (never shown to the player). */
  app.post('/admin/users/:id/notes', async (request): Promise<AdminNotesResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const who = await player(pool, parse(UserParams, request.params).id);
    const body = parse(AdminNoteRequest, request.body);
    const inserted = await pool.query<{ id: string }>(
      'INSERT INTO user_notes (user_id, author_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [who.id, admin.id, body.body, new Date(clock.now())],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'add_note',
      entity: 'user',
      entityId: who.id,
      after: { note: Number(inserted.rows[0]!.id) },
      ip: request.ip,
    });
    return notes(who.id);
  });

  app.post('/admin/users/:id/actions', async (request): Promise<AdminPlayerActionResponse> => {
    const admin = await requireAdmin(request, ctx);
    const action = parse(AdminPlayerAction, request.body);
    const support = (SUPPORT_ACTIONS as readonly string[]).includes(action.type);
    requirePermission(admin, support ? 'players.support' : 'players.moderate');
    const who = await player(pool, parse(UserParams, request.params).id);
    if (action.type !== 'grant_coins' && action.type !== 'restore_streak' && action.type !== 'sign_out') {
      return moderate(deps, admin, who.id, action, request.ip);
    }
    const now = clock.now();
    const audit = {
      actor: admin.id,
      entity: 'user',
      entityId: who.id,
      reason: action.reason,
      ip: request.ip,
    };

    if (action.type === 'grant_coins') {
      if (who.status === 'deleted')
        throw conflict(ErrorCode.conflict, 'Not possible', 'This account is deleted.');
      const senior = admin.roles.includes('owner') || admin.roles.includes('admin');
      const limit = senior ? ADMIN_GRANT_DAILY_LIMIT : SUPPORT_GRANT_DAILY_LIMIT;
      const change = await withTransaction(pool, async (client) => {
        // One grant at a time per player, so two at once can't both fit under the limit.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [who.id]);
        const today = await client.query<{ n: string }>(
          `SELECT coalesce(sum(e.amount), 0) AS n
             FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
            WHERE e.account_id = $1 AND t.reason = 'admin_grant' AND t.created_at >= $2`,
          [userAccount(who.id), new Date(watMidnight(now))],
        );
        const given = Number(today.rows[0]!.n);
        if (given + action.amount > limit) {
          const left = Math.max(0, limit - given);
          throw limitReached(
            senior
              ? `Up to ${limit.toLocaleString('en-NG')} coins a day per player (${left} left today). More needs a second approver, which comes later.`
              : `Support can grant up to ${limit} coins a day per player (${left} left today). Ask an admin for more.`,
          );
        }
        const granted = await grantCoins(client, who.id, action.amount, {
          key: `admin_grant:${randomUUID()}`,
          reason: 'admin_grant',
          now,
        });
        await writeAudit(client, {
          ...audit,
          action: 'grant_coins',
          before: { coins: granted!.balance - action.amount },
          after: { coins: granted!.balance, amount: action.amount },
        });
        return granted as CoinChange;
      });
      await events.emit(
        'coins_changed',
        { delta: change.delta, reason: change.reason, balance_after: change.balance },
        { userId: who.id, platform: who.platform },
      );
      return {
        done: `Granted ${action.amount} coins. They now have ${change.balance.toLocaleString('en-NG')}.`,
      };
    }

    if (action.type === 'restore_streak') {
      // The audit log keeps the database's own time, so the 30 days are counted on it too.
      const last = await pool.query<{ created_at: Date }>(
        `SELECT created_at FROM admin_audit_log
          WHERE entity = 'user' AND entity_id = $1 AND action = 'restore_streak'
            AND created_at > now() - make_interval(days => $2)
          ORDER BY created_at DESC LIMIT 1`,
        [who.id, STREAK_RESTORE_EVERY_DAYS],
      );
      if (last.rows[0]) {
        throw limitReached(
          `This player's streak was restored on ${watDate(last.rows[0].created_at)}; once every ${STREAK_RESTORE_EVERY_DAYS} days.`,
        );
      }
      const restored = await withTransaction(pool, async (client) => {
        const state = await loadStreak(client, who.id, true);
        let lost: LostRun | null = null;
        if (state.current > 0) {
          // The current run is its last `current` Dailies (1, 2, … current); the one before ended the lost run.
          const runs = await client.query<{ streak: number; play_date: string }>(
            `SELECT r.streak, to_char(c.play_date, 'YYYY-MM-DD') AS play_date
               FROM daily_results r JOIN daily_challenges c ON c.id = r.daily_id
              WHERE r.user_id = $1 ORDER BY r.daily_id DESC OFFSET $2 LIMIT 2`,
            [who.id, state.current - 1],
          );
          const [start, before] = runs.rows;
          if (start?.streak === 1 && before) lost = { streak: before.streak, lastPlayDate: before.play_date };
        }
        const next = restoreStreak(state, watDate(now), lost);
        if (!next) return null;
        await saveStreak(client, who.id, next);
        await writeAudit(client, {
          ...audit,
          action: 'restore_streak',
          before: { current: state.current, last_play_date: state.lastPlayDate },
          after: { current: next.current, last_play_date: next.lastPlayDate },
        });
        return next;
      });
      if (!restored) {
        throw conflict(ErrorCode.conflict, 'Nothing to restore', 'No streak broke in the last 14 days.');
      }
      return { done: `Streak restored to ${restored.current}.` };
    }

    const signedOut = await pool.query(
      'UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [who.id, new Date(now)],
    );
    await writeAudit(pool, {
      ...audit,
      action: 'sign_out_everywhere',
      after: { sessions: signedOut.rowCount },
    });
    return {
      done: `Signed out of ${signedOut.rowCount ?? 0} session(s); open apps notice within 15 minutes.`,
    };
  });
}
