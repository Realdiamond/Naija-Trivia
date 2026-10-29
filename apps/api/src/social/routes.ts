/**
 * Friends, blocks and contact discovery (doc 09 §2.3, TRD FR-SOC-1 and FR-SOC-2, doc 10).
 * All of it needs an account: guests play through links. Changes to a pair run under a
 * per-pair lock, so two players asking each other at once simply become friends.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { watDate } from '@whosabi/game-rules';
import {
  BlockRequest,
  DiscoveryRequest,
  ErrorCode,
  FriendRequest,
  type DiscoveryResponse,
  type FriendRequestResult,
  type FriendSource,
  type FriendsResponse,
  type Platform,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import type { AccessClaims } from '../auth/tokens';
import { withTransaction, type PoolClient } from '../db';
import { ApiError, notFound, parse } from '../errors';
import { requestEventContext } from '../events';
import { guardianConsentRequired, profileCards } from '../profile/routes';
import { queuePush } from '../push/queue';
import { pairOf } from './graph';

/** Prefixes one player may look up per day, so the index can't be walked to list numbers. */
const DISCOVERY_PREFIXES_PER_DAY = 3000;
/** A friend request push is still worth sending for three days. */
const FRIEND_PUSH_MS = 3 * 24 * 3_600_000;
const UserParams = z.object({ userId: z.string().min(3).max(40) });

export function socialRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, redis, clock, events } = deps;

  async function requireAccount(request: FastifyRequest): Promise<AccessClaims> {
    const auth = requireAuth(request);
    if (auth.guest) {
      throw new ApiError(
        403,
        ErrorCode.accountRequired,
        'Sign up to add friends',
        'Guests can still play by link.',
      );
    }
    // A 13–17 account plays like a guest until a parent or guardian agrees (step 2.8d).
    const waiting = await pool.query(
      "SELECT 1 FROM users WHERE id = $1 AND status = 'restricted' AND guardian_consent_at IS NULL",
      [auth.userId],
    );
    if (waiting.rowCount) throw guardianConsentRequired();
    return auth;
  }

  /** Serialise every change to one pair of players. */
  async function lockPair(client: PoolClient, a: string, b: string): Promise<void> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('pair:' || LEAST($1::text, $2::text) || GREATEST($1::text, $2::text)))",
      [a, b],
    );
  }

  /** `friend_added` for both players (doc 13). */
  async function friendAdded(request: FastifyRequest, them: string, source: FriendSource) {
    const platform = (
      await pool.query<{ last_platform: Platform | null }>('SELECT last_platform FROM users WHERE id = $1', [
        them,
      ])
    ).rows[0]?.last_platform;
    await events.emit('friend_added', { source }, requestEventContext(request));
    await events.emit('friend_added', { source }, { userId: them, platform: platform ?? 'android' });
  }

  app.get('/v1/friends', async (request): Promise<FriendsResponse> => {
    const me = (await requireAccount(request)).userId;
    const pairs = await pool.query<{
      other: string;
      status: 'pending' | 'accepted' | 'blocked';
      requested_by: string;
      since: Date;
    }>(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other, status, requested_by,
              COALESCE(updated_at, created_at) AS since
         FROM friendships WHERE user_a = $1 OR user_b = $1
        ORDER BY COALESCE(updated_at, created_at) DESC`,
      [me],
    );
    const known = new Set(pairs.rows.map((p) => p.other));
    // Recent opponents with an account, not already connected (FR-SOC-1).
    const opponents = await pool.query<{ other: string }>(
      `SELECT other FROM (
         SELECT CASE WHEN player_a = $1 THEN player_b ELSE player_a END AS other, max(created_at) AS last
           FROM duels WHERE (player_a = $1 OR player_b = $1) AND player_b IS NOT NULL
          GROUP BY 1) recent
         JOIN users u ON u.id = recent.other AND u.status IN ('active', 'restricted')
        ORDER BY last DESC LIMIT 30`,
      [me],
    );
    const suggestedIds = opponents.rows
      .map((r) => r.other)
      .filter((id) => !known.has(id))
      .slice(0, 10);

    const cards = new Map(
      (await profileCards(pool, [...pairs.rows.map((p) => p.other), ...suggestedIds])).map((c) => [c.id, c]),
    );
    const entries = (keep: (p: (typeof pairs.rows)[number]) => boolean) =>
      pairs.rows
        .filter((p) => keep(p) && cards.has(p.other))
        .map((p) => ({ user: cards.get(p.other)!, since: p.since.toISOString() }));
    return {
      friends: entries((p) => p.status === 'accepted'),
      incoming: entries((p) => p.status === 'pending' && p.requested_by !== me),
      outgoing: entries((p) => p.status === 'pending' && p.requested_by === me),
      suggested: suggestedIds.flatMap((id) => (cards.has(id) ? [cards.get(id)!] : [])),
    };
  });

  app.post('/v1/friends/requests', async (request, reply) => {
    const me = (await requireAccount(request)).userId;
    const body = parse(FriendRequest, request.body);
    const target = (
      await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE ${'username' in body ? 'username' : 'id'} = $1
            AND status IN ('active', 'restricted')`,
        ['username' in body ? body.username : body.user_id],
      )
    ).rows[0];
    if (!target || target.id === me) throw notFound('Player not found.');
    const source: FriendSource = body.source ?? ('username' in body ? 'username' : 'opponent');

    const outcome = await withTransaction(pool, async (client) => {
      await lockPair(client, me, target.id);
      const pair = await pairOf(client, me, target.id);
      if (pair?.status === 'blocked') {
        throw new ApiError(403, ErrorCode.userUnavailable, "You can't add this player");
      }
      if (pair?.status === 'accepted')
        return { status: 'accepted' as const, created: false, accepted: false };
      if (pair?.status === 'pending' && pair.requested_by === me) {
        return { status: 'pending' as const, created: false, accepted: false };
      }
      if (pair?.status === 'pending') {
        // They had already asked: asking back means yes.
        await accept(client, me, target.id);
        await friendPush(client, target.id, me, 'accepted');
        return { status: 'accepted' as const, created: false, accepted: true };
      }
      await client.query(
        `INSERT INTO friendships (user_a, user_b, status, requested_by, source, created_at)
         VALUES (LEAST($1::text, $2::text), GREATEST($1::text, $2::text), 'pending', $1, $3, $4)`,
        [me, target.id, source, new Date(clock.now())],
      );
      await friendPush(client, target.id, me, 'request');
      return { status: 'pending' as const, created: true, accepted: false };
    });
    if (outcome.accepted) await friendAdded(request, target.id, source);
    const result: FriendRequestResult = {
      status: outcome.status,
      user: (await profileCards(pool, [target.id]))[0]!,
    };
    return reply.code(outcome.created ? 201 : 200).send(result);
  });

  /** Tells `to` that `from` asked to be friends, or said yes (FR-NOT-1, friend_joined). */
  async function friendPush(client: PoolClient, to: string, from: string, kind: 'request' | 'accepted') {
    const name = (
      await client.query<{ username: string | null }>('SELECT username FROM users WHERE id = $1', [from])
    ).rows[0]?.username;
    const now = clock.now();
    await queuePush(client, {
      userId: to,
      params: { type: 'friend_joined', kind, user_id: from, name: name ?? null },
      collapseKey: `friend:${from}`,
      expiresAt: now + FRIEND_PUSH_MS,
      now,
    });
  }

  async function accept(client: PoolClient, me: string, them: string): Promise<void> {
    await client.query(
      `UPDATE friendships SET status = 'accepted', updated_at = $3
        WHERE user_a = LEAST($1::text, $2::text) AND user_b = GREATEST($1::text, $2::text)`,
      [me, them, new Date(clock.now())],
    );
  }

  app.post('/v1/friends/requests/:userId/accept', async (request): Promise<FriendRequestResult> => {
    const me = (await requireAccount(request)).userId;
    const { userId: them } = parse(UserParams, request.params);
    const outcome = await withTransaction(pool, async (client) => {
      await lockPair(client, me, them);
      const pair = await pairOf(client, me, them);
      if (pair?.status === 'accepted') return { accepted: false, source: pair.source };
      if (pair?.status !== 'pending' || pair.requested_by !== them)
        throw notFound('No request from this player.');
      await accept(client, me, them);
      await friendPush(client, them, me, 'accepted');
      return { accepted: true, source: pair.source };
    });
    if (outcome.accepted)
      await friendAdded(request, them, (outcome.source as FriendSource | null) ?? 'username');
    return { status: 'accepted', user: (await profileCards(pool, [them]))[0]! };
  });

  app.post('/v1/friends/requests/:userId/decline', async (request, reply) => {
    const me = (await requireAccount(request)).userId;
    const { userId: them } = parse(UserParams, request.params);
    const deleted = await pool.query(
      `DELETE FROM friendships
        WHERE user_a = LEAST($1::text, $2::text) AND user_b = GREATEST($1::text, $2::text)
          AND status = 'pending' AND requested_by = $2`,
      [me, them],
    );
    if (!deleted.rowCount) throw notFound('No request from this player.');
    return reply.code(204).send();
  });

  /** Unfriend, or cancel a request you sent. A block is left alone (that is DELETE /blocks). */
  app.delete('/v1/friends/:userId', async (request, reply) => {
    const me = (await requireAccount(request)).userId;
    const { userId: them } = parse(UserParams, request.params);
    await pool.query(
      `DELETE FROM friendships
        WHERE user_a = LEAST($1::text, $2::text) AND user_b = GREATEST($1::text, $2::text)
          AND status IN ('pending', 'accepted')`,
      [me, them],
    );
    return reply.code(204).send();
  });

  /**
   * Block (doc 10 §1): ends any friendship or request, and stops friend requests and duel
   * challenges both ways. Neither side is told who blocked whom.
   */
  app.post('/v1/blocks', async (request, reply) => {
    const me = (await requireAccount(request)).userId;
    const { user_id: them } = parse(BlockRequest, request.body);
    if (them === me)
      throw new ApiError(400, ErrorCode.validation, 'The request is not valid', "You can't block yourself.");
    const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [them]);
    if (!exists.rowCount) throw notFound('Player not found.');
    await withTransaction(pool, async (client) => {
      await lockPair(client, me, them);
      const pair = await pairOf(client, me, them);
      if (pair?.status === 'blocked') return; // already blocked, by either side
      await client.query(
        `INSERT INTO friendships (user_a, user_b, status, requested_by, created_at, updated_at)
         VALUES (LEAST($1::text, $2::text), GREATEST($1::text, $2::text), 'blocked', $1, $3, $3)
         ON CONFLICT (user_a, user_b)
           DO UPDATE SET status = 'blocked', requested_by = $1, source = NULL, updated_at = $3`,
        [me, them, new Date(clock.now())],
      );
    });
    return reply.code(204).send();
  });

  app.delete('/v1/blocks/:userId', async (request, reply) => {
    const me = (await requireAccount(request)).userId;
    const { userId: them } = parse(UserParams, request.params);
    await pool.query(
      `DELETE FROM friendships
        WHERE user_a = LEAST($1::text, $2::text) AND user_b = GREATEST($1::text, $2::text)
          AND status = 'blocked' AND requested_by = $1`,
      [me, them],
    );
    return reply.code(204).send();
  });

  /** Contact discovery by hash prefix (FR-SOC-2). The app only: the web has no contacts. */
  app.post('/v1/discovery/prefixes', async (request): Promise<DiscoveryResponse> => {
    const auth = await requireAccount(request);
    if (auth.platform === 'web') {
      throw new ApiError(403, ErrorCode.forbidden, 'Finding friends from contacts is in the app');
    }
    const { prefixes } = parse(DiscoveryRequest, request.body);
    const unique = [...new Set(prefixes)];
    const key = `disc:${auth.userId}:${watDate(clock.now())}`;
    const used = await redis.incrby(key, unique.length);
    await redis.expire(key, 26 * 3600);
    if (used > DISCOVERY_PREFIXES_PER_DAY) {
      await redis.decrby(key, unique.length);
      throw new ApiError(
        429,
        ErrorCode.rateLimited,
        'That is a lot of contacts for one day',
        'Try again tomorrow.',
      );
    }
    // Each 20-bit prefix covers 16 values of the indexed 3-byte prefix.
    const lows = unique.map((p) => Buffer.from(`${p}0`, 'hex'));
    const highs = unique.map((p) => Buffer.from(`${p}f`, 'hex'));
    const found = await pool.query<DiscoveryResponse['matches'][number]>(
      `SELECT DISTINCT encode(ai.phone_hash, 'hex') AS hash, u.id AS user_id, u.username, u.avatar_id
         FROM unnest($1::bytea[], $2::bytea[]) AS r(lo, hi)
         JOIN auth_identities ai
           ON ai.provider = 'phone' AND ai.phone_hash IS NOT NULL
          AND substring(ai.phone_hash from 1 for 3) BETWEEN r.lo AND r.hi
         JOIN users u ON u.id = ai.user_id
        WHERE u.status = 'active' AND u.discoverable AND u.id <> $3
          AND NOT EXISTS (
            SELECT 1 FROM friendships f
             WHERE f.user_a = LEAST(u.id, $3::text) AND f.user_b = GREATEST(u.id, $3::text) AND f.status = 'blocked')
        LIMIT 2000`,
      [lows, highs, auth.userId],
    );
    return { matches: found.rows };
  });
}
