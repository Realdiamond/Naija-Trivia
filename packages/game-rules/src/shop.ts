/**
 * Coin packs (doc 11 §3), bought through Google Play (and the App Store later) via RevenueCat.
 * The server credits the coins for the pack bought, never an amount the store or app reports.
 * Prices are Naira list prices; what the player pays is the store's price for their country.
 */

export interface CoinPack {
  sku: string;
  coins: number;
  /** Extra coins against the smallest pack's rate, in percent. */
  bonus_pct: number;
  price_ngn: number;
}

export const COIN_PACKS: readonly CoinPack[] = [
  { sku: 'coins_small', coins: 500, bonus_pct: 0, price_ngn: 300 },
  { sku: 'coins_medium', coins: 1500, bonus_pct: 20, price_ngn: 800 },
  { sku: 'coins_large', coins: 3500, bonus_pct: 40, price_ngn: 1500 },
  { sku: 'coins_mega', coins: 9000, bonus_pct: 60, price_ngn: 3500 },
];

export function coinPack(sku: string): CoinPack | null {
  return COIN_PACKS.find((p) => p.sku === sku) ?? null;
}

/** The share of a store sale we keep (Play and the App Store small-business rate). */
export const STORE_TAKEHOME = 0.85;
