import { createHash, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  CreateDuelResponse,
  DiscoveryResponse,
  FriendRequestResult,
  FriendsResponse,
  Platform,
  SignInResponse,
} from '@whosabi/shared-types';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp({ OTP_SENDS_PER_IP_PER_HOUR: '10000' });
});
afterAll(() => t.close());

interface Account {
  id: string;
  access: string;
  username: string;
  phone: string;
}

/** A full account with a phone number (for discovery) and a username. */
async function account(platform: Platform = 'android'): Promise<Account> {
  const rest = String(randomInt(0, 10_000_000)).padStart(7, '0');
  const phone = `+234803${rest}`;
  const sent = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/send',
    payload: { phone, platform: 'android' },
  });
  const verified = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { request_id: sent.json().request_id, code: t.sms.codeFor(phone) },
  });
  const body = verified.json() as SignInResponse;
  let access = body.access;
  if (platform !== 'android') {
    // Sign in again on the platform the test needs (the token carries it).
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: bearer(access),
      payload: { id_token: await t.signGoogle({ sub: `g-${randomInt(1e12)}` }), platform },
    });
    access = again.json().access;
  }
  const username = `p${randomInt(1e9)}`;
  await t.app.inject({ method: 'PATCH', url: '/v1/me', headers: bearer(access), payload: { username } });
  return { id: body.user.id, access, username, phone };
}

const post = (who: { access: string }, url: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(who.access), ...(payload ? { payload } : {}) });
const friendsOf = async (who: { access: string }) =>
  (
    await t.app.inject({ method: 'GET', url: '/v1/friends', headers: bearer(who.access) })
  ).json() as FriendsResponse;
const challenge = (from: { access: string }, to: string) =>
  post(from, '/v1/duels', { opponent: { user_id: to } });

async function eventsOf(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid)
    .map((row) => ({ event: row.event as string, props: JSON.parse(row.props as string) }));
}

describe('friends', () => {
  it('need an account', async () => {
    const guest = await signInGuest(t.app);
    const res = await t.app.inject({ method: 'GET', url: '/v1/friends', headers: bearer(guest.access) });
    expect([res.statusCode, res.json().code]).toEqual([403, 'ACCOUNT_REQUIRED']);
  });

  it('are asked by username and accepted, then listed on both sides', async () => {
    const tolu = await account();
    const chidi = await account();
    const asked = await post(tolu, '/v1/friends/requests', { username: chidi.username.toUpperCase() });
    expect(asked.statusCode).toBe(201);
    expect(asked.json() as FriendRequestResult).toMatchObject({ status: 'pending', user: { id: chidi.id } });
    expect((await post(tolu, '/v1/friends/requests', { username: chidi.username })).statusCode).toBe(200);

    expect((await friendsOf(tolu)).outgoing.map((f) => f.user.id)).toEqual([chidi.id]);
    expect((await friendsOf(chidi)).incoming.map((f) => f.user.id)).toEqual([tolu.id]);

    const accepted = await post(chidi, `/v1/friends/requests/${tolu.id}/accept`);
    expect(accepted.json()).toMatchObject({ status: 'accepted', user: { id: tolu.id } });
    expect((await friendsOf(tolu)).friends.map((f) => f.user.username)).toEqual([chidi.username]);
    expect((await friendsOf(chidi)).friends.map((f) => f.user.id)).toEqual([tolu.id]);
    for (const who of [tolu, chidi]) {
      expect((await eventsOf(who.id)).find((e) => e.event === 'friend_added')!.props).toEqual({
        source: 'username',
      });
    }

    // Unfriending ends it for both.
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/v1/friends/${chidi.id}`, headers: bearer(tolu.access) }))
        .statusCode,
    ).toBe(204);
    expect((await friendsOf(chidi)).friends).toEqual([]);
  });

  it('become friends when both ask at the same moment', async () => {
    const a = await account();
    const b = await account();
    const both = await Promise.all([
      post(a, '/v1/friends/requests', { user_id: b.id }),
      post(b, '/v1/friends/requests', { user_id: a.id }),
    ]);
    expect(both.map((r) => r.json().status).sort()).toEqual(['accepted', 'pending']);
    expect((await friendsOf(a)).friends.map((f) => f.user.id)).toEqual([b.id]);
  });

  it('can be declined, and nobody can befriend themselves or a guest', async () => {
    const a = await account();
    const b = await account();
    await post(a, '/v1/friends/requests', { user_id: b.id });
    expect((await post(b, `/v1/friends/requests/${a.id}/decline`)).statusCode).toBe(204);
    expect((await friendsOf(a)).outgoing).toEqual([]);
    expect((await post(b, `/v1/friends/requests/${a.id}/accept`)).statusCode).toBe(404);
    expect((await post(a, '/v1/friends/requests', { user_id: a.id })).statusCode).toBe(404);
    const guest = await signInGuest(t.app);
    expect((await post(a, '/v1/friends/requests', { user_id: guest.user.id })).statusCode).toBe(404);
  });
});

describe('who can challenge whom (step 1.2b)', () => {
  it('lets friends and past opponents challenge directly, and everyone else by link', async () => {
    const a = await account();
    const b = await account();
    const stranger = await challenge(a, b.id);
    expect([stranger.statusCode, stranger.json().code]).toEqual([403, 'FRIENDS_ONLY']);

    // B takes A's link once; they are now past opponents.
    const link = (await post(a, '/v1/duels', { opponent: { link: true } })).json() as CreateDuelResponse;
    const token = link.invite_url!.split('/d/')[1];
    expect((await post(b, `/v1/invites/${token}/accept`)).statusCode).toBe(200);
    expect((await challenge(a, b.id)).statusCode).toBe(201);
    expect((await challenge(b, a.id)).statusCode).toBe(201);
    expect((await friendsOf(a)).suggested.map((c) => c.id)).toContain(b.id);
  });

  it('stops requests, challenges and invites both ways once someone blocks, without saying who', async () => {
    const a = await account();
    const b = await account();
    await post(a, '/v1/friends/requests', { user_id: b.id });
    await post(b, `/v1/friends/requests/${a.id}/accept`);
    expect((await challenge(a, b.id)).statusCode).toBe(201);

    expect((await post(a, '/v1/blocks', { user_id: b.id })).statusCode).toBe(204);
    expect((await friendsOf(a)).friends).toEqual([]);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      expect((await post(from, '/v1/friends/requests', { user_id: to.id })).json().code).toBe(
        'USER_UNAVAILABLE',
      );
      expect((await challenge(from, to.id)).json().code).toBe('OPPONENT_UNAVAILABLE');
    }
    const link = (await post(a, '/v1/duels', { opponent: { link: true } })).json() as CreateDuelResponse;
    expect((await post(b, `/v1/invites/${link.invite_url!.split('/d/')[1]}/accept`)).json().code).toBe(
      'OPPONENT_UNAVAILABLE',
    );
    const card = await t.app.inject({
      method: 'GET',
      url: `/v1/users/${a.username}`,
      headers: bearer(b.access),
    });
    expect(card.statusCode).toBe(404);

    // Only the one who blocked can lift it.
    await t.app.inject({ method: 'DELETE', url: `/v1/blocks/${a.id}`, headers: bearer(b.access) });
    expect((await post(b, '/v1/friends/requests', { user_id: a.id })).statusCode).toBe(403);
    await t.app.inject({ method: 'DELETE', url: `/v1/blocks/${b.id}`, headers: bearer(a.access) });
    expect((await post(b, '/v1/friends/requests', { user_id: a.id })).statusCode).toBe(201);
  });
});

describe('contact discovery (FR-SOC-2)', () => {
  const prefixOf = (phone: string) => createHash('sha256').update(phone).digest('hex').slice(0, 5);
  const discover = (who: { access: string }, prefixes: string[]) =>
    post(who, '/v1/discovery/prefixes', { prefixes });

  it('returns full hashes for a 20-bit prefix, so the app matches contacts itself', async () => {
    const tolu = await account();
    const seeker = await account();
    const res = (await discover(seeker, [prefixOf(tolu.phone)])).json() as DiscoveryResponse;
    expect(res.matches).toContainEqual({
      hash: createHash('sha256').update(tolu.phone).digest('hex'),
      user_id: tolu.id,
      username: tolu.username,
      avatar_id: null,
    });
    // Never yourself.
    expect(
      ((await discover(tolu, [prefixOf(tolu.phone)])).json() as DiscoveryResponse).matches.map(
        (m) => m.user_id,
      ),
    ).not.toContain(tolu.id);
  });

  it('leaves out players who opted out, players under 18 and blocks', async () => {
    const seeker = await account();
    const hidden = await account();
    await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: bearer(hidden.access),
      payload: { discoverable: false },
    });
    const teen = await account();
    await post(teen, '/v1/me/age', { age_band: '13_17' });
    const blocker = await account();
    await post(blocker, '/v1/blocks', { user_id: seeker.id });

    const found = (
      (
        await discover(
          seeker,
          [hidden, teen, blocker].map((p) => prefixOf(p.phone)),
        )
      ).json() as DiscoveryResponse
    ).matches.map((m) => m.user_id);
    expect(found).not.toContain(hidden.id);
    expect(found).not.toContain(teen.id);
    expect(found).not.toContain(blocker.id);
  });

  it('is app-only, needs an account, and is capped per request and per day', async () => {
    const onWeb = await account('web');
    expect((await discover(onWeb, ['abcde'])).statusCode).toBe(403);
    const guest = await signInGuest(t.app);
    expect((await discover({ access: guest.access }, ['abcde'])).json().code).toBe('ACCOUNT_REQUIRED');

    const seeker = await account();
    expect((await discover(seeker, ['ABCDE'])).statusCode).toBe(400);
    const batch = (n: number) =>
      Array.from({ length: 500 }, (_, i) => (n * 500 + i).toString(16).padStart(5, '0'));
    expect((await discover(seeker, [...batch(0), 'fffff'])).statusCode).toBe(400);
    for (let n = 0; n < 6; n++) expect((await discover(seeker, batch(n))).statusCode).toBe(200);
    const over = await discover(seeker, batch(6));
    expect([over.statusCode, over.json().code]).toEqual([429, 'RATE_LIMITED']);
  });
});
