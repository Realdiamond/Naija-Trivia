/**
 * Ads (doc 11 §2, TRD FR-ECO-2): rewarded videos the player chooses to watch, and an interstitial
 * between games, never during a question.
 */
import { DEFAULT_CONFIG } from './config';

/** What one rewarded video pays (granted only on AdMob's server-side verification). */
export const REWARDED_AD_COINS = DEFAULT_CONFIG['econ.rewarded_ad_coins'];
/** Rewarded videos that pay, per player per WAT day; more still play but pay nothing. */
export const REWARDED_DAILY_CAP = DEFAULT_CONFIG['ads.rewarded_daily_cap'];

export interface InterstitialInput {
  /** Matches finished on this device, counting the one just finished. */
  completedMatches: number;
  /** Times the app was opened on this device, counting this one. */
  sessions: number;
  /** The Sabi Pass (v1.1) means no interstitials. */
  hasPass: boolean;
  every?: number;
}

/**
 * An interstitial after every 3rd finished match, never in the player's first session and never
 * for Sabi Pass holders (doc 11 §2).
 */
export function interstitialDue({
  completedMatches,
  sessions,
  hasPass,
  every = DEFAULT_CONFIG['ads.interstitial_every_n_matches'],
}: InterstitialInput): boolean {
  if (hasPass || sessions <= 1 || completedMatches <= 0) return false;
  return completedMatches % every === 0;
}
