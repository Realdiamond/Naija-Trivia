import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Me, Platform, SignInResponse } from '@whosabi/shared-types';
import { pseudonymousId } from '@whosabi/analytics/server';
import { checkUsername } from '../src/profile/usernames';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

/** A full account (Google sign-in), optionally from a guest session. */
async function signUp(platform: Platform = 'android', guestAccess?: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/google',
    headers: guestAccess ? bearer(guestAccess) : {},
    payload: { id_token: await t.signGoogle({ sub: `g-${randomInt(1e12)}` }), platform },
  });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json() as SignInResponse;
}

const patchMe = (access: string, payload: object) =>
  t.app.inject({ method: 'PATCH', url: '/v1/me', headers: bearer(access), payload });
const setAge = (access: string, band: string) =>
  t.app.inject({ method: 'POST', url: '/v1/me/age', headers: bearer(access), payload: { age_band: band } });
const uniqueName = (prefix: string) => `${prefix}_${randomInt(1e6)}`;

describe('usernames', () => {
  it('allows ordinary names, including ones that only contain a blocked word', () => {
    for (const name of [
      'tolu_99',
      'Chidi',
      'classic_kid',
      'peacock',
      'Dickson',
      'Nazir',
      'therapist',
      'mumu_king',
    ]) {
      expect(checkUsername(name), name).toEqual({ ok: true });
    }
  });

  it('refuses offensive names, look-alike spellings and official-looking names', () => {
    for (const name of ['fuck_u', 'sh1tlord', 'fuuuck', 'b1tch', 'big_ass', 'ashawo_queen', 'Shege']) {
      expect(checkUsername(name), name).toEqual({ ok: false, reason: 'offensive' });
    }
    for (const name of ['admin', 'Admin_01', 'support_team', 'whosabi_ng', 'the_whosabi', 'official_tolu']) {
      expect(checkUsername(name), name).toEqual({ ok: false, reason: 'reserved' });
    }
  });
});

describe('me', () => {
  it('lets the web app send profile edits across origins (CORS preflight)', async () => {
    const res = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/me',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  });

  it('shows the profile, level progress and rating tier', async () => {
    const guest = await signInGuest(t.app);
    const me = (
      await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(guest.access) })
    ).json() as Me;
    expect(me).toMatchObject({
      id: guest.user.id,
      status: 'guest',
      username: null,
      language: 'en',
      data_saver: false,
      family_mode: false,
      discoverable: true,
      age_band: null,
      level: 1,
      xp: 0,
      xp_into_level: 0,
      xp_for_next_level: 200,
      rating: 1500,
      tier: { id: 'sharp' },
    });
  });

  it('lets guests change settings, but only accounts pick a username', async () => {
    const guest = await signInGuest(t.app);
    const settings = await patchMe(guest.access, { data_saver: true, home_state: 'LA', language: 'pcm' });
    expect(settings.json()).toMatchObject({ data_saver: true, home_state: 'LA', language: 'pcm' });
    expect((await patchMe(guest.access, { username: uniqueName('guest') })).json().code).toBe(
      'ACCOUNT_REQUIRED',
    );
    expect((await patchMe(guest.access, { home_state: null })).json().home_state).toBeNull();
    expect((await patchMe(guest.access, { home_state: 'XX' })).json().code).toBe('VALIDATION_FAILED');
    expect((await patchMe(guest.access, { level: 99 })).json().code).toBe('VALIDATION_FAILED');
  });

  it('sets a username once, unique regardless of case, and filtered', async () => {
    const tolu = await signUp();
    const name = uniqueName('Tolu');
    expect((await patchMe(tolu.access, { username: name, avatar_id: 'av_ankara_1' })).json()).toMatchObject({
      username: name,
      avatar_id: 'av_ankara_1',
    });
    expect((await patchMe(tolu.access, { username: name })).statusCode).toBe(200);
    expect((await patchMe(tolu.access, { username: uniqueName('Tolu') })).json().code).toBe(
      'USERNAME_LOCKED',
    );

    const other = await signUp();
    expect((await patchMe(other.access, { username: name.toUpperCase() })).json().code).toBe(
      'USERNAME_TAKEN',
    );
    expect((await patchMe(other.access, { username: 'sh1t_head' })).json().code).toBe('USERNAME_NOT_ALLOWED');
    expect((await patchMe(other.access, { username: 'ab' })).json().code).toBe('VALIDATION_FAILED');
    expect((await patchMe(other.access, { username: '12345' })).json().code).toBe('VALIDATION_FAILED');

    const card = await t.app.inject({ method: 'GET', url: `/v1/users/${name.toLowerCase()}` });
    expect(card.json()).toEqual({
      id: tolu.user.id,
      username: name,
      avatar_id: 'av_ankara_1',
      level: 1,
      tier: { id: 'sharp', name: 'Sharp Guy / Sharp Babe', badge: '⚡' },
    });
    expect((await t.app.inject({ method: 'GET', url: '/v1/users/nobody_here_123' })).statusCode).toBe(404);
  });
});

describe('consents (doc 10 §2)', () => {
  const postConsents = (access: string | null, payload: object) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/me/consents',
      headers: access ? bearer(access) : {},
      payload,
    });

  it('keeps every choice as a record and reports the change', async () => {
    const guest = await signInGuest(t.app);
    const banner = {
      source: 'web_banner',
      consents: [{ purpose: 'analytics', granted: true, policy_version: '2026-10' }],
    };
    expect((await postConsents(guest.access, banner)).statusCode).toBe(204);
    const changed = {
      source: 'settings',
      consents: [{ purpose: 'analytics', granted: false, policy_version: '2026-10' }],
    };
    expect((await postConsents(guest.access, changed)).statusCode).toBe(204);

    const rows = await t.pool.query(
      'SELECT purpose, granted, policy_version, source FROM consent_records WHERE user_id = $1 ORDER BY id',
      [guest.user.id],
    );
    expect(rows.rows).toEqual([
      { purpose: 'analytics', granted: true, policy_version: '2026-10', source: 'web_banner' },
      { purpose: 'analytics', granted: false, policy_version: '2026-10', source: 'settings' },
    ]);

    const pid = pseudonymousId(guest.user.id, t.config.analyticsKey);
    const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
    const events = entries
      .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
      .filter((row) => row.user_pid === pid && row.event === 'consent_changed')
      .map((row) => JSON.parse(row.props as string));
    expect(events).toEqual([
      { purpose: 'analytics', granted: true },
      { purpose: 'analytics', granted: false },
    ]);
  });

  it('refuses unknown purposes and anonymous requests', async () => {
    const guest = await signInGuest(t.app);
    const unknown = {
      source: 'settings',
      consents: [{ purpose: 'selling_data', granted: true, policy_version: '1' }],
    };
    expect((await postConsents(guest.access, unknown)).statusCode).toBe(400);
    const valid = {
      source: 'settings',
      consents: [{ purpose: 'analytics', granted: true, policy_version: '1' }],
    };
    expect((await postConsents(null, valid)).statusCode).toBe(401);
  });
});

describe('the age gate (doc 10 §3.3)', () => {
  it('refuses under-13s and asks only once', async () => {
    const account = await signUp();
    expect((await setAge(account.access, 'under_13')).json().code).toBe('AGE_NOT_ALLOWED');
    expect((await setAge(account.access, '18_plus')).json()).toMatchObject({
      age_band: '18_plus',
      status: 'active',
    });
    expect((await setAge(account.access, '13_17')).json().code).toBe('AGE_ALREADY_SET');
  });

  it('gives 13–17s a restricted account: family-safe, and not found through contacts', async () => {
    const teen = await signUp();
    const me = (await setAge(teen.access, '13_17')).json() as Me;
    expect(me).toMatchObject({
      status: 'restricted',
      age_band: '13_17',
      family_mode: true,
      discoverable: false,
    });
    expect((await patchMe(teen.access, { family_mode: false })).statusCode).toBe(403);
    expect((await patchMe(teen.access, { discoverable: true })).statusCode).toBe(403);
    expect((await patchMe(teen.access, { username: uniqueName('teen') })).statusCode).toBe(200);
  });

  it('keeps the answer a guest gave when they sign up', async () => {
    const guest = await signInGuest(t.app);
    expect((await setAge(guest.access, '13_17')).json()).toMatchObject({
      status: 'guest',
      age_band: '13_17',
    });
    const account = await signUp('android', guest.access);
    expect(account.user).toMatchObject({ id: guest.user.id, status: 'restricted' });
  });
});
