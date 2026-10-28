/**
 * Me and profiles (doc 09 §2.2, PRD F2, TRD FR-AUTH-6, doc 10 §3.3).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { levelForXp, NEW_PLAYER_RATING, tierForRating } from '@whosabi/game-rules';
import {
  AgeBandRequest,
  ConsentsRequest,
  ErrorCode,
  UpdateMeRequest,
  type Me,
  type ProfileCard,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { isStaffPlayer } from '../admin/staffPlayer';
import { requireAuth } from '../auth/context';
import { withTransaction, type Pool, type PoolClient } from '../db';
import { ApiError, conflict, notFound, parse, unauthorized } from '../errors';
import { requestEventContext } from '../events';
import { isBlocked } from '../social/graph';
import { checkUsername } from './usernames';

interface MeRow {
  id: string;
  username: string | null;
  status: Me['status'];
  avatar_id: string | null;
  home_state: string | null;
  language: Me['language'];
  data_saver: boolean;
  family_mode: boolean;
  discoverable: boolean;
  age_band: Me['age_band'];
  xp: string | number;
  created_at: Date;
  rating: number | null;
}

const ME_SQL = `
  SELECT u.id, u.username, u.status, u.avatar_id, u.home_state, u.language, u.data_saver, u.family_mode,
         u.discoverable, u.age_band, u.xp, u.created_at, r.rating
    FROM users u LEFT JOIN ratings r ON r.user_id = u.id AND r.scope = 'overall'
   WHERE u.id = $1`;

/** Settings a player may change, mapped to their columns. */
const SETTABLE = [
  'username',
  'avatar_id',
  'home_state',
  'language',
  'data_saver',
  'family_mode',
  'discoverable',
] as const;

export function profileRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, clock } = deps;

  const me = async (userId: string): Promise<Me> =>
    toMe(await loadMe(pool, userId), await isStaffPlayer(pool, userId, clock.now()));

  app.get('/v1/me', async (request): Promise<Me> => me(requireAuth(request).userId));

  app.patch('/v1/me', async (request): Promise<Me> => {
    const auth = requireAuth(request);
    const body = parse(UpdateMeRequest, request.body);
    await withTransaction(pool, async (client) => {
      const me = await loadMe(client, auth.userId, true);
      const isAccount = me.status === 'active' || me.status === 'restricted';
      const restricted = me.status === 'restricted';
      const changes: Partial<Record<(typeof SETTABLE)[number], unknown>> = {};

      if (body.username !== undefined && body.username !== me.username) {
        if (!isAccount) {
          throw new ApiError(
            403,
            ErrorCode.accountRequired,
            'Sign up to pick a username',
            'Guests play without one.',
          );
        }
        // Chosen once; support handles changes and moderators can force a rename (doc 16).
        if (me.username && me.username.toLowerCase() !== body.username.toLowerCase()) {
          throw conflict(
            ErrorCode.usernameLocked,
            'Your username is already set',
            'Ask support to change it.',
          );
        }
        const check = checkUsername(body.username);
        if (!check.ok) {
          throw new ApiError(
            400,
            ErrorCode.usernameNotAllowed,
            check.reason === 'reserved' ? 'That name is reserved' : 'Please pick a different name',
          );
        }
        changes.username = body.username;
      }
      if (restricted && body.family_mode === false) {
        throw new ApiError(403, ErrorCode.forbidden, 'Family mode stays on for players under 18');
      }
      if (restricted && body.discoverable === true) {
        throw new ApiError(403, ErrorCode.forbidden, "Players under 18 can't be found through contacts");
      }
      for (const key of [
        'avatar_id',
        'home_state',
        'language',
        'data_saver',
        'family_mode',
        'discoverable',
      ] as const) {
        if (body[key] !== undefined) changes[key] = body[key];
      }

      const columns = SETTABLE.filter((c) => c in changes);
      if (columns.length === 0) return;
      try {
        await client.query(
          `UPDATE users SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = $${columns.length + 2}
            WHERE id = $1`,
          [auth.userId, ...columns.map((c) => changes[c]), new Date(clock.now())],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw conflict(ErrorCode.usernameTaken, 'That username is taken', 'Try another one.');
        }
        throw err;
      }
    });
    return me(auth.userId);
  });

  /** The age gate (UX §2.1): once per account; changes go through support. */
  app.post('/v1/me/age', async (request): Promise<Me> => {
    const auth = requireAuth(request);
    const { age_band: band } = parse(AgeBandRequest, request.body);
    if (band === 'under_13') {
      throw new ApiError(403, ErrorCode.ageNotAllowed, 'Who Sabi? is for ages 13 and up');
    }
    await withTransaction(pool, async (client) => {
      const me = await loadMe(client, auth.userId, true);
      if (me.age_band) {
        throw conflict(ErrorCode.ageAlreadySet, 'Your age is already set', 'Contact support to change it.');
      }
      // 13–17: a restricted account (doc 10 §3.3): family-safe content, not found through contacts.
      await client.query(
        band === '13_17'
          ? `UPDATE users SET age_band = '13_17', family_mode = true, discoverable = false,
                    status = CASE WHEN status = 'active' THEN 'restricted'::user_status ELSE status END,
                    updated_at = $2 WHERE id = $1`
          : `UPDATE users SET age_band = '18_plus', updated_at = $2 WHERE id = $1`,
        [auth.userId, new Date(clock.now())],
      );
    });
    return me(auth.userId);
  });

  /** Consent choices (doc 10 §2): a new record for every change, so the history stays. */
  app.post('/v1/me/consents', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(ConsentsRequest, request.body);
    await pool.query(
      `INSERT INTO consent_records (user_id, purpose, granted, policy_version, source)
       SELECT $1, c.purpose, c.granted, c.policy_version, $2
         FROM jsonb_to_recordset($3::jsonb) AS c(purpose text, granted boolean, policy_version text)`,
      [auth.userId, body.source, JSON.stringify(body.consents)],
    );
    for (const consent of body.consents) {
      await deps.events.emit(
        'consent_changed',
        { purpose: consent.purpose, granted: consent.granted },
        requestEventContext(request),
      );
    }
    return reply.code(204).send();
  });

  /** The public profile card behind whosabi.ng/u/{username} (doc 09 §5). */
  app.get('/v1/users/:username', async (request): Promise<ProfileCard> => {
    const { username } = parse(z.object({ username: z.string().min(1).max(40) }), request.params);
    const found = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE username = $1 AND status IN ('active', 'restricted')",
      [username],
    );
    const id = found.rows[0]?.id;
    if (!id || (request.auth && (await isBlocked(pool, request.auth.userId, id)))) {
      throw notFound('Player not found.');
    }
    return (await profileCards(pool, [id]))[0]!;
  });
}

async function loadMe(db: Pool | PoolClient, userId: string, lock = false): Promise<MeRow> {
  const row = (await db.query<MeRow>(lock ? `${ME_SQL} FOR UPDATE OF u` : ME_SQL, [userId])).rows[0];
  if (!row || row.status === 'banned' || row.status === 'deleted') throw unauthorized('Account unavailable.');
  return row;
}

function toMe(row: MeRow, staff: boolean): Me {
  const xp = Number(row.xp);
  const progress = levelForXp(xp);
  const rating = row.rating ?? NEW_PLAYER_RATING.rating;
  const tier = tierForRating(rating);
  return {
    id: row.id,
    username: row.username,
    status: row.status,
    avatar_id: row.avatar_id,
    home_state: (row.home_state as Me['home_state']) ?? null,
    language: row.language,
    data_saver: row.data_saver,
    family_mode: row.family_mode,
    discoverable: row.discoverable,
    age_band: row.age_band,
    level: progress.level,
    xp,
    xp_into_level: progress.xpIntoLevel,
    xp_for_next_level: progress.xpForNextLevel,
    rating: Math.round(rating),
    tier: { id: tier.id, name: tier.name, badge: tier.badge },
    created_at: row.created_at.toISOString(),
    staff,
  };
}

/** Cards for players, in the order asked; players who are gone are left out. */
export async function profileCards(db: Pool | PoolClient, ids: readonly string[]): Promise<ProfileCard[]> {
  if (ids.length === 0) return [];
  const result = await db.query<{
    id: string;
    username: string | null;
    avatar_id: string | null;
    xp: string;
    rating: number | null;
  }>(
    `SELECT u.id, u.username, u.avatar_id, u.xp, r.rating
       FROM users u LEFT JOIN ratings r ON r.user_id = u.id AND r.scope = 'overall'
      WHERE u.id = ANY($1) AND u.status IN ('guest', 'active', 'restricted')`,
    [ids],
  );
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const tier = tierForRating(r.rating ?? NEW_PLAYER_RATING.rating);
    return [
      {
        id: r.id,
        username: r.username,
        avatar_id: r.avatar_id,
        level: levelForXp(Number(r.xp)).level,
        tier: { id: tier.id, name: tier.name, badge: tier.badge },
      },
    ];
  });
}
