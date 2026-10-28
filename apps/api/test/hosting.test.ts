/**
 * The one-process launch setup (Heroku, build plan step 1.6): the API also serves the web app
 * from its own origin and takes analytics events, and connects to TLS Redis.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import { createRedis } from '../src/redis';
import { bearer, createTestApp, signInGuest } from './helpers';

describe('the web app from the API origin', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'web-build-'));
    await mkdir(path.join(dir, '_expo/static/js'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Who Sabi?</title>');
    await writeFile(path.join(dir, '_expo/static/js/entry-abc123.js'), 'console.log(1)');
    await writeFile(path.join(dir, 'favicon.ico'), 'icon');
    await writeFile(path.join(dir, 'sw.js'), "self.addEventListener('push', () => {});");
    await writeFile(path.join(dir, 'manifest.webmanifest'), '{"name":"Who Sabi?"}');
    t = await createTestApp({ WEB_APP_DIR: dir });
  });
  afterAll(() => t.close());

  it('serves pages the app routes itself, always fresh', async () => {
    for (const url of ['/', '/welcome', '/duel/d_123', '/d/abcdefghijklmnop?x=1']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('Who Sabi?');
    }
  });

  it('caches hashed bundles for a year, other files not at all', async () => {
    const bundle = await t.app.inject({ method: 'GET', url: '/_expo/static/js/entry-abc123.js' });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const icon = await t.app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('serves the service worker and the manifest as browsers need them (web push)', async () => {
    const worker = await t.app.inject({ method: 'GET', url: '/sw.js' });
    expect(worker.statusCode).toBe(200);
    expect(worker.headers['content-type']).toContain('javascript');
    // A new worker reaches browsers on their next visit.
    expect(worker.headers['cache-control']).toBe('no-cache');
    const manifest = await t.app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
  });

  it('keeps the API as it is: its routes, and problem+json for unknown API paths', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
    expect((await t.app.inject({ method: 'GET', url: '/v1/auth/methods' })).statusCode).toBe(200);
    for (const [method, url] of [
      ['GET', '/v1/nothing-here'],
      ['GET', '/admin/nothing-here'],
      ['POST', '/welcome'],
    ] as const) {
      const res = await t.app.inject({ method, url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  });
});

describe('events taken by the API itself', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp({ EVENTS_IN_API: 'true' });
  });
  afterAll(() => t.close());

  const batch = () => ({
    batch_id: `b_${randomUUID()}`,
    sent_at: new Date(t.clock.now()).toISOString(),
    context: {
      platform: 'web',
      app_version: '0.1.0',
      language: 'en',
      data_saver: false,
      anon_id: 'anon_hosting_1',
      consent: { behaviour: true },
    },
    events: [
      {
        event_id: randomUUID(),
        event: 'app_foregrounded',
        ts: new Date(t.clock.now() - 1000).toISOString(),
        session_id: 's_1',
        seq: 0,
        screen: null,
        props: {},
      },
    ],
  });

  it('accepts a batch with a player token into the event stream, once', async () => {
    const guest = await signInGuest(t.app, 'web');
    const body = batch();
    const send = () =>
      t.app.inject({ method: 'POST', url: '/v1/events', headers: bearer(guest.access), payload: body });
    expect((await send()).statusCode).toBe(202);
    expect((await send()).json()).toMatchObject({ duplicate: true });

    const pid = pseudonymousId(guest.user.id, t.config.analyticsKey);
    const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
    const rows = entries
      .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
      .filter((row) => row.user_pid === pid && row.event === 'app_foregrounded');
    expect(rows).toHaveLength(1);
  });

  it('refuses batches without a valid token', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/v1/events', payload: batch() })).statusCode).toBe(
      401,
    );
  });
});

describe('Redis over TLS', () => {
  it('turns certificate checks off only when asked (Heroku Key-Value Store)', () => {
    const heroku = createRedis(
      { redisUrl: 'rediss://h:p@example.com:6380', redisTlsVerify: false },
      { lazyConnect: true },
    );
    const strict = createRedis(
      { redisUrl: 'rediss://h:p@example.com:6380', redisTlsVerify: true },
      { lazyConnect: true },
    );
    const local = createRedis(
      { redisUrl: 'redis://localhost:6379', redisTlsVerify: false },
      { lazyConnect: true },
    );
    expect(heroku.options.tls).toEqual({ rejectUnauthorized: false });
    expect(strict.options.tls).toEqual({ rejectUnauthorized: true });
    expect(local.options.tls).toBeUndefined();
    for (const r of [heroku, strict, local]) r.disconnect();
  });
});
