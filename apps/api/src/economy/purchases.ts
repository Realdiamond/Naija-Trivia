/**
 * Coin packs bought in the stores (TRD FR-ECO-3, build plan step 2.4d). RevenueCat checks the
 * receipt with Google Play (or the App Store) and calls our webhook; we credit the pack's coins
 * once per store transaction and tell the staff. A refund takes back what is left of them.
 */
import { coinPack, STORE_TAKEHOME } from '@whosabi/game-rules';
import type { AppDeps } from '../app';
import { raiseStaffAlert } from '../admin/alerts';
import { withTransaction } from '../db';
import type { EventContext } from '../events';
import { newId } from '../ids';
import { grantCoins, reclaimCoins, type CoinChange } from './ledger';

/** The parts of a RevenueCat webhook event we use (api_version 1.0). */
export interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id?: string;
  product_id?: string;
  transaction_id?: string;
  store?: string;
  environment?: string;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  price?: number | null;
  takehome_percentage?: number | null;
  cancel_reason?: string | null;
}

export type PurchaseOutcome = 'granted' | 'duplicate' | 'refunded' | 'unknown_player' | 'ignored';

const STORES: Record<string, 'play' | 'app_store'> = { PLAY_STORE: 'play', APP_STORE: 'app_store' };
const STORE_NAMES = { play: 'Google Play', app_store: 'the App Store' } as const;
/** Doc 11's planning rate, for a sale in another currency. */
const NGN_PER_USD = 1335;

/** What we keep from the sale, in kobo, for the revenue numbers. */
function netKobo(e: RevenueCatEvent): number {
  const keep = e.takehome_percentage ?? STORE_TAKEHOME;
  const naira =
    e.currency === 'NGN' && e.price_in_purchased_currency != null
      ? e.price_in_purchased_currency
      : (e.price ?? 0) * NGN_PER_USD;
  return Math.round(Math.abs(naira) * keep * 100);
}

function money(e: RevenueCatEvent): string {
  const amount = e.price_in_purchased_currency;
  if (amount == null || !e.currency) return 'a coin pack';
  const shown = amount.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  return e.currency === 'NGN' ? `₦${shown}` : `${e.currency} ${shown}`;
}

export async function handleRevenueCat(
  deps: Pick<AppDeps, 'pool' | 'clock' | 'events' | 'log'>,
  e: RevenueCatEvent,
): Promise<PurchaseOutcome> {
  const pack = e.product_id ? coinPack(e.product_id) : null;
  const store = e.store ? STORES[e.store] : undefined;
  // Subscriptions (the Sabi Pass) come in v1.1; test events and other stores have nothing to credit.
  if (!pack || !store || !e.transaction_id || !e.app_user_id) return 'ignored';
  if (e.type === 'CANCELLATION') return refund(deps, e, store);
  if (e.type !== 'NON_RENEWING_PURCHASE' && e.type !== 'INITIAL_PURCHASE') return 'ignored';

  const now = deps.clock.now();
  const userId = e.app_user_id;
  const sandbox = e.environment === 'SANDBOX';
  const result = await withTransaction(deps.pool, async (client) => {
    const user = (
      await client.query<{ username: string | null; last_platform: EventContext['platform'] | null }>(
        "SELECT username, last_platform FROM users WHERE id = $1 AND status IN ('guest', 'active', 'restricted')",
        [userId],
      )
    ).rows[0];
    if (!user) {
      // Paid, but not to a player we know (the app didn't sign in to RevenueCat?): someone must look.
      await raiseStaffAlert(client, {
        kind: 'problem',
        title: 'A payment for a player we don’t know',
        body: `${money(e)} for ${pack.sku} on ${STORE_NAMES[store]} (RevenueCat user ${userId.slice(0, 60)}, transaction ${e.transaction_id}). No coins were given.`,
        dedupeKey: `payment_unknown:${e.transaction_id}`,
        now,
      });
      return { outcome: 'unknown_player' as const };
    }
    const purchaseId = newId('pu', now);
    const inserted = await client.query(
      `INSERT INTO purchases (id, user_id, store, product_id, store_tx_id, price_micros, currency, status,
                              environment, coins, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10) ON CONFLICT (store_tx_id) DO NOTHING`,
      [
        purchaseId,
        userId,
        store,
        pack.sku,
        e.transaction_id,
        e.price_in_purchased_currency == null ? null : Math.round(e.price_in_purchased_currency * 1e6),
        e.currency?.slice(0, 3) ?? null,
        sandbox ? 'sandbox' : 'production',
        pack.coins,
        new Date(now),
      ],
    );
    if (inserted.rowCount === 0) return { outcome: 'duplicate' as const };
    const key = `iap:${e.transaction_id}`;
    const change = await grantCoins(client, userId, pack.coins, {
      key,
      reason: 'iap',
      refType: 'purchase',
      refId: purchaseId,
      now,
    });
    await client.query(
      'UPDATE purchases SET ledger_tx_id = (SELECT id FROM ledger_transactions WHERE idempotency_key = $2) WHERE id = $1',
      [purchaseId, key],
    );
    await raiseStaffAlert(client, {
      kind: 'payment_paid',
      title: `Paid ${money(e)} 💰`,
      body: `${user.username ?? 'A guest'} bought ${pack.coins.toLocaleString('en-NG')} coins on ${STORE_NAMES[store]}.${
        sandbox ? ' A test purchase: no real money.' : ''
      }`,
      url: `/staff/player/${userId}`,
      now,
    });
    return { outcome: 'granted' as const, change, platform: user.last_platform ?? 'android' };
  });
  if (result.outcome === 'granted') {
    const ctx: EventContext = { userId, platform: result.platform };
    await deps.events.emit('purchase_completed', { sku: pack.sku, store, net_kobo: netKobo(e) }, ctx);
    await emitCoins(deps, result.change, ctx);
  }
  return result.outcome;
}

async function refund(
  deps: Pick<AppDeps, 'pool' | 'clock' | 'events' | 'log'>,
  e: RevenueCatEvent,
  store: 'play' | 'app_store',
): Promise<PurchaseOutcome> {
  // Only a refund takes coins back; other cancellations of a one-off purchase change nothing.
  if (e.cancel_reason !== 'CUSTOMER_SUPPORT') return 'ignored';
  const now = deps.clock.now();
  const result = await withTransaction(deps.pool, async (client) => {
    const purchase = (
      await client.query<{ id: string; user_id: string; product_id: string; coins: number | null }>(
        `UPDATE purchases SET status = 'refunded', refunded_at = $2
          WHERE store_tx_id = $1 AND status = 'completed' RETURNING id, user_id, product_id, coins`,
        [e.transaction_id, new Date(now)],
      )
    ).rows[0];
    if (!purchase) return null;
    const change = await reclaimCoins(client, purchase.user_id, purchase.coins ?? 0, {
      key: `refund:${e.transaction_id}`,
      reason: 'refund',
      refType: 'purchase',
      refId: purchase.id,
      now,
    });
    const platform = (
      await client.query<{ last_platform: EventContext['platform'] | null }>(
        'SELECT last_platform FROM users WHERE id = $1',
        [purchase.user_id],
      )
    ).rows[0]?.last_platform;
    return { purchase, change, platform: platform ?? 'android' };
  });
  if (!result) return 'duplicate';
  const ctx: EventContext = { userId: result.purchase.user_id, platform: result.platform };
  await deps.events.emit(
    'purchase_refunded',
    { sku: result.purchase.product_id, store, net_kobo: -netKobo(e) },
    ctx,
  );
  await emitCoins(deps, result.change, ctx);
  return 'refunded';
}

async function emitCoins(
  deps: Pick<AppDeps, 'events'>,
  change: CoinChange | null,
  ctx: EventContext,
): Promise<void> {
  if (!change) return;
  await deps.events.emit(
    'coins_changed',
    { delta: change.delta, reason: change.reason, balance_after: change.balance },
    ctx,
  );
}
