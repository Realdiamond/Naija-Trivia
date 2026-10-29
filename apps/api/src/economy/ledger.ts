/**
 * The coin ledger (TRD FR-ECO-1, doc 08 "Ledger"): every movement is one transaction whose
 * entries sum to zero, written once per idempotency key, in the caller's database transaction.
 * A player's balance is cached on their account and can never go below zero; the nightly check
 * (jobs/ledgerCheck.ts) adds the entries up again.
 */
import { ErrorCode, type Currency, type LedgerReason } from '@whosabi/shared-types';
import type { PoolClient } from '../db';
import { conflict } from '../errors';
import { newId } from '../ids';

export const userAccount = (userId: string, currency: Currency = 'coins') => `user:${userId}:${currency}`;
/** Where grants come from, and where spends go. */
const REWARDS = (currency: Currency) => `system:rewards:${currency}`;
const SHOP = (currency: Currency) => `system:shop:${currency}`;

export interface Posting {
  /** The same key never moves coins twice: a retry finds the first one. */
  key: string;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  now: number;
}

/** A change to a player's coins, for the `coins_changed` event once the transaction commits. */
export interface CoinChange {
  userId: string;
  delta: number;
  reason: LedgerReason;
  balance: number;
}

export const notEnoughCoins = () =>
  conflict(ErrorCode.notEnoughCoins, 'Not enough coins', 'Win duels and play the Daily to earn more.');

async function openAccount(client: PoolClient, userId: string, currency: Currency): Promise<string> {
  const id = userAccount(userId, currency);
  await client.query(
    `INSERT INTO ledger_accounts (id, owner_user_id, currency) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [id, userId, currency],
  );
  return id;
}

/** Writes the transaction and its entries; false when the key was used before. */
async function post(
  client: PoolClient,
  posting: Posting,
  legs: ReadonlyArray<{ account: string; amount: number }>,
): Promise<boolean> {
  const at = new Date(posting.now);
  const id = newId('lt', posting.now);
  const inserted = await client.query(
    `INSERT INTO ledger_transactions (id, idempotency_key, reason, ref_type, ref_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING`,
    [id, posting.key, posting.reason, posting.refType ?? null, posting.refId ?? null, at],
  );
  if (inserted.rowCount === 0) return false;
  for (const leg of legs) {
    await client.query(
      'INSERT INTO ledger_entries (transaction_id, account_id, amount, created_at) VALUES ($1, $2, $3, $4)',
      [id, leg.account, leg.amount, at],
    );
  }
  return true;
}

async function addToBalance(client: PoolClient, account: string, amount: number): Promise<number> {
  const row = await client.query<{ balance: string }>(
    'UPDATE ledger_accounts SET balance = balance + $2 WHERE id = $1 RETURNING balance',
    [account, amount],
  );
  return Number(row.rows[0]!.balance);
}

/** Gives a player coins. Null for nothing to give, or a key already used. */
export async function grantCoins(
  client: PoolClient,
  userId: string,
  amount: number,
  posting: Posting,
): Promise<CoinChange | null> {
  if (amount <= 0) return null;
  const account = await openAccount(client, userId, 'coins');
  const posted = await post(client, posting, [
    { account, amount },
    { account: REWARDS('coins'), amount: -amount },
  ]);
  if (!posted) return null;
  return {
    userId,
    delta: amount,
    reason: posting.reason,
    balance: await addToBalance(client, account, amount),
  };
}

/**
 * Takes a player's coins for something they bought. A key already used is no charge (a retry of
 * the same purchase); not enough coins is a 409 `NOT_ENOUGH_COINS`.
 */
export async function spendCoins(
  client: PoolClient,
  userId: string,
  amount: number,
  posting: Posting,
): Promise<CoinChange | null> {
  if (amount <= 0) return null;
  const account = await openAccount(client, userId, 'coins');
  const balance = Number(
    (
      await client.query<{ balance: string }>(
        'SELECT balance FROM ledger_accounts WHERE id = $1 FOR UPDATE',
        [account],
      )
    ).rows[0]!.balance,
  );
  const used = await client.query('SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1', [
    posting.key,
  ]);
  if ((used.rowCount ?? 0) > 0) return null;
  if (balance < amount) throw notEnoughCoins();
  await post(client, posting, [
    { account, amount: -amount },
    { account: SHOP('coins'), amount },
  ]);
  return {
    userId,
    delta: -amount,
    reason: posting.reason,
    balance: await addToBalance(client, account, -amount),
  };
}

/** Moves all of one player's coins to another (a guest's into their account). */
export async function moveAllCoins(
  client: PoolClient,
  fromUserId: string,
  toUserId: string,
  posting: Posting,
): Promise<CoinChange | null> {
  const from = userAccount(fromUserId);
  const row = await client.query<{ balance: string }>(
    'SELECT balance FROM ledger_accounts WHERE id = $1 FOR UPDATE',
    [from],
  );
  const amount = Number(row.rows[0]?.balance ?? 0);
  if (amount <= 0) return null;
  const to = await openAccount(client, toUserId, 'coins');
  const posted = await post(client, posting, [
    { account: from, amount: -amount },
    { account: to, amount },
  ]);
  if (!posted) return null;
  await addToBalance(client, from, -amount);
  return {
    userId: toUserId,
    delta: amount,
    reason: posting.reason,
    balance: await addToBalance(client, to, amount),
  };
}

export async function balances(
  client: Pick<PoolClient, 'query'>,
  userId: string,
): Promise<Record<Currency, number>> {
  const rows = await client.query<{ currency: Currency; balance: string }>(
    'SELECT currency, balance FROM ledger_accounts WHERE id = ANY($1)',
    [[userAccount(userId, 'coins'), userAccount(userId, 'gems')]],
  );
  const out: Record<Currency, number> = { coins: 0, gems: 0 };
  for (const r of rows.rows) out[r.currency] = Number(r.balance);
  return out;
}
