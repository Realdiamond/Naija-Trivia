/**
 * The wallet (API §2.8): a player's coins and gems, and what moved them. Guests have a wallet too;
 * it moves into their account when they sign in to one. And rewarded ads (step 2.4c): AdMob's
 * signed callback pays, and the app asks how many will still pay today.
 */
import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { COIN_PACKS, coinPack, REWARDED_AD_COINS } from '@whosabi/game-rules';
import {
  ErrorCode,
  ShopEventRequest,
  WalletHistoryQuery,
  type ShopResponse,
  type RewardedAdStatus,
  type LedgerReason,
  type Currency,
  type Wallet,
  type WalletHistory,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { ApiError, parse } from '../errors';
import { raiseStaffAlert } from '../admin/alerts';
import { rewardAd, rewardedLeft, verifySsv, type AdKeys } from './ads';
import { handleRevenueCat, type RevenueCatEvent } from './purchases';
import { balances, userAccount } from './ledger';

const PAGE = 30;

export function economyRoutes(app: FastifyInstance, deps: AppDeps, adKeys: AdKeys): void {
  // AdMob's server-side verification callback: signed by Google, so no sign-in. Anything we
  // accept (paid, over the day's cap, seen before, not ours) is a 200, so Google stops retrying.
  app.get('/v1/ads/ssv', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request) => {
    const query = request.url.split('?')[1] ?? '';
    const callback = await verifySsv(query, adKeys);
    if (!callback) throw new ApiError(403, ErrorCode.forbidden, 'Not a verified AdMob callback');
    const outcome = await rewardAd(deps, callback);
    request.log.info({ outcome, transaction_id: callback.transactionId }, 'rewarded ad callback');
    return { outcome };
  });

  app.get('/v1/shop', async (): Promise<ShopResponse> => ({ packs: [...COIN_PACKS] }));

  // The payment journey for staff alerts: once an hour per player for opening the shop, once in
  // ten minutes per pack for tapping buy, so a curious player doesn't flood anyone's phone.
  app.post(
    '/v1/shop/events',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { userId } = requireAuth(request);
      const body = parse(ShopEventRequest, request.body);
      const now = deps.clock.now();
      const user = await deps.pool.query<{ username: string | null }>(
        'SELECT username FROM users WHERE id = $1',
        [userId],
      );
      const name = user.rows[0]?.username ?? 'A guest';
      const pack = body.sku ? coinPack(body.sku) : null;
      if (body.kind === 'opened') {
        await raiseStaffAlert(deps.pool, {
          kind: 'payment_opened',
          title: 'Someone opened the shop 👀',
          body: `${name} is looking at coin packs.`,
          url: `/staff/player/${userId}`,
          dedupeKey: `payment_opened:${userId}:${Math.floor(now / 3_600_000)}`,
          now,
        });
      } else if (pack) {
        await raiseStaffAlert(deps.pool, {
          kind: 'payment_started',
          title: `Started paying: ₦${pack.price_ngn.toLocaleString('en-NG')}`,
          body: `${name} tapped buy on ${pack.coins.toLocaleString('en-NG')} coins.`,
          url: `/staff/player/${userId}`,
          dedupeKey: `payment_started:${userId}:${pack.sku}:${Math.floor(now / 600_000)}`,
          now,
        });
      }
      return reply.status(204).send();
    },
  );

  // RevenueCat's webhook (TRD FR-ECO-3): its Authorization header must match our secret. Anything
  // handled is a 200 so RevenueCat stops retrying; a failure is a 500 and it tries again.
  app.post('/v1/webhooks/revenuecat', async (request) => {
    const expected = deps.config.revenueCatWebhookAuth;
    const given = request.headers.authorization ?? '';
    if (
      !expected ||
      given.length !== expected.length ||
      !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    ) {
      throw new ApiError(401, ErrorCode.unauthorized, 'Not RevenueCat');
    }
    const event = (request.body as { event?: RevenueCatEvent } | undefined)?.event;
    if (!event || typeof event.type !== 'string') {
      throw new ApiError(400, ErrorCode.validation, 'The request is not valid', 'event: missing');
    }
    const outcome = await handleRevenueCat(deps, event);
    request.log.info({ outcome, type: event.type, event_id: event.id }, 'revenuecat webhook');
    return { outcome };
  });

  app.get('/v1/ads/rewarded', async (request): Promise<RewardedAdStatus> => {
    const { userId } = requireAuth(request);
    return { coins: REWARDED_AD_COINS, left_today: await rewardedLeft(deps.pool, userId, deps.clock.now()) };
  });

  app.get('/v1/wallet', async (request): Promise<Wallet> => balances(deps.pool, requireAuth(request).userId));

  app.get('/v1/wallet/history', async (request): Promise<WalletHistory> => {
    const { userId } = requireAuth(request);
    const { before } = parse(WalletHistoryQuery, request.query);
    const rows = (
      await deps.pool.query<{
        id: string;
        amount: string;
        currency: Currency;
        reason: LedgerReason;
        ref_type: string | null;
        ref_id: string | null;
        created_at: Date;
      }>(
        `SELECT e.id, e.amount, a.currency, t.reason, t.ref_type, t.ref_id, e.created_at
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id
           JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE e.account_id = ANY($1) AND ($2::bigint IS NULL OR e.id < $2)
          ORDER BY e.id DESC LIMIT $3`,
        [[userAccount(userId, 'coins'), userAccount(userId, 'gems')], before ?? null, PAGE],
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        currency: r.currency,
        reason: r.reason,
        ref_type: r.ref_type,
        ref_id: r.ref_id,
        created_at: r.created_at.toISOString(),
      })),
      next: rows.length === PAGE ? rows[rows.length - 1]!.id : null,
    };
  });
}
