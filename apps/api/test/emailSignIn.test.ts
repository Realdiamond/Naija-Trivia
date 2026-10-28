/**
 * Email sign-in codes (build plan step 2.10): the same rules as phone codes (hashed, once, 5
 * tries, paced and capped, a human check on the web), 10 minutes to use one, sent through Resend.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminUserSearchResponse,
  AdminUserSummary,
  Platform,
  SignInResponse,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { ResendEmail } from '../src/auth/email';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  // The per-IP code limit is shared with the other test files in this run.
  t = await createTestApp({ OTP_SENDS_PER_IP_PER_HOUR: '10000' });
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(() => t.close());

const newEmail = () => `player.${randomInt(1e9)}@example.com`;

function sendCode(
  email: string,
  platform: Platform = 'android',
  options: { access?: string; turnstile?: string } = {},
) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/send',
    headers: options.access ? bearer(options.access) : {},
    payload: { email, platform, ...(options.turnstile ? { turnstile_token: options.turnstile } : {}) },
  });
}

function verifyCode(requestId: string, code: string, access?: string) {
  return t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    headers: access ? bearer(access) : {},
    payload: { request_id: requestId, code },
  });
}

async function emailSignIn(email: string, access?: string) {
  const sent = await sendCode(email, 'android', { access });
  expect(sent.statusCode, sent.body).toBe(200);
  const res = await verifyCode(sent.json().request_id, t.email.codeFor(email.trim().toLowerCase()), access);
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json() as SignInResponse;
}

describe('email sign-in', () => {
  it('signs up with a 6-digit code by email and signs in again to the same account', async () => {
    const email = newEmail();
    const sent = await sendCode(`  ${email.toUpperCase()} `);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ request_id: expect.stringMatching(/^eotp_/), resend_after_s: 30 });
    const message = t.email.outbox.at(-1)!;
    const code = t.email.codeFor(email);
    expect(message).toMatchObject({ to: email, subject: `${code} is your Who Sabi? code` });
    expect(message.text).toContain('It expires in 10 minutes.');
    expect(message.html).toContain(`>${code}</td>`);

    const res = await verifyCode(sent.json().request_id, code);
    expect(res.statusCode).toBe(201);
    const body = res.json() as SignInResponse;
    expect(body).toMatchObject({ is_new: true, merged_guest: false, user: { status: 'active' } });
    const identity = await t.pool.query(
      "SELECT subject, verified_at FROM auth_identities WHERE user_id = $1 AND provider = 'email'",
      [body.user.id],
    );
    expect(identity.rows).toEqual([{ subject: email, verified_at: expect.any(Date) }]);
    const alert = await t.pool.query('SELECT body FROM staff_alerts WHERE url = $1', [
      `/staff/player/${body.user.id}`,
    ]);
    expect(alert.rows).toEqual([{ body: 'Signed up with an email code on Android.' }]);

    t.clock.advance(31_000);
    expect((await emailSignIn(email)).user.id).toBe(body.user.id);
  });

  it("keeps a guest's progress", async () => {
    const guest = await signInGuest(t.app);
    const signedIn = await emailSignIn(newEmail(), guest.access);
    expect(signedIn).toMatchObject({ is_new: true, merged_guest: true, user: { id: guest.user.id } });
  });

  it('lasts 10 minutes, allows 5 tries, and is never taken for a phone code', async () => {
    const email = newEmail();
    const first = (await sendCode(email)).json().request_id as string;
    t.clock.advance(9 * 60_000);
    const right = t.email.codeFor(email);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let tries = 1; tries <= 4; tries++) {
      expect((await verifyCode(first, wrong)).json().code).toBe('OTP_INVALID');
    }
    expect((await verifyCode(first, wrong)).json().code).toBe('OTP_TOO_MANY_ATTEMPTS');

    const second = (await sendCode(email)).json().request_id as string;
    t.clock.advance(10 * 60_000 + 1);
    expect((await verifyCode(second, t.email.codeFor(email))).json().code).toBe('OTP_EXPIRED');

    // A phone code's request can't be used here, nor an email code's on the phone endpoint.
    t.clock.advance(31_000);
    const third = (await sendCode(email, 'android', { turnstile: 'human' })).json().request_id as string;
    const onPhone = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { request_id: third, code: t.email.codeFor(email) },
    });
    expect(onPhone.json().code).toBe('OTP_EXPIRED');
    expect((await verifyCode(third, t.email.codeFor(email))).statusCode).toBe(201);
  });

  it('paces and caps codes, wants a human check on the web and from the third, and skips refused sends', async () => {
    const email = newEmail();
    expect((await sendCode(email)).statusCode).toBe(200);
    expect((await sendCode(email)).json().code).toBe('RATE_LIMITED');
    t.clock.advance(31_000);
    expect((await sendCode(email)).statusCode).toBe(200);
    t.clock.advance(31_000);
    expect((await sendCode(email)).json().code).toBe('CAPTCHA_REQUIRED');

    // Resend refusing (its daily limit, say): nothing sent, nothing counted.
    t.email.down = true;
    try {
      expect((await sendCode(email, 'android', { turnstile: 'human' })).json().code).toBe(
        'PROVIDER_UNAVAILABLE',
      );
    } finally {
      t.email.down = false;
    }
    for (let i = 3; i <= 5; i++) {
      expect((await sendCode(email, 'android', { turnstile: 'human' })).statusCode).toBe(200);
      t.clock.advance(31_000);
    }
    expect((await sendCode(email, 'android', { turnstile: 'human' })).json().code).toBe('OTP_LIMIT_REACHED');

    const web = newEmail();
    expect((await sendCode(web, 'web')).json().code).toBe('CAPTCHA_REQUIRED');
    expect((await sendCode(web, 'web', { turnstile: 'robot' })).json().code).toBe('CAPTCHA_FAILED');
    expect((await sendCode(web, 'web', { turnstile: 'human' })).statusCode).toBe(200);
  });

  it('takes only email addresses', async () => {
    for (const email of ['chidi', 'chidi@', '@example.com', 'chidi okeke@example.com']) {
      const res = await sendCode(email);
      expect([res.statusCode, res.json().code], email).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 503 on both steps when email is not set up', async () => {
    const bare = await createTestApp({ OTP_SENDS_PER_IP_PER_HOUR: '10000' }, { auth: { email: null } });
    try {
      expect((await bare.app.inject({ method: 'GET', url: '/v1/auth/methods' })).json().email).toBe(false);
      const send = await bare.app.inject({
        method: 'POST',
        url: '/v1/auth/email/send',
        payload: { email: newEmail(), platform: 'android' },
      });
      expect([send.statusCode, send.json().code]).toEqual([503, 'PROVIDER_UNAVAILABLE']);
      const verify = await bare.app.inject({
        method: 'POST',
        url: '/v1/auth/email/verify',
        payload: { request_id: 'eotp_0123456789ab', code: '123456' },
      });
      expect([verify.statusCode, verify.json().code]).toEqual([503, 'PROVIDER_UNAVAILABLE']);
    } finally {
      await bare.close();
    }
  });
});

describe('staff and email sign-ins', () => {
  async function staff(role: 'owner' | 'moderator'): Promise<string> {
    const id = newId('adm');
    await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
      id,
      `email-staff${randomInt(1e9)}@whosabi.ng`,
      role,
    ]);
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
    return (await new AdminSessions(t.redis, t.clock.now).create(id)).token;
  }

  it('finds a player by the exact address, masked, for roles that may search contact details', async () => {
    const email = `chidi.${randomInt(1e9)}@example.com`;
    const player = await emailSignIn(email);
    const owner = await staff('owner');
    const found = await t.app.inject({
      method: 'GET',
      url: `/admin/users?q=${encodeURIComponent(email.toUpperCase())}`,
      headers: bearer(owner),
    });
    expect((found.json() as AdminUserSearchResponse).users).toEqual([
      expect.objectContaining({ id: player.user.id, matched: 'email' }),
    ]);
    const summary = (
      await t.app.inject({ method: 'GET', url: `/admin/users/${player.user.id}`, headers: bearer(owner) })
    ).json() as AdminUserSummary;
    expect(summary.sign_in_methods).toEqual([
      expect.objectContaining({ provider: 'email', masked: 'c•••@example.com' }),
    ]);
    const audit = await t.pool.query(
      "SELECT after FROM admin_audit_log WHERE action = 'search_users' ORDER BY id DESC LIMIT 1",
    );
    expect(JSON.stringify(audit.rows[0].after)).not.toContain(email.split('@')[0]);

    const moderator = await staff('moderator');
    const refused = await t.app.inject({
      method: 'GET',
      url: `/admin/users?q=${encodeURIComponent(email)}`,
      headers: bearer(moderator),
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe('Resend', () => {
  it('sends to Resend with the key and sender, and fails when Resend refuses', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 200;
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'email_1' }), { status });
    }) as unknown as typeof fetch;
    const resend = new ResendEmail({ apiKey: 're_test', from: 'Who Sabi? <codes@whosabi.ng>', fetch: fake });
    const email = { to: 'a@example.com', subject: 's', text: 't', html: '<p>h</p>' };
    expect(await resend.send(email)).toBe('resend');
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer re_test' });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: 'Who Sabi? <codes@whosabi.ng>',
      to: ['a@example.com'],
      subject: 's',
      text: 't',
      html: '<p>h</p>',
    });
    status = 429;
    await expect(resend.send(email)).rejects.toThrow('resend answered 429');
  });
});
