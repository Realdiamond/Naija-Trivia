/**
 * Buying coin packs on phones (build plan step 2.4d) through RevenueCat, which checks the
 * receipt with Google Play and tells our server (TRD FR-ECO-3). Purchases are made under the
 * player's own id, so the coins go to them. Without EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (a public
 * SDK key) the store stays closed.
 */
import { Platform } from 'react-native';
import Purchases, { PRODUCT_CATEGORY, type PurchasesStoreProduct } from 'react-native-purchases';

export type BuyOutcome = 'bought' | 'cancelled' | 'failed' | 'unavailable';

const API_KEY =
  Platform.OS === 'android'
    ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;

export const storeAvailable = Boolean(API_KEY);

let configuredFor: string | null = null;
const products = new Map<string, PurchasesStoreProduct>();

export async function startStore(userId: string): Promise<void> {
  if (!API_KEY || configuredFor === userId) return;
  if (configuredFor === null) Purchases.configure({ apiKey: API_KEY, appUserID: userId });
  else await Purchases.logIn(userId);
  configuredFor = userId;
}

export async function storePrices(skus: readonly string[]): Promise<Record<string, string>> {
  if (!configuredFor) return {};
  try {
    const found = await Purchases.getProducts([...skus], PRODUCT_CATEGORY.NON_SUBSCRIPTION);
    const prices: Record<string, string> = {};
    for (const p of found) {
      products.set(p.identifier, p);
      prices[p.identifier] = p.priceString;
    }
    return prices;
  } catch {
    return {};
  }
}

export async function buy(sku: string): Promise<BuyOutcome> {
  const product = products.get(sku);
  if (!configuredFor || !product) return 'unavailable';
  try {
    await Purchases.purchaseStoreProduct(product);
    return 'bought';
  } catch (e) {
    return (e as { userCancelled?: boolean | null }).userCancelled ? 'cancelled' : 'failed';
  }
}
