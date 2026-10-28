import { describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@whosabi/shared-types';
import { ApiClient, ApiError, type Session, type TokenStore } from './client';

const user = { id: 'u_1', username: null, status: 'guest' as const, level: 1, xp: 0 };

function auth(access: string, refresh?: string): AuthResponse {
  return { access, access_expires_in: 900, user, ...(refresh ? { refresh } : {}) };
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake API: `routes` answers by "METHOD /path"; every call is recorded. */
function setup(options: { inBody?: boolean; stored?: string | null } = {}) {
  const calls: Call[] = [];
  const routes = new Map<string, (call: Call) => Response>();
  const store = { value: options.stored ?? null };
  const tokens: TokenStore = {
    inBody: options.inBody ?? true,
    get: async () => store.value,
    set: async (token) => {
      if (token) store.value = token;
    },
    clear: async () => {
      store.value = null;
    },
  };
  let now = 1_000_000;
  const sessions: Array<Session | null> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      path: url.pathname,
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = routes.get(`${call.method} ${call.path}`);
    if (!handler) throw new TypeError('Failed to fetch');
    return handler(call);
  });
  const client = new ApiClient({
    baseUrl: 'https://api.test',
    platform: 'android',
    appVersion: '1.2.3',
    refreshToken: tokens,
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => now,
    sessionId: () => 'sess-1',
    onSession: (s) => sessions.push(s),
  });
  return {
    client,
    calls,
    routes,
    store,
    sessions,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ApiClient', () => {
  it('signs in as a guest and sends the token and context headers afterwards', async () => {
    const t = setup();
    t.routes.set('POST /v1/auth/guest', () => json(201, auth('access-1', 'refresh-1-xxxxxxxxxxxxxxxx')));
    t.routes.set('GET /v1/me', () => json(200, { id: 'u_1' }));

    await t.client.signInGuest('device-abc');
    expect(t.calls[0]?.body).toEqual({ device_id: 'device-abc', platform: 'android' });
    expect(t.calls[0]?.headers.authorization).toBeUndefined();
    expect(t.store.value).toBe('refresh-1-xxxxxxxxxxxxxxxx');

    await t.client.get('/v1/me');
    expect(t.calls[1]?.headers).toMatchObject({
      authorization: 'Bearer access-1',
      'x-platform': 'android',
      'x-app-version': '1.2.3',
      'x-session-id': 'sess-1',
      'x-requested-with': 'whosabi',
    });
    expect(t.calls[1]?.headers['content-type']).toBeUndefined();
  });

  it('renews an expired access token once and retries the request', async () => {
    const t = setup({ stored: 'refresh-old-xxxxxxxxxxxxxx' });
    let meCalls = 0;
    t.routes.set('POST /v1/auth/refresh', () => json(200, auth('access-new', 'refresh-new-xxxxxxxxxxxxxx')));
    t.routes.set('GET /v1/me', (call) => {
      meCalls++;
      return call.headers.authorization === 'Bearer access-new' ? json(200, { ok: true }) : json(401, {});
    });
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-stale')));
    await t.client.signInGuest('device-abc');

    await expect(t.client.get('/v1/me')).resolves.toEqual({ ok: true });
    expect(meCalls).toBe(2);
    const refresh = t.calls.find((c) => c.path === '/v1/auth/refresh');
    expect(refresh?.body).toEqual({ refresh: 'refresh-old-xxxxxxxxxxxxxx' });
    expect(refresh?.headers.authorization).toBeUndefined();
    expect(t.store.value).toBe('refresh-new-xxxxxxxxxxxxxx');
  });

  it('shares one refresh between requests that fail together (the server rotates the token)', async () => {
    const t = setup({ stored: 'refresh-old-xxxxxxxxxxxxxx' });
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-stale')));
    t.routes.set('POST /v1/auth/refresh', () => json(200, auth('access-new', 'refresh-new-xxxxxxxxxxxxxx')));
    t.routes.set('GET /v1/me', (call) =>
      call.headers.authorization === 'Bearer access-new' ? json(200, {}) : json(401, {}),
    );
    t.routes.set('GET /v1/duels', (call) =>
      call.headers.authorization === 'Bearer access-new' ? json(200, {}) : json(401, {}),
    );
    await t.client.signInGuest('device-abc');

    await Promise.all([t.client.get('/v1/me'), t.client.get('/v1/duels')]);
    expect(t.calls.filter((c) => c.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('renews ahead of time when the access token is about to run out', async () => {
    const t = setup({ stored: 'refresh-old-xxxxxxxxxxxxxx' });
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-1')));
    t.routes.set('POST /v1/auth/refresh', () => json(200, auth('access-2', 'refresh-new-xxxxxxxxxxxxxx')));
    t.routes.set('GET /v1/me', () => json(200, {}));
    await t.client.signInGuest('device-abc');

    t.advance(880_000); // 20 s left of 15 minutes
    await t.client.get('/v1/me');
    expect(t.calls.map((c) => c.path)).toEqual(['/v1/auth/guest', '/v1/auth/refresh', '/v1/me']);
    expect(t.calls[2]?.headers.authorization).toBe('Bearer access-2');
  });

  it('signs out when the refresh token is refused, and the request fails as unauthorised', async () => {
    const t = setup({ stored: 'refresh-old-xxxxxxxxxxxxxx' });
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-1')));
    t.routes.set('POST /v1/auth/refresh', () =>
      json(401, { code: 'REFRESH_TOKEN_REUSED', title: 'Please sign in again' }),
    );
    t.routes.set('GET /v1/me', () => json(401, { code: 'UNAUTHORIZED', title: 'Sign in' }));
    await t.client.signInGuest('device-abc');

    await expect(t.client.get('/v1/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(t.client.current).toBeNull();
    expect(t.store.value).toBeNull();
    expect(t.sessions.at(-1)).toBeNull();
  });

  it('with no stored refresh token on a phone, restoring is a sign-out without a request', async () => {
    const t = setup({ stored: null });
    await expect(t.client.refresh()).resolves.toBeNull();
    expect(t.calls).toHaveLength(0);
  });

  it('on the web, refreshes from the cookie: no body, and credentials included', async () => {
    const t = setup({ inBody: false });
    t.routes.set('POST /v1/auth/refresh', () => json(200, auth('access-web')));
    const session = await t.client.refresh();
    expect(session?.access).toBe('access-web');
    expect(t.calls[0]?.body).toBeUndefined();
    expect(t.calls[0]?.headers['content-type']).toBeUndefined();
  });

  it('turns problem+json into an ApiError with the code and detail', async () => {
    const t = setup();
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-1')));
    t.routes.set('PATCH /v1/me', () =>
      json(409, { code: 'USERNAME_TAKEN', title: 'That username is taken', detail: 'Try another one.' }),
    );
    await t.client.signInGuest('device-abc');

    const error = await t.client.patch('/v1/me', { username: 'tolu' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'USERNAME_TAKEN', detail: 'Try another one.' });
    expect(t.calls[1]?.headers['content-type']).toBe('application/json');
  });

  it('lets network failures through as they are, so the app can say it is offline', async () => {
    const t = setup();
    await expect(t.client.methods()).rejects.toBeInstanceOf(TypeError);
  });

  it('fetches a share picture with the token, renewing it like any other call', async () => {
    const t = setup({ stored: 'refresh-old-xxxxxxxxxxxxxx' });
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-stale')));
    t.routes.set('POST /v1/auth/refresh', () => json(200, auth('access-new', 'refresh-new-xxxxxxxxxxxxxx')));
    t.routes.set('GET /v1/share/duels/d_1/card.png', (call) =>
      call.headers.authorization === 'Bearer access-new'
        ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
        : json(401, {}),
    );
    t.routes.set('GET /v1/share/duels/d_2/card.png', () =>
      json(409, { code: 'CONFLICT', title: 'This duel is not over', detail: 'Share it once it ends.' }),
    );
    await t.client.signInGuest('device-abc');

    const picture = await t.client.blob('/v1/share/duels/d_1/card.png');
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(t.calls.at(-1)?.headers.accept).toBe('image/png');
    await expect(t.client.blob('/v1/share/duels/d_2/card.png')).rejects.toMatchObject({
      status: 409,
      detail: 'Share it once it ends.',
    });
  });

  it('gives a phone download a fresh token and the context headers', async () => {
    const t = setup({ stored: 'refresh-old-xxxxxxxxxxxxxx' });
    t.routes.set('POST /v1/auth/guest', () => json(200, auth('access-1')));
    t.routes.set('POST /v1/auth/refresh', () => json(200, auth('access-2', 'refresh-new-xxxxxxxxxxxxxx')));
    await t.client.signInGuest('device-abc');

    expect(await t.client.fileRequest('/v1/share/daily/7/card.png')).toEqual({
      url: 'https://api.test/v1/share/daily/7/card.png',
      headers: expect.objectContaining({ authorization: 'Bearer access-1', accept: 'image/png' }),
    });
    t.advance(899_000);
    const later = await t.client.fileRequest('/v1/share/daily/7/card.png');
    expect(later.headers.authorization).toBe('Bearer access-2');

    const signedOut = setup();
    await expect(signedOut.client.fileRequest('/v1/share/daily/7/card.png')).rejects.toMatchObject({
      status: 401,
    });
  });
});
