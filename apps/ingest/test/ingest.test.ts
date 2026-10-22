import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Redis } from 'ioredis';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventBatch } from '@whosabi/analytics';
import { pseudonymousId } from '@whosabi/analytics/server';
import { buildIngestApp } from '../src/app';

const KEY = 'test-analytics-key-0123456789abcdef';
const NOW = Date.parse('2026-11-02T08:00:00.000Z');
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
redisUrl.pathname = '/14';

let redis: Redis;
let app: Awaited<ReturnType<typeof buildIngestApp>>;
let sign: (sub: string, expiresInS?: number) => Promise<string>;

beforeAll(async () => {
  redis = new Redis(redisUrl.toString());
  await redis.flushdb();
  // Same token shape the API issues (apps/api/src/auth/tokens.ts).
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'ES256' }] });
  sign = (sub, expiresInS = 900) =>
    new SignJWT({ typ: 'access', plt: 'web', gst: true })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(sub)
      .setIssuer('whosabi-api')
      .setAudience('whosabi')
      .setIssuedAt(Math.floor(NOW / 1000))
      .setExpirationTime(Math.floor(NOW / 1000) + expiresInS)
      .sign(privateKey);
  app = await buildIngestApp({
    redis,
    analyticsKey: KEY,
    corsOrigins: ['http://localhost:8081'],
    now: () => NOW,
    logLevel: 'silent',
    verifyAccess: async (token) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: 'whosabi-api',
        audience: 'whosabi',
        currentDate: new Date(NOW),
      });
      return { userId: payload.sub! };
    },
  });
});

afterAll(async () => {
  await app.close();
  await redis.quit();
});

function batch(events: Array<Partial<EventBatch['events'][number]>>, behaviour = true): EventBatch {
  return {
    batch_id: `b_${randomUUID()}`,
    sent_at: new Date(NOW - 1000).toISOString(),
    context: {
      platform: 'web',
      app_version: '0.1.0',
      browser: 'chrome_desktop',
      language: 'en',
      data_saver: false,
      anon_id: 'anon_test_1',
      consent: { behaviour },
    },
    events: events.map((e, i) => ({
      event_id: randomUUID(),
      event: 'app_foregrounded',
      ts: new Date(NOW - 5000).toISOString(),
      session_id: 's_1',
      seq: i,
      screen: null,
      props: {},
      ...e,
    })),
  };
}

async function streamRows(pid: string) {
  const entries = (await redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((r) => r.user_pid === pid);
}

const send = async (body: unknown, token?: string, gzip = false) =>
  app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    },
    payload: gzip ? gzipSync(JSON.stringify(body)) : JSON.stringify(body),
  });

describe('POST /v1/events', () => {
  it('accepts a batch once, attributed to a pseudonymous player id', async () => {
    const token = await sign('u_ingest_1');
    const b = batch([
      { event: 'session_started', props: { source: 'launch' } },
      { event: 'app_foregrounded' },
    ]);
    const first = await send(b, token);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ accepted: 2, rejected: 0, duplicate: false });

    const retry = await send({ ...b, sent_at: new Date(NOW).toISOString() }, token);
    expect(retry.json()).toEqual({ accepted: 2, rejected: 0, duplicate: true });

    const rows = await streamRows(pseudonymousId('u_ingest_1', KEY));
    expect(rows.map((r) => r.event)).toEqual(['session_started', 'app_foregrounded']);
    expect(rows[0]).toMatchObject({ source: 'client', platform: 'web', anon_id: 'anon_test_1' });
    expect(JSON.stringify(rows)).not.toContain('u_ingest_1');
  });

  it('accepts gzipped batches', async () => {
    const res = await send(batch([{}]), await sign('u_ingest_2'), true);
    expect(res.statusCode).toBe(202);
  });

  it('drops behaviour events without consent and quarantines events the plan does not allow', async () => {
    const token = await sign('u_ingest_3');
    const res = await send(
      batch(
        [
          { event: 'screen_viewed', props: { screen: 'home', prev_screen: '', prev_screen_ms: 0 } },
          { event: 'purchase_completed', props: { sku: 'x', store: 'play', net_kobo: 1 } },
          { event: 'app_backgrounded', props: { foreground_ms: 1000 } },
        ],
        false,
      ),
      token,
    );
    expect(res.json()).toEqual({ accepted: 1, rejected: 2, duplicate: false });
    const quarantined = (await redis.xrange('ev:quarantine', '-', '+')) as Array<[string, string[]]>;
    expect(JSON.parse(quarantined.at(-1)![1][1]!)).toEqual([
      { event: 'purchase_completed', reason: 'server_only' },
    ]);
  });

  it('needs a valid access token', async () => {
    expect((await send(batch([{}]))).statusCode).toBe(401);
    expect((await send(batch([{}]), 'not-a-token')).statusCode).toBe(401);
    expect((await send(batch([{}]), await sign('u_ingest_4', -10))).statusCode).toBe(401);
  });

  it('rejects malformed batches so clients stop retrying them', async () => {
    const token = await sign('u_ingest_5');
    expect((await send({ hello: 'world' }, token)).statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(400);
  });
});
