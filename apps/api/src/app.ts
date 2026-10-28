import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { adminRoutes } from './admin/routes';
import { createAuthProviders, type AuthProviders } from './auth/providers';
import { authRoutes } from './auth/routes';
import { registerAuth } from './auth/context';
import type { TokenService } from './auth/tokens';
import type { Clock } from './clock';
import type { Config } from './config';
import { contentRoutes } from './content/routes';
import { dailyRoutes } from './daily/routes';
import { duelRoutes } from './duels/routes';
import type { Pool } from './db';
import { registerErrorHandlers } from './errors';
import { ingestRoutes } from '@whosabi/ingest';
import { ServerEvents } from './events';
import { newId } from './ids';
import { profileRoutes } from './profile/routes';
import { roundRoutes } from './rounds/routes';
import { rttRoutes } from './rtt';
import { socialRoutes } from './social/routes';
import { serveWebApp, webAppPage } from './web';

export interface AppDeps {
  config: Config;
  pool: Pool;
  redis: Redis;
  tokens: TokenService;
  clock: Clock;
  events: ServerEvents;
  log: FastifyBaseLogger;
  auth: AuthProviders;
}

export interface BuildOptions {
  config: Config;
  pool: Pool;
  redis: Redis;
  tokens: TokenService;
  clock: Clock;
  /** Stand-ins for SMS, Turnstile and Google/Apple sign-in (tests); real ones come from config. */
  auth?: Partial<AuthProviders>;
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
    auth: { ...createAuthProviders(options.config, app.log, options.clock.now), ...options.auth },
  };

  registerErrorHandlers(app, options.config.webAppDir ? webAppPage : undefined);
  await app.register(cors, {
    origin: options.config.corsOrigins,
    credentials: true,
    // The plugin only allows GET, HEAD and POST by default; profile edits and unfriending need these.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
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
  profileRoutes(app, deps);
  socialRoutes(app, deps);
  rttRoutes(app, deps);
  roundRoutes(app, deps);
  duelRoutes(app, deps);
  dailyRoutes(app, deps);
  adminRoutes(app, deps);

  // One process for everything at launch (Heroku, doc 07 §5): the event intake and the web app.
  if (options.config.eventsInApi) {
    await app.register(ingestRoutes, {
      redis: options.redis,
      analyticsKey: options.config.analyticsKey,
      now: options.clock.now,
      verifyAccess: async (token) => ({ userId: (await options.tokens.verifyAccess(token)).userId }),
    });
  }
  if (options.config.webAppDir) await serveWebApp(app, options.config.webAppDir);
  return app;
}
