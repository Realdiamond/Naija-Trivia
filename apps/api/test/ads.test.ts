import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { RewardedAdStatus, Wallet, WalletHistory } from '@whosabi/shared-types';
import { GoogleAdKeys, type AdKeys } from '../src/economy/ads';
import { bearer, createTestApp, signInGuest } from './helpers';

// Google's signing key, played by our own: the API checks callbacks against the "published" half.
const google = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const KEY_ID = '3335741209';
const keys: AdKeys = { key: async (id) => (id === KEY_ID ? google.publicKey : null) };

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp({}, { adKeys: keys });
});
afterAll(() => t.close());

/** A callback as AdMob sends it: the parameters in order, then `signature` and `key_id`. */
function callback(
  fields: { userId?: string; customData?: string; transactionId?: string },
  signer: KeyObject = google.privateKey,
): string {
  const params = new URLSearchParams();
  params.set('ad_network', '5450213213286189855');
  params.set('ad_unit', '1234567890');
  if (fields.customData !== undefined) params.set('custom_data', fields.customData);
  params.set('reward_amount', '1');
  params.set('reward_item', 'Reward');
  params.set('timestamp', String(t.clock.now()));
  params.set('transaction_id', fields.transactionId ?? randomUUID().replace(/-/g, ''));
  if (fields.userId) params.set('user_id', fields.userId);
  const message = params.toString();
  const signature = sign('sha256', Buffer.from(message), { key: signer, dsaEncoding: 'der' }).toString(
    'base64url',
  );
  return `${message}&signature=${signature}&key_id=${KEY_ID}`;
}

const ssv = (query: string) => t.app.inject({ method: 'GET', url: `/v1/ads/ssv?${query}` });

async function player() {
  const guest = await signInGuest(t.app, 'android');
  return { id: guest.user.id, access: guest.access };
}
type Player = Awaited<ReturnType<typeof player>>;
const get = async <T>(p: Player, url: string) =>
  (await t.app.inject({ method: 'GET', url, headers: bearer(p.access) })).json() as T;

async function eventsOf(userId: string, event: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid && row.event === event)
    .map((row) => JSON.parse(row.props as string) as Record<string, unknown>);
}

describe('rewarded ads (step 2.4c)', () => {
  it("pays 25 coins on AdMob's signed callback, once per transaction", async () => {
    const p = await player();
    expect(await get<RewardedAdStatus>(p, '/v1/ads/rewarded')).toEqual({ coins: 25, left_today: 10 });
    const query = callback({ userId: p.id, customData: 'coins' });

    const first = await ssv(query);
    expect([first.statusCode, first.json()]).toEqual([200, { outcome: 'granted' }]);
    // Google retries until it gets a 200: the same transaction pays nothing more.
    expect((await ssv(query)).json()).toEqual({ outcome: 'duplicate' });

    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 25, gems: 0 });
    const history = await get<WalletHistory>(p, '/v1/wallet/history');
    expect(history.items).toEqual([
      expect.objectContaining({ amount: 25, reason: 'rewarded_ad', ref_type: 'ad' }),
    ]);
    expect(await get<RewardedAdStatus>(p, '/v1/ads/rewarded')).toEqual({ coins: 25, left_today: 9 });
    expect(await eventsOf(p.id, 'ad_reward_granted')).toEqual([{ format: 'rewarded', amount: 25 }]);
    const row = await t.pool.query(
      'SELECT user_id, ledger_tx_id IS NOT NULL AS paid FROM ad_rewards WHERE user_id = $1',
      [p.id],
    );
    expect(row.rows).toEqual([{ user_id: p.id, paid: true }]);
  });

  it('refuses anything Google did not sign', async () => {
    const p = await player();
    const good = callback({ userId: p.id });
    // Someone changes who gets paid: the signature no longer matches.
    const tampered = good.replace(`user_id=${p.id}`, `user_id=${p.id}x`);
    expect((await ssv(tampered)).statusCode).toBe(403);
    const forged = callback(
      { userId: p.id },
      generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey,
    );
    expect((await ssv(forged)).statusCode).toBe(403);
    expect((await ssv(good.replace(`key_id=${KEY_ID}`, 'key_id=1'))).statusCode).toBe(403);
    expect((await ssv(good.split('&signature=')[0]!)).statusCode).toBe(403);
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 0, gems: 0 });
  });

  it('pays the first 10 of a WAT day, and again the next day', async () => {
    const p = await player();
    const outcomes: string[] = [];
    for (let i = 0; i < 11; i++)
      outcomes.push(((await ssv(callback({ userId: p.id }))).json() as { outcome: string }).outcome);
    expect(outcomes).toEqual([...Array(10).fill('granted'), 'capped']);
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 250, gems: 0 });
    expect(await get<RewardedAdStatus>(p, '/v1/ads/rewarded')).toEqual({ coins: 25, left_today: 0 });

    t.clock.advance(24 * 3_600_000);
    expect((await ssv(callback({ userId: p.id }))).json()).toEqual({ outcome: 'granted' });
  });

  it("answers Google's URL check, and pays nothing for players or placements it doesn't know", async () => {
    expect((await ssv(callback({}))).json()).toEqual({ outcome: 'not_ours' });
    expect((await ssv(callback({ userId: 'u_nobody' }))).json()).toEqual({ outcome: 'not_ours' });
    const p = await player();
    expect((await ssv(callback({ userId: p.id, customData: 'gems' }))).json()).toEqual({
      outcome: 'not_ours',
    });
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 0, gems: 0 });
  });

  it("pays what a video is worth on the player's platform (step 2.7t)", async () => {
    const p = await player();
    await t.pool.query(
      `INSERT INTO app_config (key, value) VALUES ('econ.rewarded_ad_coins@android', '40')
       ON CONFLICT (key) DO UPDATE SET value = '40'`,
    );
    try {
      t.clock.advance(11_000); // past the 10 s the API keeps the values
      expect((await get<RewardedAdStatus>(p, '/v1/ads/rewarded')).coins).toBe(40);
      expect((await ssv(callback({ userId: p.id }))).json()).toEqual({ outcome: 'granted' });
      expect((await get<Wallet>(p, '/v1/wallet')).coins).toBe(40);
      expect(await eventsOf(p.id, 'ad_reward_granted')).toEqual([{ format: 'rewarded', amount: 40 }]);
    } finally {
      await t.pool.query("DELETE FROM app_config WHERE key = 'econ.rewarded_ad_coins@android'");
      t.clock.advance(11_000);
    }
  });

  it("fetches Google's keys once a day, and again for a key it hasn't seen", async () => {
    let now = 0;
    let fetches = 0;
    const pem = google.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const fetchFn = (async () => {
      fetches++;
      return new Response(JSON.stringify({ keys: [{ keyId: Number(KEY_ID), pem, base64: '' }] }));
    }) as typeof fetch;
    const real = new GoogleAdKeys(fetchFn, () => now);
    expect(await real.key(KEY_ID)).not.toBeNull();
    expect(await real.key(KEY_ID)).not.toBeNull();
    expect(fetches).toBe(1);
    // An unknown key: look again, but not more than once a minute.
    expect(await real.key('1')).toBeNull();
    expect(fetches).toBe(1);
    now += 61_000;
    expect(await real.key('1')).toBeNull();
    expect(fetches).toBe(2);
    now += 25 * 3_600_000;
    await real.key(KEY_ID);
    expect(fetches).toBe(3);
  });
});
