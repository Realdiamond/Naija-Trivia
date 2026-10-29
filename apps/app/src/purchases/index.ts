/**
 * Buying coin packs (build plan step 2.4d). The web pays through Paystack in v1.1, so here the
 * store is closed; phones use index.native.ts (Google Play through RevenueCat).
 */
export type BuyOutcome = 'bought' | 'cancelled' | 'failed' | 'unavailable';

/** Whether this build can buy anything. */
export const storeAvailable = false;

/** Ties purchases to the signed-in player, so the server knows whose coins they are. */
export async function startStore(_userId: string): Promise<void> {}

/** The store's own price for each pack (in the player's currency), by sku. */
export async function storePrices(_skus: readonly string[]): Promise<Record<string, string>> {
  return {};
}

/** Buys a pack. The coins arrive through RevenueCat's call to our server, not from here. */
export async function buy(_sku: string): Promise<BuyOutcome> {
  return 'unavailable';
}
