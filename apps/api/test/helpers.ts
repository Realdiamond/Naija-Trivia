import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { inject } from 'vitest';
import type { AuthResponse, Platform } from '@whosabi/shared-types';
import { buildApp } from '../src/app';
import { APPLE_ISSUERS, GOOGLE_ISSUERS, idTokenVerifier, type AuthProviders } from '../src/auth/providers';
import { DevSms } from '../src/auth/sms';
import { createTokenService } from '../src/auth/tokens';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';

export const TEST_GOOGLE_CLIENT = 'test-client.apps.googleusercontent.com';
export const TEST_APPLE_AUDIENCE = 'ng.whosabi.app';

/** Keeps every SMS; `down` makes it fail like a provider outage. */
export class TestSms extends DevSms {
  down = false;
  override async send(to: string, text: string): Promise<string> {
    if (this.down) throw new Error('provider down');
    return super.send(to, text);
  }
  /** The newest code sent to a number. */
  codeFor(phone: string): string {
    const message = this.outbox.filter((m) => m.to === phone).at(-1);
    const code = message && /code is (\d{6})/.exec(message.text)?.[1];
    if (!code) throw new Error(`no code sent to ${phone}`);
    return code;
  }
}

/** Google and Apple tokens signed by a local key, checked by the real verifier. */
async function testIdentityProviders(now: () => number) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }] });
  const signer =
    (issuer: string, audience: string) =>
    (claims: { sub: string; nonce?: string }, override: { audience?: string; expiresInS?: number } = {}) => {
      const iat = Math.floor(now() / 1000);
      return new SignJWT(claims.nonce ? { nonce: claims.nonce } : {})
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(issuer)
        .setAudience(override.audience ?? audience)
        .setSubject(claims.sub)
        .setIssuedAt(iat)
        .setExpirationTime(iat + (override.expiresInS ?? 3600))
        .sign(privateKey);
    };
  return {
    google: idTokenVerifier({ issuers: GOOGLE_ISSUERS, audiences: [TEST_GOOGLE_CLIENT], keys, now }),
    apple: idTokenVerifier({ issuers: APPLE_ISSUERS, audiences: [TEST_APPLE_AUDIENCE], keys, now }),
    signGoogle: signer(GOOGLE_ISSUERS[0]!, TEST_GOOGLE_CLIENT),
    signApple: signer(APPLE_ISSUERS[0]!, TEST_APPLE_AUDIENCE),
  };
}

export class TestClock {
  constructor(public t = Date.UTC(2026, 10, 2, 7, 0, 0)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export async function createTestApp(
  env: Record<string, string> = {},
  overrides: { auth?: Partial<AuthProviders> } = {},
) {
  const clock = new TestClock();
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    CORS_ORIGINS: 'http://localhost:8081',
    GUEST_SIGNUPS_PER_IP_PER_HOUR: '10000',
    ...env,
  });
  const pool = createPool(config.databaseUrl);
  const redis = new Redis(config.redisUrl);
  const tokens = await createTokenService({}, clock.now);
  const sms = new TestSms();
  const identity = await testIdentityProviders(clock.now);
  const auth: AuthProviders = {
    sms,
    // Only the token 'human' passes the Turnstile stand-in.
    captcha: { verify: async (token) => token === 'human' },
    google: identity.google,
    apple: identity.apple,
    ...overrides.auth,
  };
  const app = await buildApp({ config, pool, redis, tokens, clock, auth });
  await app.ready();
  return {
    app,
    clock,
    config,
    pool,
    redis,
    tokens,
    auth,
    sms,
    signGoogle: identity.signGoogle,
    signApple: identity.signApple,
    close: async () => {
      await app.close();
      await Promise.all([pool.end(), redis.quit()]);
    },
  };
}

export const newDeviceId = () => randomBytes(24).toString('base64url');

export async function signInGuest(
  app: FastifyInstance,
  platform: Platform = 'android',
  deviceId = newDeviceId(),
) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { device_id: deviceId, platform },
  });
  if (res.statusCode >= 300) throw new Error(`guest sign-in failed: ${res.statusCode} ${res.body}`);
  return { ...(res.json() as AuthResponse), deviceId, response: res };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
