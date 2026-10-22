/**
 * Server analytics events (doc 13: business events come from the server). Written straight
 * to the Redis stream the loader drains into ClickHouse. Never throws: analytics must not
 * break gameplay (TRD FR-ANA-6).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { EventProps, ServerEventName } from '@whosabi/analytics';
import { appendRows, pseudonymousId, serverEventRow, type RedisCommander } from '@whosabi/analytics/server';
import type { Platform } from '@whosabi/shared-types';
import type { Clock } from './clock';

export interface EventContext {
  userId: string;
  platform: Platform;
  sessionId?: string | null;
  appVersion?: string;
}

export class ServerEvents {
  constructor(
    private readonly redis: RedisCommander,
    private readonly analyticsKey: string,
    private readonly clock: Clock,
    private readonly log: FastifyBaseLogger,
  ) {}

  async emit<E extends ServerEventName>(event: E, props: EventProps<E>, ctx: EventContext): Promise<void> {
    try {
      const now = this.clock.now();
      const row = serverEventRow(event, props, {
        eventId: randomUUID(),
        atMs: now,
        platform: ctx.platform,
        sessionId: ctx.sessionId,
        appVersion: ctx.appVersion,
        userPid: pseudonymousId(ctx.userId, this.analyticsKey),
      });
      await appendRows(this.redis, [row]);
    } catch (err) {
      this.log.warn({ err, event }, 'analytics event not recorded');
    }
  }
}

/** Analytics context for a signed-in request: platform from the token, session and app version from headers (doc 09 §1). */
export function requestEventContext(request: FastifyRequest): EventContext {
  const auth = request.auth;
  if (!auth) throw new Error('requestEventContext needs a signed-in request');
  return eventContextFor(request, auth.userId, auth.platform);
}

/** The same context for a player the request is not signed in as yet (sign-in itself). */
export function eventContextFor(request: FastifyRequest, userId: string, platform: Platform): EventContext {
  return {
    userId,
    platform,
    sessionId: headerValue(request, 'x-session-id'),
    appVersion: headerValue(request, 'x-app-version') ?? undefined,
  };
}

function headerValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}
