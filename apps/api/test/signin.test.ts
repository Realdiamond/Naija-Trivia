import { createHash, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { CreateDuelResponse, ListDuelsResponse, Platform, SignInResponse } from '@whosabi/shared-types';
import { bearer, createTestApp, signInGuest, TEST_GOOGLE_CLIENT } from './helpers';

const APP_HASH = 'FA+9qCX9VSu';
const DAY = 86_400_000;

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp({ SMS_RETRIEVER_APP_HASH: APP_HASH, OTP_SENDS_PER_IP_PER_HOUR: '10000' });
});
afterAll(() => t.close());

/** A fresh Nigerian number: as typed, and in E.164. */
function newPhone() {
  const rest = String(randomInt(0, 10_000_000)).padStart(7, '0');
  return { typed: `0803 ${rest.slice(0, 3)} ${rest.slice(3)}`, e164: `+234803${rest}` };
}

function sendCode(
  phone: string,
  platform: Platform = 'android',
  options: { access?: string; turnstile?: string } = {},
) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/send',
    headers: options.access ? bearer(options.access) : {},
    payload: { phone, platform, ...(options.turnstile ? { turnstile_token: options.turnstile } : {}) },
  });
}

function verifyCode(
  requestId: string,
  code: string,
  options: { access?: string; mergeGuest?: boolean } = {},
) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    headers: options.access ? bearer(options.access) : {},
    payload: { request_id: requestId, code, ...(options.mergeGuest === false ? { merge_guest: false } : {}) },
  });
}

/** Send a code to a new number and sign in with it. */
async function phoneSignIn(phone = newPhone(), access?: string) {
  const sent = await sendCode(phone.typed, 'android', { access });
  expect(sent.statusCode, sent.body).toBe(200);
  const res = await verifyCode(sent.json().request_id, t.sms.codeFor(phone.e164), { access });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return { ...(res.json() as SignInResponse), phone, response: res };
}

async function eventsOf(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid)
    .map((row) => ({ event: row.event as string, props: JSON.parse(row.props as string) }));
}

describe('phone sign-in', () => {
  it('signs up with a 6-digit code, sent in the format each platform needs', async () => {
    const phone = newPhone();
    const sent = await sendCode(phone.typed, 'android');
    expect(sent.json()).toMatchObject({ request_id: expect.stringMatching(/^otp_/), resend_after_s: 30 });
    const sms = t.sms.outbox.at(-1)!;
    expect(sms.to).toBe(phone.e164);
    expect(sms.text).toMatch(/^Your Who Sabi\? code is \d{6}\. It expires in 5 minutes\./);
    expect(sms.text.endsWith(`\n${APP_HASH}`)).toBe(true);

    const res = await verifyCode(sent.json().request_id, t.sms.codeFor(phone.e164));
    expect(res.statusCode).toBe(201);
    const body = res.json() as SignInResponse;
    expect(body).toMatchObject({
      is_new: true,
      merged_guest: false,
      user: { status: 'active', username: null },
    });
    expect(body.refresh).toMatch(/^[\w-]{43}$/);

    const identity = await t.pool.query(
      "SELECT subject, phone_hash, verified_at FROM auth_identities WHERE user_id = $1 AND provider = 'phone'",
      [body.user.id],
    );
    expect(identity.rows[0]).toMatchObject({ subject: phone.e164 });
    expect(identity.rows[0].phone_hash).toEqual(createHash('sha256').update(phone.e164).digest());

    // Signing in again (after the 30 s resend wait) finds the same account.
    t.clock.advance(31_000);
    expect((await phoneSignIn(phone)).user.id).toBe(body.user.id);

    // The web adds the WebOTP line; iOS gets the plain text.
    const web = newPhone();
    expect((await sendCode(web.typed, 'web', { turnstile: 'human' })).statusCode).toBe(200);
    const webCode = t.sms.codeFor(web.e164);
    expect(t.sms.outbox.at(-1)!.text.endsWith(`\n\n@whosabi.ng #${webCode}`)).toBe(true);
    const ios = newPhone();
    await sendCode(ios.typed, 'ios');
    expect(t.sms.outbox.at(-1)!.text).not.toContain('\n');
  });

  it('accepts only Nigerian mobile numbers', async () => {
    for (const phone of ['+44 7700 900123', '01 234 5678', '0803 123']) {
      const res = await sendCode(phone);
      expect([res.statusCode, res.json().code]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('gives 5 tries per code, works once, expires after 5 minutes and retires older codes', async () => {
    const phone = newPhone();
    const first = (await sendCode(phone.typed)).json().request_id as string;
    const right = t.sms.codeFor(phone.e164);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let tries = 1; tries <= 4; tries++) {
      const res = await verifyCode(first, wrong);
      expect(res.json()).toMatchObject({
        code: 'OTP_INVALID',
        detail: `${5 - tries} ${5 - tries === 1 ? 'try' : 'tries'} left.`,
      });
    }
    expect((await verifyCode(first, wrong)).json().code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect((await verifyCode(first, right)).json().code).toBe('OTP_EXPIRED');

    t.clock.advance(31_000);
    const second = (await sendCode(phone.typed)).json().request_id as string;
    const secondCode = t.sms.codeFor(phone.e164);
    t.clock.advance(31_000);
    const third = (await sendCode(phone.typed, 'android', { turnstile: 'human' })).json()
      .request_id as string;
    expect((await verifyCode(second, secondCode)).json()).toMatchObject({
      code: 'OTP_EXPIRED',
      detail: 'A newer code was sent. Use the latest one.',
    });
    const thirdCode = t.sms.codeFor(phone.e164);
    expect((await verifyCode(third, thirdCode)).statusCode).toBe(201);
    expect((await verifyCode(third, thirdCode)).json().code).toBe('OTP_EXPIRED');

    const late = newPhone();
    const lateId = (await sendCode(late.typed)).json().request_id as string;
    t.clock.advance(5 * 60_000 + 1000);
    expect((await verifyCode(lateId, t.sms.codeFor(late.e164))).json().code).toBe('OTP_EXPIRED');
  });

  it('paces codes, caps them at 5 a day, and asks for a human check from the third', async () => {
    const phone = newPhone();
    expect((await sendCode(phone.typed)).statusCode).toBe(200);
    const tooSoon = await sendCode(phone.typed);
    expect([tooSoon.statusCode, tooSoon.json().code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(tooSoon.headers['retry-after'])).toBe(30);

    t.clock.advance(31_000);
    expect((await sendCode(phone.typed)).statusCode).toBe(200);
    t.clock.advance(31_000);
    expect((await sendCode(phone.typed)).json().code).toBe('CAPTCHA_REQUIRED');
    expect((await sendCode(phone.typed, 'android', { turnstile: 'robot' })).json().code).toBe(
      'CAPTCHA_FAILED',
    );
    for (let n = 3; n <= 5; n++) {
      expect((await sendCode(phone.typed, 'android', { turnstile: 'human' })).statusCode).toBe(200);
      t.clock.advance(31_000);
    }
    const sixth = await sendCode(phone.typed, 'android', { turnstile: 'human' });
    expect([sixth.statusCode, sixth.json().code]).toEqual([429, 'OTP_LIMIT_REACHED']);

    // The count starts again on the next day in WAT.
    t.clock.advance(DAY);
    expect((await sendCode(phone.typed)).statusCode).toBe(200);
    // The web always needs the human check.
    expect((await sendCode(newPhone().typed, 'web')).json().code).toBe('CAPTCHA_REQUIRED');
  });

  it("doesn't count a code the SMS providers could not send", async () => {
    const phone = newPhone();
    t.sms.down = true;
    try {
      const res = await sendCode(phone.typed);
      expect([res.statusCode, res.json().code]).toEqual([503, 'PROVIDER_UNAVAILABLE']);
    } finally {
      t.sms.down = false;
    }
    // No wait and no CAPTCHA: the failed attempt left nothing behind.
    expect((await sendCode(phone.typed)).statusCode).toBe(200);
    t.clock.advance(31_000);
    expect((await sendCode(phone.typed)).statusCode).toBe(200);
  });
});

describe("keeping a guest's progress (FR-AUTH-4)", () => {
  it('turns the guest into the account when they sign up', async () => {
    const guest = await signInGuest(t.app, 'android');
    const duel = await t.app.inject({
      method: 'POST',
      url: '/v1/duels',
      headers: bearer(guest.access),
      payload: { opponent: { link: true } },
    });
    expect(duel.statusCode).toBe(201);

    const signedUp = await phoneSignIn(newPhone(), guest.access);
    expect(signedUp).toMatchObject({
      is_new: true,
      merged_guest: true,
      user: { id: guest.user.id, status: 'active' },
    });
    const mine = (
      await t.app.inject({ method: 'GET', url: '/v1/duels', headers: bearer(signedUp.access) })
    ).json() as ListDuelsResponse;
    expect(mine.duels.map((d) => d.id)).toEqual([(duel.json() as CreateDuelResponse).duel.id]);

    // The device now belongs to the account; the old guest session is over.
    expect(
      (await signInGuest(t.app, 'android', guest.deviceId).catch((e: Error) => e.message)).toString(),
    ).toContain('409');
    const oldRefresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh: guest.refresh },
    });
    expect(oldRefresh.statusCode).toBe(401);
    expect((await eventsOf(guest.user.id)).find((e) => e.event === 'signup_completed')!.props).toEqual({
      method: 'phone',
      merged_guest: true,
    });
  });

  it('moves a guest into the existing account they sign in to, and retires the guest', async () => {
    const account = await phoneSignIn();
    const friend = await signInGuest(t.app);
    const guest = await signInGuest(t.app, 'web');
    await t.pool.query('UPDATE users SET xp = 120 WHERE id = $1', [guest.user.id]);
    const challenge = (opponent: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/duels',
        headers: bearer(guest.access),
        payload: { opponent: { user_id: opponent } },
      });
    const withFriend = (await challenge(friend.user.id)).json() as CreateDuelResponse;
    const withSelf = (await challenge(account.user.id)).json() as CreateDuelResponse;

    // Same number, now from the guest's browser: the guest's progress goes to the account.
    t.clock.advance(31_000);
    const sent = await sendCode(account.phone.typed, 'web', { access: guest.access, turnstile: 'human' });
    expect(sent.statusCode, sent.body).toBe(200);
    const res = await verifyCode(sent.json().request_id, t.sms.codeFor(account.phone.e164), {
      access: guest.access,
    });
    expect(res.statusCode, res.body).toBe(200);
    const merged = res.json() as SignInResponse;
    expect(merged).toMatchObject({
      is_new: false,
      merged_guest: true,
      user: { id: account.user.id, xp: 120 },
    });
    expect(merged.refresh).toBeUndefined(); // the web gets a cookie

    const duels = await t.pool.query<{ id: string; player_a: string; state: string }>(
      'SELECT id, player_a, state FROM duels WHERE id = ANY($1)',
      [[withFriend.duel.id, withSelf.duel.id]],
    );
    const byId = new Map(duels.rows.map((d) => [d.id, d]));
    expect(byId.get(withFriend.duel.id)).toMatchObject({ player_a: account.user.id, state: 'created' });
    // A duel against yourself makes no sense, so it is cancelled rather than moved.
    expect(byId.get(withSelf.duel.id)).toMatchObject({ player_a: guest.user.id, state: 'cancelled' });

    const retired = await t.pool.query('SELECT status, deleted_at FROM users WHERE id = $1', [guest.user.id]);
    expect(retired.rows[0].status).toBe('deleted');
    const link = await t.pool.query('SELECT into_user_id FROM user_merges WHERE guest_id = $1', [
      guest.user.id,
    ]);
    expect(link.rows[0].into_user_id).toBe(account.user.id);
    expect(
      (await signInGuest(t.app, 'web', guest.deviceId).catch((e: Error) => e.message)).toString(),
    ).toContain('409');
  });

  it('refuses an expired session rather than signing in without the guest, and the code still works', async () => {
    const guest = await signInGuest(t.app);
    // The guest's 15-minute access token runs out while the code is still fresh.
    t.clock.advance(16 * 60_000);
    const phone = newPhone();
    const sent = (await sendCode(phone.typed)).json().request_id as string;
    const stale = await verifyCode(sent, t.sms.codeFor(phone.e164), { access: guest.access });
    expect(stale.statusCode).toBe(401);

    const refreshed = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh: guest.refresh },
    });
    const fresh = refreshed.json().access as string;
    const ok = await verifyCode(sent, t.sms.codeFor(phone.e164), { access: fresh });
    expect(ok.json()).toMatchObject({ merged_guest: true, user: { id: guest.user.id } });
  });

  it('can sign in without keeping the guest when asked', async () => {
    const guest = await signInGuest(t.app);
    const phone = newPhone();
    const sent = (await sendCode(phone.typed, 'android', { access: guest.access })).json()
      .request_id as string;
    const res = await verifyCode(sent, t.sms.codeFor(phone.e164), {
      access: guest.access,
      mergeGuest: false,
    });
    expect(res.json()).toMatchObject({ is_new: true, merged_guest: false });
    expect((res.json() as SignInResponse).user.id).not.toBe(guest.user.id);
  });
});

describe('Google and Apple sign-in', () => {
  it('signs up with Google, signs in again, and refuses tokens meant for someone else', async () => {
    const sub = `g-${randomInt(1e9)}`;
    const signIn = async (token: string, platform: Platform = 'android') =>
      t.app.inject({ method: 'POST', url: '/v1/auth/google', payload: { id_token: token, platform } });
    const first = await signIn(await t.signGoogle({ sub }));
    expect(first.statusCode).toBe(201);
    const again = await signIn(await t.signGoogle({ sub }), 'web');
    expect(again.statusCode).toBe(200);
    expect(again.json().user.id).toBe(first.json().user.id);

    for (const token of [
      await t.signGoogle({ sub }, { audience: 'someone-else.apps.googleusercontent.com' }),
      await t.signGoogle({ sub }, { expiresInS: -60 }),
      'this-is-not-a-real-id-token-at-all',
    ]) {
      const res = await signIn(token);
      expect([res.statusCode, res.json().code]).toEqual([401, 'ID_TOKEN_INVALID']);
    }
    expect(TEST_GOOGLE_CLIENT).toContain('googleusercontent');
  });

  it('links Google to the account that is signed in (FR-AUTH-8)', async () => {
    const account = await phoneSignIn();
    const sub = `g-${randomInt(1e9)}`;
    const linked = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: bearer(account.access),
      payload: { id_token: await t.signGoogle({ sub }), platform: 'ios' },
    });
    expect(linked.json()).toMatchObject({
      is_new: false,
      merged_guest: false,
      user: { id: account.user.id },
    });
    const later = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      payload: { id_token: await t.signGoogle({ sub }), platform: 'ios' },
    });
    expect(later.json().user.id).toBe(account.user.id);
  });

  it('checks the Apple nonce', async () => {
    const nonce = 'raw-nonce-from-the-app-123';
    const hashed = createHash('sha256').update(nonce).digest('hex');
    const apple = async (sentNonce: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/auth/apple',
        payload: {
          identity_token: await t.signApple({ sub: `a-${randomInt(1e9)}`, nonce: hashed }),
          nonce: sentNonce,
          platform: 'ios',
        },
      });
    expect((await apple(nonce)).statusCode).toBe(201);
    expect((await apple('a-different-nonce')).json().code).toBe('ID_TOKEN_INVALID');
  });

  it('answers 503 for a sign-in method that is not set up', async () => {
    const bare = await createTestApp({}, { auth: { google: null } });
    try {
      const res = await bare.app.inject({
        method: 'POST',
        url: '/v1/auth/google',
        payload: { id_token: await t.signGoogle({ sub: 'x' }), platform: 'android' },
      });
      expect([res.statusCode, res.json().code]).toEqual([503, 'PROVIDER_UNAVAILABLE']);
    } finally {
      await bare.close();
    }
  });
});

describe('accounts and sessions', () => {
  it('signs out everywhere (FR-AUTH-8)', async () => {
    const sub = `g-${randomInt(1e9)}`;
    const onPhone = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      payload: { id_token: await t.signGoogle({ sub }), platform: 'android' },
    });
    const onWeb = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      payload: { id_token: await t.signGoogle({ sub }), platform: 'web' },
    });
    const webCookie = /ws_rt=([^;]+)/.exec(String(onWeb.headers['set-cookie']))![1]!;

    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/logout-all' })).statusCode).toBe(401);
    const out = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: bearer(onPhone.json().access),
    });
    expect(out.statusCode).toBe(204);

    const phoneRefresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh: onPhone.json().refresh },
    });
    expect(phoneRefresh.statusCode).toBe(401);
    const webRefresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { ws_rt: webCookie },
      headers: { 'x-requested-with': 'whosabi', origin: 'http://localhost:8081' },
    });
    expect(webRefresh.statusCode).toBe(401);
  });

  it('refuses a banned account', async () => {
    const account = await phoneSignIn();
    await t.pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [account.user.id]);
    t.clock.advance(31_000);
    const sent = await sendCode(account.phone.typed);
    const res = await verifyCode(sent.json().request_id, t.sms.codeFor(account.phone.e164));
    expect([res.statusCode, res.json().code]).toEqual([403, 'ACCOUNT_UNAVAILABLE']);
  });

  it('reports sign-ups and code checks as events', async () => {
    const guest = await signInGuest(t.app);
    const phone = newPhone();
    const sent = (await sendCode(phone.typed, 'android', { access: guest.access })).json()
      .request_id as string;
    await verifyCode(sent, '000001' === t.sms.codeFor(phone.e164) ? '000002' : '000001', {
      access: guest.access,
    });
    await verifyCode(sent, t.sms.codeFor(phone.e164), { access: guest.access });
    const events = (await eventsOf(guest.user.id)).map((e) => e.event);
    expect(events).toEqual(['otp_sent', 'otp_failed', 'signup_completed', 'otp_verified']);
  });
});
