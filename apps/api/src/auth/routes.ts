/**
 * Sign-in and sessions (TRD FR-AUTH-1 to FR-AUTH-8, doc 09 §2.1): guests, phone and email
 * codes, Google and Apple. Apps get the refresh token in the body; the web gets it as an HttpOnly
 * cookie that JavaScript can never read.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AppleAuthRequest,
  AuthResponse,
  EmailCodeSendRequest,
  EmailCodeVerifyRequest,
  ErrorCode,
  GoogleAuthRequest,
  GuestAuthRequest,
  normalizeNigerianPhone,
  OtpSendRequest,
  OtpVerifyRequest,
  PublicUser,
  RefreshRequest,
  type AuthMethodsResponse,
  type OtpSendResponse,
  type Platform,
  type SignInResponse,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { raiseStaffAlert } from '../admin/alerts';
import { linkStaffPlayer } from '../admin/phones';
import { withTransaction, type PoolClient } from '../db';
import { ApiError, conflict, parse, unauthorized } from '../errors';
import { eventContextFor } from '../events';
import { newId } from '../ids';
import { bannedError, liftEndedBan } from '../moderation/bans';
import { signInWithIdentity, type IdentityProvider } from './accounts';
import { sessionFromHeader } from './context';
import { emailChannel, OtpService, phoneChannel, RESEND_AFTER_SECONDS } from './otp';
import type { IdTokenVerifier, VerifiedIdToken } from './providers';
import {
  ACCESS_TTL_SECONDS,
  hashRefreshToken,
  newRefreshToken,
  REFRESH_TTL_SECONDS,
  type AccessClaims,
} from './tokens';

export const REFRESH_COOKIE = 'ws_rt';
const REFRESH_COOKIE_PATH = '/v1/auth';

interface UserRow {
  id: string;
  username: string | null;
  status: PublicUser['status'];
  level: number;
  xp: string | number;
  banned_until?: Date | null;
}

const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  status: u.status,
  level: u.level,
  xp: Number(u.xp),
});

/** For staff alerts about sign-ups. */
const PROVIDER_NAMES: Record<IdentityProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  phone: 'a phone code',
  email: 'an email code',
};
const PLATFORM_NAMES: Record<Platform, string> = { android: 'Android', ios: 'iPhone', web: 'the web' };

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
    signIn?: { is_new: boolean; merged_guest: boolean },
  ) {
    const body: AuthResponse | SignInResponse = {
      access: session.access,
      access_expires_in: ACCESS_TTL_SECONDS,
      user: toPublicUser(user),
      ...signIn,
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

  /** Which sign-in buttons the apps show: phone, email and Google/Apple can each be switched off. */
  app.get('/v1/auth/methods', async (): Promise<AuthMethodsResponse> => ({
    guest: true,
    phone: deps.auth.sms !== null,
    email: deps.auth.email !== null,
    google: deps.auth.google !== null,
    apple: deps.auth.apple !== null,
  }));

  app.post(
    '/v1/auth/guest',
    { config: { rateLimit: { max: config.guestSignupsPerIpPerHour, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { device_id: deviceId, platform } = parse(GuestAuthRequest, request.body);
      const { user, session, created } = await withTransaction(pool, async (client) => {
        // Serialise sign-ins for the same device so two quick taps can't create two guests.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [deviceId]);
        const existing = await client.query<UserRow>(
          `SELECT u.id, u.username, u.status, u.level, u.xp, u.banned_until
             FROM auth_identities ai JOIN users u ON u.id = ai.user_id
            WHERE ai.provider = 'guest_device' AND ai.subject = $1`,
          [deviceId],
        );
        let row = existing.rows[0];
        // A banned guest stays out until the ban ends (step 2.7d).
        if (row?.status === 'banned') {
          const now = await liftEndedBan(
            client,
            { ...row, banned_until: row.banned_until ?? null },
            deps.clock.now(),
          );
          if (now === 'banned') throw bannedError(row.banned_until ?? null);
          row = { ...row, status: now as UserRow['status'] };
        }
        if (row && row.status !== 'guest') {
          throw conflict(
            ErrorCode.conflict,
            'This device belongs to an account',
            'Sign in to your account instead.',
          );
        }
        const isNew = !row;
        if (!row) {
          const inserted = await client.query<UserRow>(
            `INSERT INTO users (id, status, signup_platform, last_platform, last_seen_at, acquisition_source,
                                created_at, updated_at)
             VALUES ($1, 'guest', $2, $2, $3, 'organic', $3, $3)
             RETURNING id, username, status, level, xp`,
            [newId('u'), platform, new Date(deps.clock.now())],
          );
          row = inserted.rows[0]!;
          await client.query(
            `INSERT INTO auth_identities (id, user_id, provider, subject, created_at)
             VALUES ($1, $2, 'guest_device', $3, $4)`,
            [newId('ai'), row.id, deviceId, new Date(deps.clock.now())],
          );
        } else {
          await client.query('UPDATE users SET last_platform = $2, last_seen_at = $3 WHERE id = $1', [
            row.id,
            platform,
            new Date(deps.clock.now()),
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
        await client.query<UserRow>(
          'SELECT id, username, status, level, xp, banned_until FROM users WHERE id = $1',
          [token.user_id],
        )
      ).rows[0];
      if (user?.status === 'banned') {
        user.status = (await liftEndedBan(
          client,
          { ...user, banned_until: user.banned_until ?? null },
          clock.now(),
        )) as UserRow['status'];
      }
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

  const codeOptions = {
    redis: deps.redis,
    captcha: deps.auth.captcha,
    secret: config.otpSecret,
    now: clock.now,
  };
  const otp = deps.auth.sms
    ? new OtpService({
        ...codeOptions,
        channel: phoneChannel(deps.auth.sms, {
          webOtpDomain: new URL(config.publicWebUrl).hostname,
          smsRetrieverAppHash: config.smsRetrieverAppHash,
        }),
      })
    : null;
  const emailOtp = deps.auth.email
    ? new OtpService({ ...codeOptions, channel: emailChannel(deps.auth.email) })
    : null;

  /** Phone sign-in is off until an SMS provider is set up (production without Termii or Africa's Talking). */
  function phoneCodes(): OtpService {
    if (!otp) {
      throw new ApiError(
        503,
        ErrorCode.providerUnavailable,
        'Phone sign-in is not available',
        'Sign in with Google or Apple, or keep playing as a guest.',
      );
    }
    return otp;
  }

  /** Email sign-in is off until Resend is set up (production without RESEND_API_KEY). */
  function emailCodes(): OtpService {
    if (!emailOtp) {
      throw new ApiError(
        503,
        ErrorCode.providerUnavailable,
        'Email sign-in is not available',
        'Sign in with Google, or keep playing as a guest.',
      );
    }
    return emailOtp;
  }

  /**
   * One path for every sign-in method: find or create the account (keeping a guest's
   * progress or linking to the current account, see accounts.ts) and start a session.
   */
  async function signIn(
    request: FastifyRequest,
    reply: FastifyReply,
    identity: { provider: IdentityProvider; subject: string; phoneHash?: Buffer },
    platform: Platform,
    current: AccessClaims | null,
  ) {
    const result = await withTransaction(pool, async (client) => {
      const signedIn = await signInWithIdentity(client, { ...identity, platform, current, now: clock.now() });
      if (signedIn.deviceId) {
        // One live session per device: the guest session on this device ends here.
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL',
          [signedIn.deviceId],
        );
      }
      const session = await startSession(client, signedIn.user, platform, signedIn.deviceId);
      if (signedIn.isNew) {
        await raiseStaffAlert(client, {
          kind: 'signup',
          title: 'New sign-up 🎉',
          body: `Signed up with ${PROVIDER_NAMES[identity.provider]} on ${PLATFORM_NAMES[platform]}${
            signedIn.mergedGuest ? ', keeping what they played as a guest' : ''
          }.`,
          url: `/staff/player/${signedIn.user.id}`,
          now: clock.now(),
        });
      }
      return { ...signedIn, session };
    });
    if (result.isNew) {
      await deps.events.emit(
        'signup_completed',
        { method: identity.provider, merged_guest: result.mergedGuest },
        eventContextFor(request, result.user.id, platform),
      );
    }
    return {
      userId: result.user.id,
      reply: sendSession(reply, platform, result.session, result.user, result.isNew ? 201 : 200, {
        is_new: result.isNew,
        merged_guest: result.mergedGuest,
      }),
    };
  }

  /** Sends a sign-in code by text or email; the events show how codes are doing (doc 13). */
  async function sendCode(
    request: FastifyRequest,
    codes: OtpService,
    to: string,
    platform: Platform,
    captchaToken: string | undefined,
  ): Promise<OtpSendResponse> {
    const current = await sessionFromHeader(request, tokens);
    const sent = await codes.send({
      to,
      platform,
      captchaToken,
      ip: request.ip,
      deviceId: current ? await deviceOf(current.userId) : null,
    });
    if (current) {
      await deps.events.emit(
        'otp_sent',
        { provider: sent.provider },
        eventContextFor(request, current.userId, current.platform),
      );
    }
    return { request_id: sent.requestId, resend_after_s: RESEND_AFTER_SECONDS };
  }

  /** Checks a code, then signs in with the number or address it was sent to. */
  async function verifyCode(
    request: FastifyRequest,
    reply: FastifyReply,
    codes: OtpService,
    body: OtpVerifyRequest,
    identityFor: (to: string) => { provider: IdentityProvider; subject: string; phoneHash?: Buffer },
  ) {
    // Checked before the code is used up, so a guest is never dropped by an expired token.
    const current = await sessionFromHeader(request, tokens);
    const checked = await codes.verify(body.request_id, body.code);
    if (!checked.ok) {
      if (current) {
        await deps.events.emit(
          'otp_failed',
          { provider: checked.provider, reason: checked.error.code.toLowerCase() },
          eventContextFor(request, current.userId, current.platform),
        );
      }
      throw checked.error;
    }
    const { to, platform, provider } = checked.code;
    const signedIn = await signIn(
      request,
      reply,
      identityFor(to),
      platform,
      body.merge_guest ? current : null,
    );
    await deps.events.emit('otp_verified', { provider }, eventContextFor(request, signedIn.userId, platform));
    return signedIn.reply;
  }

  const codeSendLimit = { config: { rateLimit: { max: config.otpSendsPerIpPerHour, timeWindow: '1 hour' } } };

  app.post('/v1/auth/otp/send', codeSendLimit, async (request): Promise<OtpSendResponse> => {
    const codes = phoneCodes();
    const body = parse(OtpSendRequest, request.body);
    const phone = normalizeNigerianPhone(body.phone);
    if (!phone) {
      throw new ApiError(
        400,
        ErrorCode.validation,
        'The request is not valid',
        'phone: enter a Nigerian mobile number, like 0803 123 4567.',
      );
    }
    return sendCode(request, codes, phone, body.platform, body.turnstile_token);
  });

  app.post('/v1/auth/otp/verify', async (request, reply) => {
    const codes = phoneCodes();
    const body = parse(OtpVerifyRequest, request.body);
    return verifyCode(request, reply, codes, body, (phone) => ({
      provider: 'phone',
      subject: phone,
      phoneHash: createHash('sha256').update(phone).digest(),
    }));
  });

  app.post('/v1/auth/email/send', codeSendLimit, async (request): Promise<OtpSendResponse> => {
    const codes = emailCodes();
    const body = parse(EmailCodeSendRequest, request.body);
    return sendCode(request, codes, body.email.toLowerCase(), body.platform, body.turnstile_token);
  });

  app.post('/v1/auth/email/verify', async (request, reply) => {
    const codes = emailCodes();
    const body = parse(EmailCodeVerifyRequest, request.body);
    return verifyCode(request, reply, codes, body, (email) => ({ provider: 'email', subject: email }));
  });

  app.post('/v1/auth/google', async (request, reply) => {
    const body = parse(GoogleAuthRequest, request.body);
    const current = await sessionFromHeader(request, tokens);
    const identity = await checkIdToken(deps.auth.google, 'Google', body.id_token);
    const signedIn = await signIn(
      request,
      reply,
      { provider: 'google', subject: identity.subject },
      body.platform,
      body.merge_guest ? current : null,
    );
    // Staff who play with their staff Google account get the Staff tab in the app (step 2.9a).
    const domainOk =
      !deps.config.adminGoogleDomain || identity.hostedDomain === deps.config.adminGoogleDomain;
    if (identity.email && identity.emailVerified && domainOk) {
      await linkStaffPlayer(deps.pool, identity.email.toLowerCase(), signedIn.userId);
    }
    return signedIn.reply;
  });

  app.post('/v1/auth/apple', async (request, reply) => {
    const body = parse(AppleAuthRequest, request.body);
    const current = await sessionFromHeader(request, tokens);
    const identity = await checkIdToken(deps.auth.apple, 'Apple', body.identity_token);
    // Apple signs the SHA-256 of the nonce the app generated; the app sends us the original.
    if (identity.nonce !== createHash('sha256').update(body.nonce).digest('hex')) {
      throw new ApiError(401, ErrorCode.idTokenInvalid, 'Sign-in could not be confirmed', 'nonce mismatch');
    }
    return (
      await signIn(
        request,
        reply,
        { provider: 'apple', subject: identity.subject },
        body.platform,
        body.merge_guest ? current : null,
      )
    ).reply;
  });

  /** "Sign out everywhere" (FR-AUTH-8): every session on every platform. */
  app.post('/v1/auth/logout-all', async (request, reply) => {
    const current = await sessionFromHeader(request, tokens);
    if (!current) throw unauthorized();
    await pool.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [
      current.userId,
      new Date(clock.now()),
    ]);
    void reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return reply.code(204).send();
  });

  async function deviceOf(userId: string): Promise<string | null> {
    const result = await pool.query<{ subject: string }>(
      "SELECT subject FROM auth_identities WHERE user_id = $1 AND provider = 'guest_device' ORDER BY created_at LIMIT 1",
      [userId],
    );
    return result.rows[0]?.subject ?? null;
  }
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

async function checkIdToken(
  verifier: IdTokenVerifier | null,
  name: string,
  token: string,
): Promise<VerifiedIdToken> {
  if (!verifier) {
    throw new ApiError(
      503,
      ErrorCode.providerUnavailable,
      `${name} sign-in is not available`,
      'Use another way to sign in.',
    );
  }
  try {
    return await verifier.verify(token);
  } catch {
    throw new ApiError(401, ErrorCode.idTokenInvalid, 'Sign-in could not be confirmed', 'Try again.');
  }
}
