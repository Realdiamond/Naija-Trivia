/**
 * Rewarded ads (TRD FR-ECO-2, API §2.8, build plan step 2.4c). Coins are granted only when
 * AdMob's server-side verification (SSV) callback says the video was watched, never on the app's
 * word. Google signs each callback with one of the keys it publishes; a callback pays once (its
 * transaction id), and only the first 10 a WAT day pay.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { REWARDED_AD_COINS, REWARDED_DAILY_CAP, watDate } from '@whosabi/game-rules';
import type { AppDeps } from '../app';
import { withTransaction, type Pool, type PoolClient } from '../db';
import type { EventContext } from '../events';
import { grantCoins, type CoinChange } from './ledger';

export const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const KEYS_TTL_MS = 24 * 3_600_000;
/** A key id we don't know sends us to Google again, but not more than once a minute. */
const UNKNOWN_KEY_RETRY_MS = 60_000;

export interface AdKeys {
  key(keyId: string): Promise<KeyObject | null>;
}

/** Google's published SSV keys, fetched once a day (and again for a key id not seen yet). */
export class GoogleAdKeys implements AdKeys {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = -Infinity;

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly url = ADMOB_KEYS_URL,
  ) {}

  async key(keyId: string): Promise<KeyObject | null> {
    const age = this.now() - this.fetchedAt;
    if (age > KEYS_TTL_MS || (!this.keys.has(keyId) && age > UNKNOWN_KEY_RETRY_MS)) await this.refresh();
    return this.keys.get(keyId) ?? null;
  }

  private async refresh(): Promise<void> {
    this.fetchedAt = this.now();
    const res = await this.fetchFn(this.url);
    if (!res.ok) throw new Error(`AdMob verifier keys: ${res.status}`);
    const body = (await res.json()) as { keys?: Array<{ keyId: number | string; pem: string }> };
    const keys = new Map<string, KeyObject>();
    for (const k of body.keys ?? []) keys.set(String(k.keyId), createPublicKey(k.pem));
    this.keys = keys;
  }
}

export interface SsvCallback {
  adUnit: string;
  /** Who watched: our user id, set by the app (ServerSideVerificationOptions.userId). */
  userId: string | null;
  /** What it was for, set by the app: `coins`. */
  customData: string | null;
  rewardItem: string;
  rewardAmount: number;
  transactionId: string;
  timestamp: number;
}

/**
 * Checks a callback's signature. Google signs the query string as sent, up to `&signature=`
 * (`signature` and `key_id` always come last), with ECDSA over SHA-256. Null if it doesn't verify.
 */
export async function verifySsv(rawQuery: string, keys: AdKeys): Promise<SsvCallback | null> {
  const at = rawQuery.indexOf('&signature=');
  if (at <= 0) return null;
  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  const transactionId = params.get('transaction_id');
  if (!signature || !keyId || !transactionId) return null;
  const key = await keys.key(keyId);
  if (!key) return null;
  const valid = verify(
    'sha256',
    Buffer.from(rawQuery.slice(0, at)),
    { key, dsaEncoding: 'der' },
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) return null;
  return {
    adUnit: params.get('ad_unit') ?? '',
    userId: params.get('user_id') || null,
    customData: params.get('custom_data') || null,
    rewardItem: params.get('reward_item') ?? '',
    rewardAmount: Number(params.get('reward_amount') ?? 0),
    transactionId,
    timestamp: Number(params.get('timestamp') ?? 0),
  };
}

export type AdRewardOutcome = 'granted' | 'capped' | 'duplicate' | 'not_ours';

const dayStart = (now: number) => new Date(`${watDate(now)}T00:00:00+01:00`);

async function rewardedToday(db: Pool | PoolClient, userId: string, now: number): Promise<number> {
  const row = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM ad_rewards
      WHERE user_id = $1 AND ledger_tx_id IS NOT NULL AND received_at >= $2`,
    [userId, dayStart(now)],
  );
  return Number(row.rows[0]!.n);
}

/** Rewarded videos that will still pay today. */
export async function rewardedLeft(db: Pool, userId: string, now: number): Promise<number> {
  return Math.max(0, REWARDED_DAILY_CAP - (await rewardedToday(db, userId, now)));
}

/**
 * Pays a verified callback: 25 coins (our amount, not the callback's), once per transaction,
 * up to the day's cap. Every callback for a player is kept, paid or not.
 */
export async function rewardAd(
  deps: Pick<AppDeps, 'pool' | 'clock' | 'events'>,
  cb: SsvCallback,
): Promise<AdRewardOutcome> {
  // Google's "verify URL" check, and anything not ours, carries no player or a placement we don't pay.
  if (!cb.userId || (cb.customData ?? 'coins') !== 'coins') return 'not_ours';
  const userId = cb.userId;
  const now = deps.clock.now();
  const result = await withTransaction(deps.pool, async (client) => {
    const user = await client.query<{ last_platform: EventContext['platform'] | null }>(
      "SELECT last_platform FROM users WHERE id = $1 AND status IN ('guest', 'active', 'restricted') FOR UPDATE",
      [userId],
    );
    if (!user.rows[0]) return { outcome: 'not_ours' as const };
    const platform = user.rows[0].last_platform ?? 'android';
    const paidToday = await rewardedToday(client, userId, now);
    const inserted = await client.query(
      `INSERT INTO ad_rewards (reward_ref, source, user_id, ad_unit, reward_item, reward_amount, received_at)
       VALUES ($1, 'admob_ssv', $2, $3, $4, $5, $6) ON CONFLICT (reward_ref) DO NOTHING`,
      [cb.transactionId, userId, cb.adUnit, cb.rewardItem, cb.rewardAmount, new Date(now)],
    );
    if (inserted.rowCount === 0) return { outcome: 'duplicate' as const };
    if (paidToday >= REWARDED_DAILY_CAP) return { outcome: 'capped' as const };
    const key = `ad:${cb.transactionId}`;
    const change = await grantCoins(client, userId, REWARDED_AD_COINS, {
      key,
      reason: 'rewarded_ad',
      refType: 'ad',
      refId: cb.transactionId,
      now,
    });
    await client.query(
      `UPDATE ad_rewards SET ledger_tx_id = (SELECT id FROM ledger_transactions WHERE idempotency_key = $2)
        WHERE reward_ref = $1`,
      [cb.transactionId, key],
    );
    return { outcome: 'granted' as const, change, platform };
  });
  if (result.outcome === 'granted') {
    const ctx: EventContext = { userId, platform: result.platform };
    await deps.events.emit('ad_reward_granted', { format: 'rewarded', amount: REWARDED_AD_COINS }, ctx);
    const change = result.change as CoinChange | null;
    if (change) {
      await deps.events.emit(
        'coins_changed',
        { delta: change.delta, reason: change.reason, balance_after: change.balance },
        ctx,
      );
    }
  }
  return result.outcome;
}
