/**
 * The one-process launch setup (Heroku, build plan step 1.6): the API also serves the web app
 * from its own origin and takes analytics events, and connects to TLS Redis.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import { createRedis } from '../src/redis';
import { bearer, createTestApp, signInGuest } from './helpers';

const BIG_BUNDLE = `${'export const questions = ["Who sang Ye?", "Jollof or fried rice?"];\n'.repeat(400)}`;

describe('the web app from the API origin', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'web-build-'));
    await mkdir(path.join(dir, '_expo/static/js'), { recursive: true });
    // About the size of the real one (Expo's styles and script tags).
    await writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html><head><title>Who Sabi?</title><style>${'#root{display:flex;flex:1}'.repeat(60)}</style></head>`,
    );
    await writeFile(path.join(dir, '_expo/static/js/entry-abc123.js'), 'console.log(1)');
    await writeFile(path.join(dir, 'favicon.ico'), 'icon');
    await writeFile(path.join(dir, 'sw.js'), "self.addEventListener('push', () => {});");
    await writeFile(path.join(dir, 'manifest.webmanifest'), '{"name":"Who Sabi?"}');
    // What scripts/precompress.mjs leaves next to a big bundle.
    await writeFile(path.join(dir, '_expo/static/js/big-def456.js'), BIG_BUNDLE);
    await writeFile(path.join(dir, '_expo/static/js/big-def456.js.br'), brotliCompressSync(BIG_BUNDLE));
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

  it('sends bundles and replies compressed to browsers that take it (Data Saver, step 2.8b)', async () => {
    const url = '/_expo/static/js/big-def456.js';
    const br = await t.app.inject({ method: 'GET', url, headers: { 'accept-encoding': 'gzip, br' } });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toContain('javascript');
    expect(br.rawPayload.length).toBeLessThan(BIG_BUNDLE.length / 5);
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe(BIG_BUNDLE);
    // Without a precompressed copy for it, the file is compressed on the way out.
    const gz = await t.app.inject({ method: 'GET', url, headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(BIG_BUNDLE);
    const plain = await t.app.inject({ method: 'GET', url });
    expect([plain.headers['content-encoding'], plain.body]).toEqual([undefined, BIG_BUNDLE]);

    // Pages, and API replies of 1 KB or more; small ones aren't worth it.
    const page = await t.app.inject({ method: 'GET', url: '/welcome', headers: { 'accept-encoding': 'br' } });
    expect(page.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(page.rawPayload).toString()).toContain('<title>Who Sabi?</title>');
    const guest = await signInGuest(t.app);
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/consents',
      headers: bearer(guest.access),
      payload: {
        source: 'settings',
        consents: ['terms', 'privacy', 'analytics', 'marketing_push', 'contacts'].map((purpose) => ({
          purpose,
          granted: true,
          policy_version: '2026-10',
        })),
      },
    });
    const data = await t.app.inject({
      method: 'GET',
      url: '/v1/me/export',
      headers: { ...bearer(guest.access), 'accept-encoding': 'gzip, br' },
    });
    expect(data.headers['content-encoding']).toBe('br');
    expect(JSON.parse(brotliDecompressSync(data.rawPayload).toString()).profile.id).toBe(guest.user.id);
    const health = await t.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'accept-encoding': 'br' },
    });
    expect([health.headers['content-encoding'], health.json()]).toEqual([undefined, { ok: true }]);
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

describe('party links on the web (step 2.2c)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    const web = await mkdtemp(path.join(tmpdir(), 'web-build-'));
    await writeFile(path.join(web, 'index.html'), '<!doctype html><head><title>Full app</title></head>');
    const guest = await mkdtemp(path.join(tmpdir(), 'web-guest-'));
    await mkdir(path.join(guest, 'assets'));
    await writeFile(path.join(guest, 'index.html'), '<!doctype html><head><title>Light party</title></head>');
    await writeFile(path.join(guest, 'assets/index-abc.js'), 'console.log(1)');
    t = await createTestApp({ WEB_APP_DIR: web, WEB_GUEST_DIR: guest });
  });
  afterAll(() => t.close());

  it('opens a party link in the light party client, with its preview', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/r/K7QXM' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Light party');
    expect(res.body).toContain('Join the party on Who Sabi? Room K7QXM');
    // "Sign in to keep your score" opens the same room in the full app.
    expect((await t.app.inject({ method: 'GET', url: '/r/K7QXM?app=1' })).body).toContain('Full app');
    expect((await t.app.inject({ method: 'GET', url: '/home' })).body).toContain('Full app');
  });

  it('serves its files under /party-client/, hashed ones for a year', async () => {
    const js = await t.app.inject({ method: 'GET', url: '/party-client/assets/index-abc.js' });
    expect([js.statusCode, js.headers['cache-control']]).toEqual([
      200,
      'public, max-age=31536000, immutable',
    ]);
    const missing = await t.app.inject({ method: 'GET', url: '/party-client/assets/nope.js' });
    expect([missing.statusCode, missing.headers['content-type']]).toEqual([
      404,
      'application/problem+json; charset=utf-8',
    ]);
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
