import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, newDeviceId, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const cookieFrom = (setCookie: string | string[] | undefined) => {
  const header = Array.isArray(setCookie) ? setCookie.join('\n') : (setCookie ?? '');
  return /ws_rt=([^;]+)/.exec(header)?.[1];
};

describe('guest sign-in', () => {
  it('creates one guest per device and gives apps the refresh token in the body', async () => {
    const deviceId = newDeviceId();
    const first = await signInGuest(t.app, 'android', deviceId);
    expect(first.response.statusCode).toBe(201);
    expect(first.user).toMatchObject({ status: 'guest', username: null, level: 1, xp: 0 });
    expect(first.refresh).toMatch(/^[\w-]{43}$/);
    expect(first.response.headers['set-cookie']).toBeUndefined();

    const again = await signInGuest(t.app, 'android', deviceId);
    expect(again.response.statusCode).toBe(200);
    expect(again.user.id).toBe(first.user.id);
  });

  it('keeps the web refresh token in an HttpOnly cookie that JavaScript never sees', async () => {
    const web = await signInGuest(t.app, 'web');
    expect(web.refresh).toBeUndefined();
    const cookie = String(web.response.headers['set-cookie']);
    expect(cookie).toMatch(/ws_rt=[\w-]{43}/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/v1/auth');
  });

  it('answers bad input with problem+json', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { device_id: 'short', platform: 'web' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      type: expect.stringContaining('validation-failed'),
    });
  });

  it('refuses guest sign-in once the device belongs to a full account', async () => {
    const guest = await signInGuest(t.app);
    await t.pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [guest.user.id]);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { device_id: guest.deviceId, platform: 'android' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and ends the whole session when an old one comes back', async () => {
    const guest = await signInGuest(t.app);
    const refresh = (token: string) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh: token } });

    const rotated = await refresh(guest.refresh!);
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json().refresh as string;
    expect(next).not.toBe(guest.refresh);

    const replay = await refresh(guest.refresh!);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('REFRESH_TOKEN_REUSED');
    expect((await refresh(next)).statusCode).toBe(401);
  });

  it('refreshes a web session from the cookie only for requests from our own web app', async () => {
    const web = await signInGuest(t.app, 'web');
    const cookie = cookieFrom(web.response.headers['set-cookie'])!;
    const attempt = (headers: Record<string, string>) =>
      t.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { ws_rt: cookie }, headers });

    expect((await attempt({})).statusCode).toBe(403);
    expect(
      (await attempt({ 'x-requested-with': 'whosabi', origin: 'https://evil.example' })).statusCode,
    ).toBe(403);
    const ok = await attempt({ 'x-requested-with': 'whosabi', origin: 'http://localhost:8081' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().refresh).toBeUndefined();
    expect(cookieFrom(ok.headers['set-cookie'])).not.toBe(cookie);
  });

  it('signs out everywhere the session family reached', async () => {
    const guest = await signInGuest(t.app);
    const out = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh: guest.refresh },
    });
    expect(out.statusCode).toBe(204);
    const after = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh: guest.refresh },
    });
    expect(after.statusCode).toBe(401);
  });

  it('requires a valid, unexpired access token', async () => {
    const guest = await signInGuest(t.app);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer('nonsense') })).statusCode,
    ).toBe(401);
    const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(guest.access) });
    expect(me.json()).toMatchObject({ id: guest.user.id, status: 'guest' });

    t.clock.advance(16 * 60_000);
    const expired = await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(guest.access) });
    expect(expired.statusCode).toBe(401);
  });
});

describe('signing keys', () => {
  it('publishes the public key set that verifies access tokens', async () => {
    const { createLocalJWKSet, jwtVerify } = await import('jose');
    const res = await t.app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const jwks = res.json();
    expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(jwks.keys[0].d).toBeUndefined();
    const guest = await signInGuest(t.app);
    const { payload } = await jwtVerify(guest.access, createLocalJWKSet(jwks), {
      issuer: 'whosabi-api',
      audience: 'whosabi',
      currentDate: new Date(t.clock.now()),
    });
    expect(payload.sub).toBe(guest.user.id);
  });
});

describe('rate limits', () => {
  it('limits guest sign-ups per IP address', async () => {
    const limited = await createTestApp({ GUEST_SIGNUPS_PER_IP_PER_HOUR: '2' });
    try {
      const signUp = () =>
        limited.app.inject({
          method: 'POST',
          url: '/v1/auth/guest',
          remoteAddress: '10.9.8.7',
          payload: { device_id: newDeviceId(), platform: 'web' },
        });
      expect((await signUp()).statusCode).toBe(201);
      expect((await signUp()).statusCode).toBe(201);
      const third = await signUp();
      expect(third.statusCode).toBe(429);
      expect(third.json().code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
