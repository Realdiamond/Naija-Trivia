/**
 * POST /v1/events (doc 09 §2.11): one gzipped or plain JSON batch per request.
 *   202  accepted (also for a batch we already have: the client may drop it)
 *   400  malformed batch (the client drops it rather than retrying forever)
 *   401  missing or expired access token (the client refreshes, then retries)
 * Never touches Postgres and never blocks gameplay: it only appends to the Redis stream.
 */
import { gunzipSync } from 'node:zlib';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { EventBatch } from '@whosabi/analytics';
import { appendBatchOnce, pseudonymousId, rowsFromBatch } from '@whosabi/analytics/server';

const MAX_COMPRESSED_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const QUARANTINE_STREAM = 'ev:quarantine';

export interface AccessIdentity {
  userId: string;
}

export interface IngestRouteOptions {
  redis: Redis;
  /** Verifies an access token issued by the API; throws if it is invalid or expired. */
  verifyAccess: (token: string) => Promise<AccessIdentity>;
  analyticsKey: string;
  now?: () => number;
}

export interface IngestOptions extends IngestRouteOptions {
  corsOrigins: string[];
  logLevel?: string;
}

export async function buildIngestApp(options: IngestOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: options.logLevel ?? 'info' },
    bodyLimit: MAX_COMPRESSED_BYTES,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: options.corsOrigins,
    allowedHeaders: ['authorization', 'content-type', 'content-encoding'],
    maxAge: 86_400,
  });

  app.get('/health', async () => {
    await options.redis.ping();
    return { ok: true };
  });

  // The intake in its own context, so its JSON parser applies to it alone.
  const { redis, verifyAccess, analyticsKey, now } = options;
  await app.register(ingestRoutes, { redis, verifyAccess, analyticsKey, now });
  return app;
}

/**
 * POST /v1/events as a plugin: the standalone service above, or mounted in the API when one
 * process serves both (the Heroku launch setup, doc 07 §5).
 */
export async function ingestRoutes(app: FastifyInstance, options: IngestRouteOptions): Promise<void> {
  const now = options.now ?? (() => Date.now());
  // Batches arrive as JSON, optionally gzipped. Decompression is capped against zip bombs.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body: Buffer, done) => {
    try {
      const raw =
        request.headers['content-encoding'] === 'gzip'
          ? gunzipSync(body, { maxOutputLength: MAX_JSON_BYTES })
          : body;
      done(null, JSON.parse(raw.toString('utf8')));
    } catch {
      done(
        Object.assign(new Error('Body must be JSON (optionally gzipped)'), { statusCode: 400 }),
        undefined,
      );
    }
  });

  app.post('/v1/events', async (request, reply) => {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
    let identity: AccessIdentity;
    try {
      if (!token) throw new Error('missing token');
      identity = await options.verifyAccess(token);
    } catch {
      return reply.code(401).send({ code: 'UNAUTHORIZED' });
    }

    const parsed = EventBatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' });
    const batch = parsed.data;

    const userPid = pseudonymousId(identity.userId, options.analyticsKey);
    const { rows, rejected } = rowsFromBatch(batch, now(), { userPid });
    // Players' consent choices are expected; anything else is a client bug worth a look.
    const suspicious = rejected.filter((r) => r.reason !== 'no_consent');
    if (suspicious.length > 0) {
      request.log.warn({ rejected: suspicious }, 'events quarantined');
      await options.redis.call(
        'XADD',
        QUARANTINE_STREAM,
        'MAXLEN',
        '~',
        10_000,
        '*',
        'rejected',
        JSON.stringify(suspicious),
        'batch_id',
        batch.batch_id,
      );
    }

    // Namespaced by player, so one player's batch id can never block another's.
    const fresh = await appendBatchOnce(options.redis, `${userPid}:${batch.batch_id}`, rows);
    return reply.code(202).send({ accepted: rows.length, rejected: rejected.length, duplicate: !fresh });
  });
}
