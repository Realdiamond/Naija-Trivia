/**
 * Guardian consent for 13–17s (build plan step 2.8d, doc 10 §3.3): a code to a parent's phone
 * or email, which they give the player if they agree; until then the account has no name and no
 * friends.
 */
import { createHash, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Me, SignInResponse } from '@whosabi/shared-types';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const post = (access: string, url: string, payload: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(access), payload });

async function teen(): Promise<SignInResponse> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/google',
    payload: { id_token: await t.signGoogle({ sub: `g-teen-${randomInt(1e12)}` }), platform: 'android' },
  });
  const account = res.json() as SignInResponse;
  expect((await post(account.access, '/v1/me/age', { age_band: '13_17' })).json().guardian).toBe('needed');
  return account;
}

const parentPhone = () => `+23480${randomInt(10_000_000, 99_999_999)}`;
/** The code in the newest message: "give them this code: 123456". */
const codeIn = (text: string | undefined) => /code: (\d{6})/.exec(text ?? '')?.[1] ?? '';
const textCode = (phone: string) => codeIn(t.sms.outbox.filter((m) => m.to === phone).at(-1)?.text);
const emailCode = (address: string) => codeIn(t.email.outbox.filter((m) => m.to === address).at(-1)?.text);

describe('guardian consent (step 2.8d)', () => {
  it('a parent agrees by text: the player then picks a name and adds friends', async () => {
    const player = await teen();
    const friend = await signInGuest(t.app);
    // Waiting: no name, no friends.
    expect(
      (
        await t.app.inject({
          method: 'PATCH',
          url: '/v1/me',
          headers: bearer(player.access),
          payload: { username: `teen_${randomInt(1e6)}` },
        })
      ).json().code,
    ).toBe('GUARDIAN_CONSENT_REQUIRED');
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/friends', headers: bearer(player.access) })).json().code,
    ).toBe('GUARDIAN_CONSENT_REQUIRED');

    const phone = parentPhone();
    const sent = await post(player.access, '/v1/me/guardian/send', {
      phone: `0${phone.slice(4)}`,
      platform: 'android',
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const message = t.sms.outbox.filter((m) => m.to === phone).at(-1)!.text;
    expect(message).toMatch(/^A child wants to play Who Sabi\?/);
    expect(message.length).toBeLessThanOrEqual(306); // two text messages at most

    // Someone else can't use the code, nor a wrong one count.
    const other = await teen();
    expect(
      (
        await post(other.access, '/v1/me/guardian/verify', {
          request_id: sent.json().request_id,
          code: textCode(phone),
        })
      ).json().code,
    ).toBe('OTP_EXPIRED');
    const wrong = textCode(phone) === '000000' ? '111111' : '000000';
    expect(
      (
        await post(player.access, '/v1/me/guardian/verify', {
          request_id: sent.json().request_id,
          code: wrong,
        })
      ).json().code,
    ).toBe('OTP_INVALID');

    const agreed = await post(player.access, '/v1/me/guardian/verify', {
      request_id: sent.json().request_id,
      code: textCode(phone),
    });
    expect(agreed.statusCode, agreed.body).toBe(200);
    expect((agreed.json() as Me).guardian).toBe('given');
    const record = (
      await t.pool.query(
        "SELECT granted, policy_version, source, details FROM consent_records WHERE user_id = $1 AND purpose = 'guardian'",
        [player.user.id],
      )
    ).rows;
    expect(record).toEqual([
      {
        granted: true,
        policy_version: '2026-10',
        source: 'guardian_code',
        details: {
          method: 'phone',
          contact: `${phone.slice(0, 7)}${'•'.repeat(phone.length - 9)}${phone.slice(-2)}`,
          contact_sha256: createHash('sha256').update(phone).digest('hex'),
        },
      },
    ]);
    // Only the masked number is kept.
    expect(JSON.stringify(record)).not.toContain(phone);

    const named = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: bearer(player.access),
      payload: { username: `teen_${randomInt(1e6)}` },
    });
    expect(named.statusCode, named.body).toBe(200);
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/friends', headers: bearer(player.access) })).statusCode,
    ).toBe(200);
    // Once is enough.
    expect(
      (await post(player.access, '/v1/me/guardian/send', { phone, platform: 'android' })).statusCode,
    ).toBe(409);
    expect(friend.user.id).toBeTruthy();
  });

  it('works by email too, never to the player themselves, and only for 13–17s', async () => {
    const player = await teen();
    const parent = `parent.${randomInt(1e9)}@example.com`;
    const sent = await post(player.access, '/v1/me/guardian/send', {
      email: `  ${parent.toUpperCase()} `,
      platform: 'web',
      turnstile_token: 'human',
    });
    expect(sent.statusCode, sent.body).toBe(200);
    const mail = t.email.outbox.filter((m) => m.to === parent).at(-1)!;
    expect(mail.subject).toBe(`${emailCode(parent)}: a child wants to play Who Sabi?`);
    expect(mail.text).toContain('help@whosabi.ng');
    const agreed = await post(player.access, '/v1/me/guardian/verify', {
      request_id: sent.json().request_id,
      code: emailCode(parent),
    });
    expect((agreed.json() as Me).guardian).toBe('given');
    const details = (
      await t.pool.query("SELECT details FROM consent_records WHERE user_id = $1 AND purpose = 'guardian'", [
        player.user.id,
      ])
    ).rows[0].details;
    expect(details).toMatchObject({ method: 'email', contact: `p•••@example.com` });

    // The player's own sign-in email can't stand in for a parent's.
    const selfish = await teen();
    const own = `teen.${randomInt(1e9)}@example.com`;
    await t.pool.query(
      "INSERT INTO auth_identities (id, user_id, provider, subject) VALUES ($1, $2, 'email', $3)",
      [`ai_own_${randomInt(1e9)}`, selfish.user.id, own],
    );
    expect(
      (await post(selfish.access, '/v1/me/guardian/send', { email: own, platform: 'android' })).statusCode,
    ).toBe(400);
    // Exactly one of phone or email.
    expect((await post(selfish.access, '/v1/me/guardian/send', { platform: 'android' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await post(selfish.access, '/v1/me/guardian/send', {
          phone: parentPhone(),
          email: own,
          platform: 'android',
        })
      ).statusCode,
    ).toBe(400);

    // Adults and guests need nobody's say-so.
    const adult = await signInGuest(t.app);
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(adult.access) })).json().guardian,
    ).toBe('not_needed');
    expect(
      (await post(adult.access, '/v1/me/guardian/send', { phone: parentPhone(), platform: 'android' }))
        .statusCode,
    ).toBe(409);
  });
});
