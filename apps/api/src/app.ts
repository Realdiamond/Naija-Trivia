import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { authRoutes } from './auth/routes';
import { registerAuth } from './auth/context';
import type { TokenService } from './auth/tokens';
import type { Clock } from './clock';
import type { Config } from './config';
import { contentRoutes } from './content/routes';
import { duelRoutes } from './duels/routes';
import type { Pool } from './db';
import { registerErrorHandlers } from './errors';
import { ServerEvents } from './events';
import { newId } from './ids';
import { roundRoutes } from './rounds/routes';

export interface AppDeps {
  config: Config;
  pool: Pool;
  redis: Redis;
  tokens: TokenService;
  clock: Clock;
  events: ServerEvents;
  log: FastifyBaseLogger;
}

export interface BuildOptions {
  config: Config;
  pool: Pool;
  redis: Redis;
  tokens: TokenService;
  clock: Clock;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: options.config.logLevel },
    genReqId: () => newId('req'),
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  const deps: AppDeps = {
    ...options,
    events: new ServerEvents(options.redis, options.config.analyticsKey, options.clock, app.log),
    log: app.log,
  };

  registerErrorHandlers(app);
  await app.register(cors, {
    origin: options.config.corsOrigins,
    credentials: true,
    allowedHeaders: [
      'authorization',
      'content-type',
      'x-requested-with',
      'x-session-id',
      'x-app-version',
      'x-platform',
      'idempotency-key',
    ],
    exposedHeaders: ['retry-after'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, redis: options.redis, nameSpace: 'rl:' });
  registerAuth(app, options.tokens);

  // Public signing keys, so other services (ingest) can verify access tokens.
  app.get('/.well-known/jwks.json', async (_request, reply) => {
    void reply.header('cache-control', 'public, max-age=300');
    return options.tokens.jwks;
  });

  app.get('/health', async () => {
    await Promise.all([options.pool.query('SELECT 1'), options.redis.ping()]);
    return { ok: true };
  });

  authRoutes(app, deps);
  contentRoutes(app, deps);
  roundRoutes(app, deps);
  duelRoutes(app, deps);
  return app;
}
