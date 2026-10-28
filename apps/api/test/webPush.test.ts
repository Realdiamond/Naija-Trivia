/**
 * Web push (step 2.5c): encryption checked against RFC 8291's own example, the VAPID signature,
 * what the push services' answers mean, browsers subscribing (only at real push services), and
 * the push job reaching a browser.
 */
import { createDecipheriv, createECDH, hkdfSync, type ECDH } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importJWK, jwtVerify } from 'jose';
import type { WebPushKeyResponse } from '@whosabi/shared-types';
import { ServerEvents } from '../src/events';
import type { JobDeps } from '../src/jobs/deps';
import { sendDuePushes } from '../src/push/dispatch';
import { queuePush } from '../src/push/queue';
import { INVALID_TOKEN, PushRejected, PushRouter, type OutgoingPush } from '../src/push/transport';
import {
  encryptForBrowser,
  isPushService,
  newVapidKeys,
  vapidKeysFrom,
  WebPushTransport,
  type WebPushPayload,
} from '../src/push/webpush';
import { bearer, createTestApp, signInGuest } from './helpers';
import { TestTransport } from './pushHelpers';

const b = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');

describe('web push encryption', () => {
  it('matches the worked example in RFC 8291', () => {
    const sender = createECDH('prime256v1');
    sender.setPrivateKey(b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
    const message = encryptForBrowser(
      b('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      sender,
      b('DGv6ra1nlYgDCS1FRnbzlw'),
    );
    const header = b(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
      mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`);
    const ciphertext = b(`8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs
      bI_0LpXMuGvnzQ`);
    expect(message.toString('base64url')).toBe(Buffer.concat([header, ciphertext]).toString('base64url'));
  });

  it('only sends to the push services browsers use', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isPushService(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com',
      'https://localhost/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pass@fcm.googleapis.com/x',
      'not a url',
    ]) {
      expect(isPushService(bad), bad).toBe(false);
    }
  });
});

/** A browser: its keys, and how it reads what arrives. */
function browser() {
  const ua: ECDH = createECDH('prime256v1');
  ua.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const read = (body: Buffer): WebPushPayload => {
    const salt = body.subarray(0, 16);
    const asPublic = body.subarray(21, 21 + body[20]!);
    const ikm = Buffer.from(
      hkdfSync(
        'sha256',
        ua.computeSecret(asPublic),
        auth,
        Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]),
        32,
      ),
    );
    const cek = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
    const data = body.subarray(21 + body[20]!);
    const decipher = createDecipheriv('aes-128-gcm', Buffer.from(cek), Buffer.from(nonce));
    decipher.setAuthTag(data.subarray(-16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
    expect(plain.at(-1)).toBe(2);
    return JSON.parse(plain.subarray(0, -1).toString()) as WebPushPayload;
  };
  return { keys, read };
}

const PUSH: OutgoingPush = {
  type: 'your_turn',
  title: 'Your turn vs chidi',
  body: 'Chidi has played. Your move.',
  url: '/duel/d_1',
  channel: 'duels',
  data: { duel_id: 'd_1' },
  collapseKey: 'duel:d_1',
  ttlSeconds: 3600.7,
};

describe('sending a web push', () => {
  const keys = newVapidKeys('mailto:team@whosabi.ng');
  const endpoint = 'https://fcm.googleapis.com/fcm/send/sub-1';

  function transport(status = 201) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 201 ? '' : 'nope', { status });
    }) as unknown as typeof fetch;
    return { calls, push: new WebPushTransport(keys, fake, () => Date.UTC(2026, 10, 2, 9)) };
  }

  it('encrypts the message for the browser and signs who we are', async () => {
    const { calls, push } = transport();
    const tab = browser();
    expect(await push.send({ id: 'dev_1', platform: 'web', token: endpoint, keys: tab.keys }, PUSH)).toBe(
      'delivered',
    );
    const { url, init } = calls[0]!;
    expect(url).toBe(endpoint);
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      ttl: '3600',
      urgency: 'high',
      topic: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
    });
    expect(tab.read(Buffer.from(init.body as Uint8Array))).toEqual({
      title: PUSH.title,
      body: PUSH.body,
      url: '/duel/d_1',
      type: 'your_turn',
      tag: 'duel:d_1',
    });

    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization!)!;
    expect(k).toBe(keys.publicKey);
    const raw = Buffer.from(keys.publicKey, 'base64url');
    const key = await importJWK(
      {
        kty: 'EC',
        crv: 'P-256',
        x: raw.subarray(1, 33).toString('base64url'),
        y: raw.subarray(33).toString('base64url'),
      },
      'ES256',
    );
    const { payload } = await jwtVerify(jwt!, key, {
      audience: 'https://fcm.googleapis.com',
      currentDate: new Date(Date.UTC(2026, 10, 2, 9)),
    });
    expect(payload).toMatchObject({ sub: 'mailto:team@whosabi.ng', exp: Date.UTC(2026, 10, 2, 21) / 1000 });

    // The same signature serves the next message to that push service.
    await push.send({ id: 'dev_1', platform: 'web', token: endpoint, keys: tab.keys }, PUSH);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe(headers.authorization);
  });

  it('tells ended subscriptions, refusals and failures worth retrying apart', async () => {
    const device = { id: 'dev_1', platform: 'web' as const, token: endpoint, keys: browser().keys };
    expect(await transport(410).push.send(device, PUSH)).toBe(INVALID_TOKEN);
    expect(await transport(404).push.send(device, PUSH)).toBe(INVALID_TOKEN);
    await expect(transport(400).push.send(device, PUSH)).rejects.toBeInstanceOf(PushRejected);
    await expect(transport(403).push.send(device, PUSH)).rejects.toBeInstanceOf(PushRejected);
    const busy = transport(429).push.send(device, PUSH);
    await expect(busy).rejects.toThrow('web push 429');
    await expect(busy).rejects.not.toBeInstanceOf(PushRejected);
    await expect(transport(503).push.send(device, PUSH)).rejects.not.toBeInstanceOf(PushRejected);
    // Never anywhere but a push service, whatever is in the database.
    const elsewhere = { ...device, token: 'https://internal.example/hook' };
    await expect(transport().push.send(elsewhere, PUSH)).rejects.toBeInstanceOf(PushRejected);
  });

  it('derives the public key from the private one', () => {
    expect(vapidKeysFrom(keys.privateKey, 'mailto:x@y.z').publicKey).toBe(keys.publicKey);
  });
});

describe('browsers subscribing', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let deps: JobDeps;
  beforeAll(async () => {
    t = await createTestApp();
    deps = {
      pool: t.pool,
      redis: t.redis,
      clock: t.clock,
      events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
      log: t.app.log,
    };
  });
  afterAll(() => t.close());

  const subscribe = (access: string, subscription: object, browserName = 'chrome_android') =>
    t.app.inject({
      method: 'POST',
      url: '/v1/me/devices',
      headers: bearer(access),
      payload: { platform: 'web', subscription, browser: browserName },
    });

  it('gives browsers the key to subscribe with', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/push/web-key' });
    expect(res.json<WebPushKeyResponse>()).toEqual({ public_key: t.config.webPush!.publicKey });
  });

  it('keeps a subscription at a push service, refuses anywhere else, and forgets it', async () => {
    const guest = await signInGuest(t.app);
    const tab = browser();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${guest.user.id}`;
    const res = await subscribe(guest.access, { endpoint, expirationTime: null, keys: tab.keys });
    expect(res.statusCode, res.body).toBe(204);
    const row = await t.pool.query('SELECT platform, web_keys, browser FROM devices WHERE push_token = $1', [
      endpoint,
    ]);
    expect(row.rows).toEqual([{ platform: 'web', web_keys: tab.keys, browser: 'chrome_android' }]);

    for (const bad of ['https://internal.example/hook', 'http://fcm.googleapis.com/fcm/send/x']) {
      const refused = await subscribe(guest.access, { endpoint: bad, keys: tab.keys });
      expect([refused.statusCode, refused.json().code], bad).toEqual([400, 'VALIDATION_FAILED']);
    }
    const shortKeys = await subscribe(guest.access, { endpoint, keys: { p256dh: 'abc', auth: 'abc' } });
    expect(shortKeys.statusCode).toBe(400);

    const forget = await t.app.inject({
      method: 'DELETE',
      url: '/v1/me/devices',
      headers: bearer(guest.access),
      payload: { push_token: endpoint },
    });
    expect(forget.statusCode).toBe(204);
    const after = await t.pool.query('SELECT push_token FROM devices WHERE push_token = $1', [endpoint]);
    expect(after.rows).toEqual([]);
  });

  it('reaches the browser through the push job, next to the Android phone', async () => {
    const guest = await signInGuest(t.app);
    const tab = browser();
    const endpoint = `https://updates.push.services.mozilla.com/wpush/v2/${guest.user.id}`;
    await subscribe(guest.access, { endpoint, keys: tab.keys }, 'firefox_desktop');
    await queuePush(t.pool, {
      userId: guest.user.id,
      params: { type: 'your_turn', duel_id: 'd_web', kind: 'turn', opponent: 'chidi' },
      collapseKey: 'duel:d_web',
      expiresAt: t.clock.now() + 3_600_000,
      now: t.clock.now(),
    });
    const web = new TestTransport();
    const android = new TestTransport();
    await sendDuePushes(deps, new PushRouter({ web, android }, new TestTransport()));
    expect(android.sent).toEqual([]);
    expect(web.sent).toEqual([
      {
        device: expect.objectContaining({ platform: 'web', token: endpoint, keys: tab.keys }),
        push: expect.objectContaining({ type: 'your_turn', url: '/duel/d_web' }),
      },
    ]);
  });
});
