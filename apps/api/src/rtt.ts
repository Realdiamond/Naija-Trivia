/**
 * Round-trip sampling for the timing clamp (TRD §5.3). The server times both ends: the app asks
 * for a ping and answers it straight away, so a client cannot report a made-up latency.
 *   ping:{id}                 {user, session, at}, 30 s
 *   rtt:{user}:{session}      the last 5 samples, 1 h
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { estimateRtt, RTT_SAMPLES } from '@whosabi/game-rules';
import type { PingResponse, PongResponse } from '@whosabi/shared-types';
import type { AppDeps } from './app';
import { requireAuth } from './auth/context';
import { notFound, parse } from './errors';
import { requestEventContext } from './events';

const PING_TTL_SECONDS = 30;
const RTT_TTL_SECONDS = 3600;

const rttKey = (userId: string, sessionId: string | null | undefined) => `rtt:${userId}:${sessionId ?? '-'}`;

/** The session's estimate, or the configured default until it has samples. */
export async function rttFor(
  redis: Redis,
  userId: string,
  sessionId: string | null | undefined,
  fallbackMs: number,
): Promise<number> {
  const samples = (await redis.lrange(rttKey(userId, sessionId), 0, RTT_SAMPLES - 1)).map(Number);
  return estimateRtt(samples) ?? fallbackMs;
}

export function rttRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { redis, clock, config } = deps;

  app.post('/v1/ping', async (request): Promise<PingResponse> => {
    requireAuth(request);
    const ctx = requestEventContext(request);
    const id = `p_${randomBytes(12).toString('base64url')}`;
    const at = clock.now();
    await redis.set(
      `ping:${id}`,
      JSON.stringify({ user: ctx.userId, session: ctx.sessionId ?? null, at }),
      'EX',
      PING_TTL_SECONDS,
    );
    return { ping_id: id, server_time: new Date(at).toISOString() };
  });

  app.post('/v1/ping/:pingId', async (request): Promise<PongResponse> => {
    requireAuth(request);
    const ctx = requestEventContext(request);
    const { pingId } = parse(z.object({ pingId: z.string().regex(/^p_[\w-]{16}$/) }), request.params);
    // GETDEL: each ping counts once.
    const raw = await redis.getdel(`ping:${pingId}`);
    const ping = raw ? (JSON.parse(raw) as { user: string; session: string | null; at: number }) : null;
    if (!ping || ping.user !== ctx.userId || ping.session !== (ctx.sessionId ?? null)) {
      throw notFound('This ping has expired.');
    }
    const rtt = Math.max(0, clock.now() - ping.at);
    const key = rttKey(ctx.userId, ctx.sessionId);
    await redis
      .multi()
      .lpush(key, rtt)
      .ltrim(key, 0, RTT_SAMPLES - 1)
      .expire(key, RTT_TTL_SECONDS)
      .exec();
    return { rtt_ms: rtt, rtt_est_ms: await rttFor(redis, ctx.userId, ctx.sessionId, config.defaultRttMs) };
  });
}
