/**
 * Ads (doc 11 §2, build plan step 2.4c). The web plays ad-free until v1.1 (TRD FR-WEB-1), so
 * here nothing shows; phones use index.native.ts.
 */
export type RewardedOutcome = 'earned' | 'closed' | 'failed' | 'unavailable';

/** Whether this build can show ads at all. */
export const adsAvailable = false;

/** Shows a rewarded video. The coins arrive through AdMob's callback to our server, not from here. */
export async function showRewarded(_userId: string): Promise<RewardedOutcome> {
  return 'unavailable';
}

/** Gets an interstitial ready, so showing it later doesn't keep the player waiting. */
export function prepareInterstitial(): void {}

/** Shows the interstitial if one is ready; false otherwise. */
export async function showInterstitial(): Promise<boolean> {
  return false;
}
