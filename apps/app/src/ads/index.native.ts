/**
 * Ads on phones (doc 11 §2, build plan step 2.4c), through Google AdMob. Requests are always
 * for non-personalised ads (the consent banner promises no ad tracking) rated PG; gambling ads
 * are blocked in the AdMob console too (doc 11 §7). Without our own ad unit ids in the build,
 * Google's test units show.
 */
import mobileAds, {
  AdEventType,
  InterstitialAd,
  MaxAdContentRating,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

export type RewardedOutcome = 'earned' | 'closed' | 'failed' | 'unavailable';

const REWARDED_UNIT = process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT || TestIds.REWARDED;
const INTERSTITIAL_UNIT = process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_UNIT || TestIds.INTERSTITIAL;
const REQUEST = { requestNonPersonalizedAdsOnly: true };

export const adsAvailable = true;

let started: Promise<unknown> | null = null;
/** Sets the content rating and starts the SDK, once; every ad waits for it. */
export function startAds(): Promise<unknown> {
  started ??= mobileAds()
    .setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.PG })
    .then(() => mobileAds().initialize());
  return started;
}

export async function showRewarded(userId: string): Promise<RewardedOutcome> {
  try {
    await startAds();
  } catch {
    return 'failed';
  }
  // Our server pays when AdMob calls it back with this user id (TRD FR-ECO-2).
  const ad = RewardedAd.createForAdRequest(REWARDED_UNIT, {
    ...REQUEST,
    serverSideVerificationOptions: { userId, customData: 'coins' },
  });
  return new Promise((resolve) => {
    let earned = false;
    const offs = [
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => void ad.show().catch(() => finish('failed'))),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned ? 'earned' : 'closed')),
      ad.addAdEventListener(AdEventType.ERROR, () => finish('failed')),
    ];
    function finish(outcome: RewardedOutcome) {
      offs.forEach((off) => off());
      resolve(outcome);
    }
    ad.load();
  });
}

let interstitial: InterstitialAd | null = null;
let interstitialReady = false;

export function prepareInterstitial(): void {
  if (interstitial) return;
  void startAds()
    .then(() => {
      const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT, REQUEST);
      interstitial = ad;
      ad.addAdEventListener(AdEventType.LOADED, () => {
        interstitialReady = true;
      });
      ad.addAdEventListener(AdEventType.ERROR, () => {
        interstitial = null;
        interstitialReady = false;
      });
      ad.load();
    })
    .catch(() => undefined);
}

export async function showInterstitial(): Promise<boolean> {
  const ad = interstitial;
  if (!ad || !interstitialReady) return false;
  interstitial = null;
  interstitialReady = false;
  try {
    await ad.show();
    return true;
  } catch {
    return false;
  }
}
