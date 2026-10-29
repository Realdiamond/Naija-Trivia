import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { ShopResponse, Wallet, WalletHistory } from '@whosabi/shared-types';
import { withTransaction } from '../src/db';
import { spendCoins } from '../src/economy/ledger';
import { bearer, createTestApp, signInGuest } from './helpers';

const SECRET = 'Bearer test-revenuecat-webhook-secret';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp({ REVENUECAT_WEBHOOK_AUTH: SECRET });
});
afterAll(() => t.close());

async function player() {
  const guest = await signInGuest(t.app, 'android');
  return { id: guest.user.id, access: guest.access };
}
type Player = Awaited<ReturnType<typeof player>>;
const get = async <T>(p: Player, url: string) =>
  (await t.app.inject({ method: 'GET', url, headers: bearer(p.access) })).json() as T;

/** A RevenueCat webhook body, as its dashboard documents it (api_version 1.0). */
function event(fields: Record<string, unknown>) {
  return {
    api_version: '1.0',
    event: {
      id: randomUUID(),
      type: 'NON_RENEWING_PURCHASE',
      product_id: 'coins_medium',
      transaction_id: `GPA.${randomUUID()}`,
      store: 'PLAY_STORE',
      environment: 'PRODUCTION',
      price: 0.6,
      price_in_purchased_currency: 800,
      currency: 'NGN',
      takehome_percentage: 0.85,
      purchased_at_ms: t.clock.now(),
      ...fields,
    },
  };
}

const webhook = (body: object, auth: string | null = SECRET) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/webhooks/revenuecat',
    headers: auth === null ? {} : { authorization: auth },
    payload: body,
  });

const alertsFor = async (kind: string, userId: string) =>
  (
    await t.pool.query<{ title: string; body: string; url: string | null }>(
      'SELECT title, body, url FROM staff_alerts WHERE kind = $1 AND url = $2 ORDER BY id',
      [kind, `/staff/player/${userId}`],
    )
  ).rows;

async function eventsOf(userId: string, name: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid && row.event === name)
    .map((row) => JSON.parse(row.props as string) as Record<string, unknown>);
}

describe('coin packs through RevenueCat (step 2.4d)', () => {
  it('lists the packs', async () => {
    const p = await player();
    const shop = await get<ShopResponse>(p, '/v1/shop');
    expect(shop.packs.map((pack) => [pack.sku, pack.coins, pack.price_ngn])).toEqual([
      ['coins_small', 500, 300],
      ['coins_medium', 1500, 800],
      ['coins_large', 3500, 1500],
      ['coins_mega', 9000, 3500],
    ]);
  });

  it('only listens to RevenueCat', async () => {
    const p = await player();
    const body = event({ app_user_id: p.id });
    expect((await webhook(body, null)).statusCode).toBe(401);
    expect((await webhook(body, 'Bearer guess-guess-guess-guess')).statusCode).toBe(401);
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 0, gems: 0 });
  });

  it("credits the pack's coins once per store transaction, and tells the staff", async () => {
    const p = await player();
    const body = event({ app_user_id: p.id });
    const first = await webhook(body);
    expect([first.statusCode, first.json()]).toEqual([200, { outcome: 'granted' }]);
    // RevenueCat retries until it hears a 200; a retry credits nothing more.
    expect((await webhook(body)).json()).toEqual({ outcome: 'duplicate' });

    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 1500, gems: 0 });
    expect((await get<WalletHistory>(p, '/v1/wallet/history')).items).toEqual([
      expect.objectContaining({ amount: 1500, reason: 'iap', ref_type: 'purchase' }),
    ]);
    const bought = await t.pool.query(
      `SELECT store, product_id, status, environment, coins, price_micros, currency, ledger_tx_id IS NOT NULL AS paid
         FROM purchases WHERE user_id = $1`,
      [p.id],
    );
    expect(bought.rows).toEqual([
      {
        store: 'play',
        product_id: 'coins_medium',
        status: 'completed',
        environment: 'production',
        coins: 1500,
        price_micros: '800000000',
        currency: 'NGN',
        paid: true,
      },
    ]);
    expect(await alertsFor('payment_paid', p.id)).toEqual([
      {
        title: 'Paid ₦800 💰',
        body: 'A guest bought 1,500 coins on Google Play.',
        url: `/staff/player/${p.id}`,
      },
    ]);
    expect(await eventsOf(p.id, 'purchase_completed')).toEqual([
      { sku: 'coins_medium', store: 'play', net_kobo: 68000 },
    ]);
  });

  it('says when a purchase was a test', async () => {
    const p = await player();
    await webhook(
      event({
        app_user_id: p.id,
        environment: 'SANDBOX',
        product_id: 'coins_small',
        price_in_purchased_currency: 300,
      }),
    );
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 500, gems: 0 });
    expect((await alertsFor('payment_paid', p.id))[0]!.body).toBe(
      'A guest bought 500 coins on Google Play. A test purchase: no real money.',
    );
  });

  it('takes back what is left of the coins when a purchase is refunded', async () => {
    const p = await player();
    const bought = event({ app_user_id: p.id });
    await webhook(bought);
    await withTransaction(t.pool, (c) =>
      spendCoins(c, p.id, 1000, { key: `test:${p.id}`, reason: 'lifeline', now: t.clock.now() }),
    );
    const refund = (reason: string) =>
      event({
        ...bought.event,
        id: randomUUID(),
        type: 'CANCELLATION',
        cancel_reason: reason,
        app_user_id: p.id,
      });
    // A cancellation that isn't a refund changes nothing.
    expect((await webhook(refund('UNSUBSCRIBE'))).json()).toEqual({ outcome: 'ignored' });
    expect((await webhook(refund('CUSTOMER_SUPPORT'))).json()).toEqual({ outcome: 'refunded' });
    expect((await webhook(refund('CUSTOMER_SUPPORT'))).json()).toEqual({ outcome: 'duplicate' });
    // 500 were left of the 1,500: the balance never goes below zero.
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 0, gems: 0 });
    expect((await get<WalletHistory>(p, '/v1/wallet/history')).items[0]).toMatchObject({
      reason: 'refund',
      amount: -500,
    });
    const row = await t.pool.query(
      'SELECT status, refunded_at IS NOT NULL AS done FROM purchases WHERE user_id = $1',
      [p.id],
    );
    expect(row.rows).toEqual([{ status: 'refunded', done: true }]);
    expect(await eventsOf(p.id, 'purchase_refunded')).toEqual([
      { sku: 'coins_medium', store: 'play', net_kobo: -68000 },
    ]);
  });

  it('raises a problem for a payment to a player it does not know, and ignores what it does not sell', async () => {
    const stray = event({ app_user_id: '$RCAnonymousID:abc123' });
    expect((await webhook(stray)).json()).toEqual({ outcome: 'unknown_player' });
    const problem = await t.pool.query('SELECT title, body FROM staff_alerts WHERE dedupe_key = $1', [
      `payment_unknown:${stray.event.transaction_id}`,
    ]);
    expect(problem.rows).toEqual([
      {
        title: 'A payment for a player we don’t know',
        body: expect.stringContaining('₦800 for coins_medium'),
      },
    ]);

    const p = await player();
    for (const fields of [
      { type: 'TEST' },
      { product_id: 'sabi_pass_monthly', type: 'INITIAL_PURCHASE' },
      { store: 'STRIPE' },
    ]) {
      expect((await webhook(event({ app_user_id: p.id, ...fields }))).json()).toEqual({ outcome: 'ignored' });
    }
    expect(await get<Wallet>(p, '/v1/wallet')).toEqual({ coins: 0, gems: 0 });
  });

  it('tells the staff when someone opens the shop or taps buy, without flooding them', async () => {
    const p = await player();
    const send = (body: object, access: string | null = p.access) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/shop/events',
        headers: access ? bearer(access) : {},
        payload: body,
      });
    expect((await send({ kind: 'opened' }, null)).statusCode).toBe(401);
    expect((await send({ kind: 'opened' })).statusCode).toBe(204);
    expect((await send({ kind: 'opened' })).statusCode).toBe(204);
    expect((await send({ kind: 'started', sku: 'coins_large' })).statusCode).toBe(204);
    expect((await send({ kind: 'started', sku: 'coins_large' })).statusCode).toBe(204);
    expect((await send({ kind: 'paid' })).statusCode).toBe(400);

    expect(await alertsFor('payment_opened', p.id)).toEqual([
      {
        title: 'Someone opened the shop 👀',
        body: 'A guest is looking at coin packs.',
        url: `/staff/player/${p.id}`,
      },
    ]);
    expect(await alertsFor('payment_started', p.id)).toEqual([
      {
        title: 'Started paying: ₦1,500',
        body: 'A guest tapped buy on 3,500 coins.',
        url: `/staff/player/${p.id}`,
      },
    ]);
  });
});
