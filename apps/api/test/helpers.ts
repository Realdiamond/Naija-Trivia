import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { inject } from 'vitest';
import type { AuthResponse, Platform } from '@whosabi/shared-types';
import { buildApp } from '../src/app';
import { createTokenService } from '../src/auth/tokens';
import { loadConfig } from '../src/config';
import { createPool } from '../src/db';

export class TestClock {
  constructor(public t = Date.UTC(2026, 10, 2, 7, 0, 0)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export async function createTestApp(env: Record<string, string> = {}) {
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
  const app = await buildApp({ config, pool, redis, tokens, clock });
  await app.ready();
  return {
    app,
    clock,
    config,
    pool,
    redis,
    tokens,
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
