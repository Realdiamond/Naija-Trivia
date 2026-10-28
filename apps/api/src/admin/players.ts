/**
 * The admin API, part two: players (doc 18 §7). Search, User 360, the activity timeline and
 * revealing a phone number. Identifiers are masked unless revealed with a reason, and every
 * look at a player is in the audit log, which the player's "Admin history" tab shows.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pseudonymousId } from '@whosabi/analytics/server';
import { levelForXp, NEW_PLAYER_RATING, tierForRating } from '@whosabi/game-rules';
import {
  AdminAuditQuery,
  AdminRevealRequest,
  AdminTimelineQuery,
  AdminUserSearchQuery,
  ErrorCode,
  normalizeNigerianPhone,
  type AdminAuditResponse,
  type AdminRevealResponse,
  type AdminTimelineResponse,
  type AdminUserHit,
  type AdminUserSearchResponse,
  type AdminUserSummary,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { ACTIVE_STATES } from '../duels/repo';
import { ApiError, notFound, parse } from '../errors';
import { auditPage, writeAudit } from './audit';
import { requireAdmin, type AdminDeps } from './context';
import { maskSearch, maskSignIn } from './mask';

const UserParams = z.object({ id: z.string().min(3).max(40) });
const SEARCH_LIMIT = 20;
const MATCH_ORDER: AdminUserHit['matched'][] = [
  'user_id',
  'duel_id',
  'phone',
  'email',
  'device_id',
  'username',
];

interface UserRow {
  id: string;
  username: string | null;
  status: AdminUserSummary['status'];
  avatar_id: string | null;
  age_band: AdminUserSummary['age_band'];
  home_state: string | null;
  language: string;
  family_mode: boolean;
  discoverable: boolean;
  xp: string;
  signup_platform: AdminUserSummary['signup_platform'];
  last_platform: AdminUserSummary['last_platform'];
  acquisition_source: string | null;
  last_seen_at: Date | null;
  created_at: Date;
  rating: number | null;
}

export function adminPlayerRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, config } = deps;

  async function userRow(id: string): Promise<UserRow> {
    const found = await pool.query<UserRow>(
      `SELECT u.id, u.username, u.status, u.avatar_id, u.age_band, u.home_state, u.language, u.family_mode,
              u.discoverable, u.xp, u.signup_platform, u.last_platform, u.acquisition_source, u.last_seen_at,
              u.created_at, r.rating
         FROM users u LEFT JOIN ratings r ON r.user_id = u.id AND r.scope = 'overall'
        WHERE u.id = $1`,
      [id],
    );
    if (!found.rows[0]) throw notFound('No such player.');
    return found.rows[0];
  }

  async function mergedGuests(id: string): Promise<string[]> {
    const found = await pool.query<{ guest_id: string }>(
      'SELECT guest_id FROM user_merges WHERE into_user_id = $1 ORDER BY merged_at',
      [id],
    );
    return found.rows.map((r) => r.guest_id);
  }

  app.get('/admin/users', async (request): Promise<AdminUserSearchResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.search');
    const { q } = parse(AdminUserSearchQuery, request.query);
    const matches = new Map<string, AdminUserHit['matched']>();
    const add = (ids: string[], matched: AdminUserHit['matched']) => {
      for (const id of ids) if (!matches.has(id)) matches.set(id, matched);
    };

    if (/^u_[0-9A-Za-z]{26}$/.test(q)) add([q], 'user_id');
    if (/^d_[0-9A-Za-z]{26}$/.test(q)) {
      const duel = await pool.query<{ player_a: string; player_b: string | null }>(
        'SELECT player_a, player_b FROM duels WHERE id = $1',
        [q],
      );
      const row = duel.rows[0];
      if (row) add([row.player_a, ...(row.player_b ? [row.player_b] : [])], 'duel_id');
    }
    const phone = /^[+\d\s()-]{7,}$/.test(q) ? normalizeNigerianPhone(q) : null;
    if (phone) {
      // Exact match only, and only for roles that may (doc 18 §7.1).
      if (!admin.permissions.includes('players.search_phone')) {
        throw new ApiError(
          403,
          ErrorCode.forbidden,
          'Not allowed',
          "Your roles can't search by phone number.",
        );
      }
      add(await identityOwners('phone', phone), 'phone');
    }
    // An email address someone signs in with: exact match, like a phone number.
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q) ? q.toLowerCase() : null;
    if (email) {
      if (!admin.permissions.includes('players.search_phone')) {
        throw new ApiError(403, ErrorCode.forbidden, 'Not allowed', "Your roles can't search by email.");
      }
      add(await identityOwners('email', email), 'email');
    }
    if (/^[A-Za-z0-9_-]{22,128}$/.test(q)) add(await identityOwners('guest_device', q), 'device_id');
    if (/^[A-Za-z0-9_]{2,20}$/.test(q)) {
      const byName = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE username::text ILIKE $1 ORDER BY username LIMIT ${SEARCH_LIMIT}`,
        [`${q.replace(/_/g, '\\_')}%`],
      );
      add(
        byName.rows.map((r) => r.id),
        'username',
      );
    }

    const ids = [...matches.keys()].slice(0, SEARCH_LIMIT);
    const rows = await pool.query<{
      id: string;
      username: string | null;
      status: AdminUserHit['status'];
      xp: string;
      last_seen_at: Date | null;
      created_at: Date;
    }>('SELECT id, username, status, xp, last_seen_at, created_at FROM users WHERE id = ANY($1)', [ids]);
    const users: AdminUserHit[] = rows.rows
      .map((r) => ({
        id: r.id,
        username: r.username,
        status: r.status,
        level: levelForXp(Number(r.xp)).level,
        last_seen_at: r.last_seen_at?.toISOString() ?? null,
        created_at: r.created_at.toISOString(),
        matched: matches.get(r.id)!,
      }))
      .sort(
        (a, b) =>
          MATCH_ORDER.indexOf(a.matched) - MATCH_ORDER.indexOf(b.matched) ||
          (a.username ?? '').localeCompare(b.username ?? ''),
      );

    await writeAudit(pool, {
      actor: admin.id,
      action: 'search_users',
      entity: 'user_search',
      after: { q: maskSearch(q, phone, email), results: users.length },
      ip: request.ip,
    });
    return { users };
  });

  async function identityOwners(
    provider: 'phone' | 'email' | 'guest_device',
    subject: string,
  ): Promise<string[]> {
    const found = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2',
      [provider, subject],
    );
    return found.rows.map((r) => r.user_id);
  }

  app.get('/admin/users/:id', async (request): Promise<AdminUserSummary> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const { id } = parse(UserParams, request.params);
    const user = await userRow(id);
    const [identities, guests, friends, duels, consents] = await Promise.all([
      pool.query<{ provider: string; subject: string; created_at: Date }>(
        'SELECT provider, subject, created_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at',
        [id],
      ),
      mergedGuests(id),
      pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM friendships WHERE status = 'accepted' AND (user_a = $1 OR user_b = $1)",
        [id],
      ),
      pool.query<{ active: string; won: string; lost: string; drawn: string }>(
        `SELECT count(*) FILTER (WHERE state = ANY($2::duel_state[])) AS active,
                count(*) FILTER (WHERE winner_id = $1) AS won,
                count(*) FILTER (WHERE state IN ('complete', 'forfeit') AND winner_id IS NOT NULL AND winner_id <> $1) AS lost,
                count(*) FILTER (WHERE state = 'complete' AND winner_id IS NULL) AS drawn
           FROM duels WHERE player_a = $1 OR player_b = $1`,
        [id, ACTIVE_STATES],
      ),
      pool.query<{
        purpose: string;
        granted: boolean;
        policy_version: string;
        source: string;
        created_at: Date;
      }>(
        `SELECT DISTINCT ON (purpose) purpose, granted, policy_version, source, created_at
           FROM consent_records WHERE user_id = $1 ORDER BY purpose, id DESC`,
        [id],
      ),
    ]);
    const rating = user.rating ?? NEW_PLAYER_RATING.rating;
    const tier = tierForRating(rating);
    const counts = duels.rows[0]!;

    await writeAudit(pool, {
      actor: admin.id,
      action: 'view_user',
      entity: 'user',
      entityId: id,
      ip: request.ip,
    });
    return {
      id: user.id,
      username: user.username,
      status: user.status,
      avatar_id: user.avatar_id,
      age_band: user.age_band,
      home_state: user.home_state,
      language: user.language,
      family_mode: user.family_mode,
      discoverable: user.discoverable,
      level: levelForXp(Number(user.xp)).level,
      xp: Number(user.xp),
      rating: Math.round(rating),
      tier: { id: tier.id, name: tier.name, badge: tier.badge },
      signup_platform: user.signup_platform,
      last_platform: user.last_platform,
      acquisition_source: user.acquisition_source,
      last_seen_at: user.last_seen_at?.toISOString() ?? null,
      created_at: user.created_at.toISOString(),
      sign_in_methods: identities.rows.map((r) => ({
        provider: r.provider as AdminUserSummary['sign_in_methods'][number]['provider'],
        masked: maskSignIn(r.provider, r.subject),
        created_at: r.created_at.toISOString(),
      })),
      merged_guests: guests,
      friends: Number(friends.rows[0]?.n ?? 0),
      duels: {
        active: Number(counts.active),
        won: Number(counts.won),
        lost: Number(counts.lost),
        drawn: Number(counts.drawn),
      },
      consents: consents.rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
    };
  });

  /** Every event, newest first, including from guest accounts merged into this one (AD-3). */
  app.get('/admin/users/:id/timeline', async (request): Promise<AdminTimelineResponse> => {
    const admin = await requireAdmin(request, ctx, 'players.view');
    const { id } = parse(UserParams, request.params);
    const query = parse(AdminTimelineQuery, request.query);
    await userRow(id);
    const pids = [id, ...(await mergedGuests(id))].map((u) => pseudonymousId(u, config.analyticsKey));
    const rows = await pool.query<{
      event_id: string;
      event: string;
      source: 'client' | 'server';
      ts: Date;
      session_id: string;
      platform: string;
      app_version: string;
      screen: string;
      props: Record<string, unknown>;
    }>(
      `SELECT event_id, event, source, ts, session_id, platform, app_version, screen, props
         FROM analytics_events
        WHERE user_pid = ANY($1) AND ($2::timestamptz IS NULL OR ts < $2)
        ORDER BY ts DESC, seq DESC
        LIMIT $3`,
      [pids, query.before ?? null, query.limit],
    );
    await writeAudit(pool, {
      actor: admin.id,
      action: 'view_timeline',
      entity: 'user',
      entityId: id,
      ip: request.ip,
    });
    const events = rows.rows.map((r) => ({ ...r, ts: r.ts.toISOString() }));
    return {
      events,
      next_before: events.length === query.limit ? (events.at(-1)?.ts ?? null) : null,
    };
  });

  app.post('/admin/users/:id/reveal', async (request): Promise<AdminRevealResponse> => {
    const admin = await requireAdmin(request, ctx, 'pii.reveal');
    const { id } = parse(UserParams, request.params);
    const body = parse(AdminRevealRequest, request.body);
    await userRow(id);
    const phone = await pool.query<{ subject: string }>(
      "SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = 'phone' ORDER BY created_at LIMIT 1",
      [id],
    );
    // Logged before anything is shown: no audit entry, no reveal (doc 18 AD-5).
    await writeAudit(pool, {
      actor: admin.id,
      action: 'reveal_pii',
      entity: 'user',
      entityId: id,
      reason: body.reason,
      after: { field: body.field },
      ip: request.ip,
    });
    return { field: 'phone', value: phone.rows[0]?.subject ?? null };
  });

  app.get('/admin/users/:id/audit', async (request): Promise<AdminAuditResponse> => {
    const admin = await requireAdmin(request, ctx, 'audit.view');
    const { id } = parse(UserParams, request.params);
    const query = parse(AdminAuditQuery, request.query);
    const page = await auditPage(pool, { ...query, entity: 'user', entity_id: id, actor: undefined });
    await writeAudit(pool, {
      actor: admin.id,
      action: 'view_audit',
      entity: 'user',
      entityId: id,
      ip: request.ip,
    });
    return page;
  });
}
