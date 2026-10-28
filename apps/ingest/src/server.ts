import { Redis } from 'ioredis';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { buildIngestApp } from './app';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().default(3001),
    LOG_LEVEL: z.string().default('info'),
    REDIS_URL: z.string().min(1),
    /** As in the API: false for Heroku Key-Value Store's self-signed certificates. */
    REDIS_TLS_VERIFY: z.enum(['true', 'false']).default('true'),
    API_JWKS_URL: z.string().url().default('http://localhost:3000/.well-known/jwks.json'),
    ANALYTICS_KEY: z.string().min(32).optional(),
    CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  })
  .parse(process.env);

if (env.NODE_ENV === 'production' && !env.ANALYTICS_KEY)
  throw new Error('ANALYTICS_KEY is required in production');

// Must match the API's key so client and server events share player ids.
const analyticsKey = env.ANALYTICS_KEY ?? 'dev-only-analytics-key-not-for-production-use';
const jwks = createRemoteJWKSet(new URL(env.API_JWKS_URL));
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  ...(env.REDIS_URL.startsWith('rediss://')
    ? { tls: { rejectUnauthorized: env.REDIS_TLS_VERIFY === 'true' } }
    : {}),
});

const app = await buildIngestApp({
  redis,
  analyticsKey,
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  logLevel: env.LOG_LEVEL,
  verifyAccess: async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'whosabi-api',
      audience: 'whosabi',
      algorithms: ['ES256'],
    });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string') throw new Error('not an access token');
    return { userId: payload.sub };
  },
});

const shutdown = async () => {
  await app.close();
  await redis.quit();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: env.HOST, port: env.PORT });
