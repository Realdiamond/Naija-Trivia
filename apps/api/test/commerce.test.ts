/**
 * Commerce in the console (build plan step 2.7i): store purchases and refunds, the totals for
 * real purchases only, the ones whose coins never arrived, and a month as CSV for finance.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { AdminCommerceResponse, AdminRole } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { checkLedger } from '../src/jobs/ledgerCheck';
import { ServerEvents } from '../src/events';
import { bearer, createTestApp, signInGuest } from './helpers';

const SECRET = 'Bearer test-revenuecat-webhook-secret';
const MINUTE = 60_000;
// A month no other test file plays in: Wednesday 12 April 2028, 14:00 WAT.
const NOW = Date.UTC(2028, 3, 12, 13, 0);

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp({ REVENUECAT_WEBHOOK_AUTH: SECRET });
  t.clock.t = NOW;
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(async () => {
  // Nothing dated here left behind: other files clean up by date and count the ledger.
  const players = (
    await t.pool.query<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM purchases WHERE created_at >= '2028-04-01' AND created_at < '2028-05-01'",
    )
  ).rows.map((r) => r.user_id);
  const txs = (
    await t.pool.query<{ transaction_id: string }>(
      `SELECT DISTINCT e.transaction_id FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.owner_user_id = ANY($1)`,
      [players],
    )
  ).rows.map((r) => r.transaction_id);
  await t.pool.query('DELETE FROM purchases WHERE user_id = ANY($1)', [players]);
  await t.pool.query('DELETE FROM ledger_entries WHERE transaction_id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_transactions WHERE id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_accounts WHERE owner_user_id = ANY($1)', [players]);
  await t.pool.query(
    "DELETE FROM staff_alerts WHERE dedupe_key LIKE 'purchases:2028-04-%' OR dedupe_key LIKE 'ledger:2028-04-%'",
  );
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `commerce-${randomInt(1e9)}@whosabi.ng`,
    roles.join('+'),
  ]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return (await sessions.create(id)).token;
}

/** A purchase as RevenueCat reports it. */
const buy = (userId: string, fields: Record<string, unknown> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/webhooks/revenuecat',
    headers: { authorization: SECRET },
    payload: {
      api_version: '1.0',
      event: {
        id: randomUUID(),
        type: 'NON_RENEWING_PURCHASE',
        app_user_id: userId,
        product_id: 'coins_medium',
        transaction_id: `GPA.${randomUUID()}`,
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        price_in_purchased_currency: 800,
        currency: 'NGN',
        purchased_at_ms: t.clock.now(),
        ...fields,
      },
    },
  });

describe('Commerce (step 2.7i)', () => {
  it('shows real purchases, refunds and missing coins to finance, and exports a month', async () => {
    const finance = await staff(['finance']);
    const support = await staff(['support']);
    expect(
      (await t.app.inject({ method: 'GET', url: '/admin/commerce', headers: bearer(support) })).statusCode,
    ).toBe(403);
    const player = await signInGuest(t.app, 'android');
    const before = (
      await t.app.inject({ method: 'GET', url: '/admin/commerce', headers: bearer(finance) })
    ).json() as AdminCommerceResponse;

    // Two real ₦800 packs, one refunded; a store test; and one whose coins never came.
    expect((await buy(player.user.id)).statusCode).toBe(200);
    t.clock.advance(1000);
    const refundedTx = `GPA.${randomUUID()}`;
    await buy(player.user.id, {
      transaction_id: refundedTx,
      product_id: 'coins_large',
      price_in_purchased_currency: 1500,
    });
    await buy(player.user.id, { environment: 'SANDBOX' });
    t.clock.advance(MINUTE);
    await buy(player.user.id, {
      type: 'CANCELLATION',
      cancel_reason: 'CUSTOMER_SUPPORT',
      transaction_id: refundedTx,
      product_id: 'coins_large',
    });
    await t.pool.query(
      `INSERT INTO purchases (id, user_id, store, product_id, store_tx_id, price_micros, currency, status, coins, created_at)
       VALUES ($1, $2, 'play', 'coins_small', $3, 300000000, 'NGN', 'completed', 500, $4)`,
      // A transaction id a spreadsheet would read as a formula.
      [newId('pu'), player.user.id, `=1+${randomUUID()}`, new Date(t.clock.now() - 20 * MINUTE)],
    );

    const after = (
      await t.app.inject({ method: 'GET', url: '/admin/commerce', headers: bearer(finance) })
    ).json() as AdminCommerceResponse;
    expect(after.today.purchases - before.today.purchases).toBe(3);
    expect(after.today.refunds - before.today.refunds).toBe(1);
    // ₦800 + ₦300; the refunded ₦1,500 doesn't count, nor the store test.
    expect((after.today.revenue.NGN ?? 0) - (before.today.revenue.NGN ?? 0)).toBe(1100);
    expect(after.missing_coins - before.missing_coins).toBe(1);
    expect(after.days).toHaveLength(30);
    expect(after.days.at(-1)!.day).toBe('2028-04-12');
    const mine = after.purchases.filter((p) => p.user_id === player.user.id);
    expect(mine.map((p) => [p.product_id, p.status, p.environment, p.granted])).toEqual([
      ['coins_large', 'refunded', 'production', true],
      ['coins_medium', 'completed', 'production', true],
      ['coins_small', 'completed', 'production', false],
    ]);
    expect(mine[1]!.price).toBe('₦800');
    const withTests = (
      await t.app.inject({ method: 'GET', url: '/admin/commerce?sandbox=true', headers: bearer(finance) })
    ).json() as AdminCommerceResponse;
    expect(withTests.purchases.filter((p) => p.user_id === player.user.id)).toHaveLength(4);
    const refunds = (
      await t.app.inject({ method: 'GET', url: '/admin/commerce?status=refunded', headers: bearer(finance) })
    ).json() as AdminCommerceResponse;
    expect(refunds.purchases.every((p) => p.status === 'refunded')).toBe(true);

    // The month for finance's books: no names, the player as their pseudonymous id.
    const csv = await t.app.inject({
      method: 'GET',
      url: '/admin/commerce/export?month=2028-04',
      headers: bearer(finance),
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="whosabi-purchases-2028-04.csv"');
    const lines = csv.body.trim().split('\n');
    expect(lines[0]).toBe(
      'purchase_id,bought_at_wat,store,product_id,store_transaction_id,price,currency,coins,status,refunded_at_wat,environment,player',
    );
    const ours = lines.filter((l) => l.endsWith(pseudonymousId(player.user.id, t.config.analyticsKey)));
    expect(ours).toHaveLength(4);
    expect(csv.body).not.toContain(player.user.id);
    expect(ours.find((l) => l.includes('coins_large'))).toContain(
      ',1500,NGN,3500,refunded,2028-04-12 14:01,',
    );
    expect(ours.find((l) => l.includes('coins_small'))).toContain(",'=1+");
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/admin/commerce/export?month=2028-13',
          headers: bearer(finance),
        })
      ).statusCode,
    ).toBe(400);
    const audit = await t.pool.query(
      "SELECT action, entity_id FROM admin_audit_log WHERE action = 'export_purchases' AND entity_id = '2028-04'",
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);

    // The nightly check tells the staff about the missing coins.
    t.clock.t = Date.UTC(2028, 3, 13, 4, 0); // 05:00 WAT the next day
    const deps = {
      pool: t.pool,
      redis: t.redis,
      clock: t.clock,
      events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
      log: t.app.log,
    };
    expect((await checkLedger(deps))?.missingCoins).toBeGreaterThanOrEqual(1);
    const alert = await t.pool.query(
      "SELECT title FROM staff_alerts WHERE dedupe_key = 'purchases:2028-04-13'",
    );
    expect(alert.rows).toEqual([{ title: 'Purchases without their coins' }]);
    t.clock.t = NOW;
  });
});
