/** Data Saver's decisions, kept apart from React Native so they can be unit tested. */
export interface DataSaverState {
  /** The player's choice; null for automatic. */
  choice: boolean | null;
  /** The phone or browser says data is tight (Save-Data, 2G or 3G). */
  slow: boolean;
  /** On Wi-Fi, where data doesn't cost the player. */
  wifi: boolean;
}

/** Their own choice when they made one; otherwise on when data is tight. */
export function dataSaverOn(state: DataSaverState): boolean {
  return state.choice ?? state.slow;
}

/** Ads between games: in Data Saver only on Wi-Fi (PRD F15 AC2). */
export function interstitialsAllowed(state: DataSaverState): boolean {
  return !dataSaverOn(state) || state.wifi;
}

/** The results banner: never in Data Saver (doc 11 §2). */
export function bannerAllowed(state: DataSaverState): boolean {
  return !dataSaverOn(state);
}
