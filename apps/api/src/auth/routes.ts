/**
 * Guest sign-in and sessions (TRD FR-AUTH-1, FR-AUTH-7, doc 09 §2.1).
 * Apps get the refresh token in the body; the web gets it as an HttpOnly cookie that
 * JavaScript can never read.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthResponse,
  ErrorCode,
  GuestAuthRequest,
  PublicUser,
  RefreshRequest,
  type Platform,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { withTransaction, type PoolClient } from '../db';
import { ApiError, conflict, parse, unauthorized } from '../errors';
import { newId } from '../ids';
import { requireAuth } from './context';
import { ACCESS_TTL_SECONDS, hashRefreshToken, newRefreshToken, REFRESH_TTL_SECONDS } from './tokens';

export const REFRESH_COOKIE = 'ws_rt';
const REFRESH_COOKIE_PATH = '/v1/auth';

interface UserRow {
  id: string;
  username: string | null;
  status: PublicUser['status'];
  level: number;
  xp: string | number;
}

const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  status: u.status,
  level: u.level,
  xp: Number(u.xp),
});

export function authRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { pool, tokens, config, clock } = deps;

  async function startSession(
    client: PoolClient,
    user: UserRow,
    platform: Platform,
    deviceId: string | null,
    familyId: string = newId('rt'),
  ): Promise<{ access: string; refresh: string }> {
    const { token, hash } = newRefreshToken();
    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, device_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6))`,
      [newId('rt'), user.id, hash, familyId, deviceId, (clock.now() + REFRESH_TTL_SECONDS * 1000) / 1000],
    );
    const access = await tokens.signAccess({ userId: user.id, platform, guest: user.status === 'guest' });
    return { access, refresh: token };
  }

  function sendSession(
    reply: FastifyReply,
    platform: Platform,
    session: { access: string; refresh: string },
    user: UserRow,
    status = 200,
  ) {
    const body: AuthResponse = {
      access: session.access,
      access_expires_in: ACCESS_TTL_SECONDS,
      user: toPublicUser(user),
    };
    if (platform === 'web') {
      void reply.setCookie(REFRESH_COOKIE, session.refresh, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_TTL_SECONDS,
      });
    } else {
      body.refresh = session.refresh;
    }
    return reply.code(status).send(body);
  }

  app.post(
    '/v1/auth/guest',
    { config: { rateLimit: { max: config.guestSignupsPerIpPerHour, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { device_id: deviceId, platform } = parse(GuestAuthRequest, request.body);
      const { user, session, created } = await withTransaction(pool, async (client) => {
        // Serialise sign-ins for the same device so two quick taps can't create two guests.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [deviceId]);
        const existing = await client.query<UserRow>(
          `SELECT u.id, u.username, u.status, u.level, u.xp
             FROM auth_identities ai JOIN users u ON u.id = ai.user_id
            WHERE ai.provider = 'guest_device' AND ai.subject = $1`,
          [deviceId],
        );
        let row = existing.rows[0];
        if (row && row.status !== 'guest') {
          throw conflict(
            ErrorCode.conflict,
            'This device belongs to an account',
            'Sign in with your phone number or Google instead.',
          );
        }
        const isNew = !row;
        if (!row) {
          const inserted = await client.query<UserRow>(
            `INSERT INTO users (id, status, signup_platform, last_platform, last_seen_at, acquisition_source)
             VALUES ($1, 'guest', $2, $2, now(), 'organic')
             RETURNING id, username, status, level, xp`,
            [newId('u'), platform],
          );
          row = inserted.rows[0]!;
          await client.query(
            `INSERT INTO auth_identities (id, user_id, provider, subject) VALUES ($1, $2, 'guest_device', $3)`,
            [newId('ai'), row.id, deviceId],
          );
        } else {
          await client.query('UPDATE users SET last_platform = $2, last_seen_at = now() WHERE id = $1', [
            row.id,
            platform,
          ]);
          // One live session per device: signing in again replaces the old one.
          await client.query(
            'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL',
            [row.id, deviceId],
          );
        }
        return { user: row, session: await startSession(client, row, platform, deviceId), created: isNew };
      });
      return sendSession(reply, platform, session, user, created ? 201 : 200);
    },
  );

  app.post('/v1/auth/refresh', async (request, reply) => {
    const body = parse(RefreshRequest, request.body ?? {});
    const fromCookie = !body.refresh;
    const presented = body.refresh ?? request.cookies[REFRESH_COOKIE];
    if (!presented) throw unauthorized('No refresh token.');
    if (fromCookie) assertSameSiteRequest(request, config.corsOrigins);

    const result = await withTransaction(pool, async (client) => {
      const found = await client.query<{
        id: string;
        user_id: string;
        family_id: string;
        device_id: string | null;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        'SELECT id, user_id, family_id, device_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [hashRefreshToken(presented)],
      );
      const token = found.rows[0];
      if (!token) throw unauthorized('Unknown refresh token.');
      if (token.revoked_at) {
        // A rotated token came back: someone else may hold it. End the whole family.
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
          [token.family_id],
        );
        return { reused: true as const };
      }
      if (token.expires_at.getTime() <= clock.now()) throw unauthorized('Refresh token expired.');
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [token.id]);
      const user = (
        await client.query<UserRow>('SELECT id, username, status, level, xp FROM users WHERE id = $1', [
          token.user_id,
        ])
      ).rows[0];
      if (!user || user.status === 'banned' || user.status === 'deleted')
        throw unauthorized('Account unavailable.');
      const platform: Platform = fromCookie ? 'web' : platformFromHeader(request);
      const session = await startSession(client, user, platform, token.device_id, token.family_id);
      return { reused: false as const, user, session, platform };
    });

    if (result.reused) {
      void reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      throw new ApiError(
        401,
        ErrorCode.refreshReused,
        'Please sign in again',
        'This session was ended for safety.',
      );
    }
    return sendSession(reply, result.platform, result.session, result.user);
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const body = parse(RefreshRequest, request.body ?? {});
    const presented = body.refresh ?? request.cookies[REFRESH_COOKIE];
    if (presented) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
        [hashRefreshToken(presented)],
      );
    }
    void reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.code(204).send();
  });

  app.get('/v1/me', async (request) => {
    const auth = requireAuth(request);
    const user = (
      await pool.query<UserRow>('SELECT id, username, status, level, xp FROM users WHERE id = $1', [
        auth.userId,
      ])
    ).rows[0];
    if (!user) throw unauthorized('Account unavailable.');
    return toPublicUser(user);
  });
}

/**
 * Cookie-based refresh must come from our own web app: a custom header (which forces a CORS
 * preflight) and an allowed Origin. Together these block cross-site request forgery.
 */
function assertSameSiteRequest(request: FastifyRequest, allowedOrigins: string[]): void {
  const origin = request.headers.origin;
  if (!request.headers['x-requested-with'] || (origin && !allowedOrigins.includes(origin))) {
    throw new ApiError(
      403,
      ErrorCode.forbidden,
      'Request blocked',
      'Cookie refresh must come from the web app.',
    );
  }
}

function platformFromHeader(request: FastifyRequest): Platform {
  const value = request.headers['x-platform'];
  return value === 'ios' ? 'ios' : value === 'web' ? 'web' : 'android';
}
