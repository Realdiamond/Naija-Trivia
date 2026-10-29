/**
 * The wallet (API §2.8): a player's coins and gems, and what moved them. Guests have a wallet too;
 * it moves into their account when they sign in to one.
 */
import type { FastifyInstance } from 'fastify';
import {
  WalletHistoryQuery,
  type LedgerReason,
  type Currency,
  type Wallet,
  type WalletHistory,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { requireAuth } from '../auth/context';
import { parse } from '../errors';
import { balances, userAccount } from './ledger';

const PAGE = 30;

export function economyRoutes(app: FastifyInstance, deps: AppDeps): void {
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
