/**
 * The banner under a result (doc 11 §2, build plan step 2.8b): on results screens only, never
 * during a question; not in Data Saver; gone when staff switch ads off (step 2.7c). Requests are
 * non-personalised and rated PG like the other ads. Without our own unit id in the build,
 * Google's test banner shows.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { bannerAllowed } from '../features/dataSaver/rules';
import { useDataSaver } from '../features/dataSaver/store';
import { useFlag } from '../features/liveops/config';
import { startAds } from '.';

const BANNER_UNIT = process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT || TestIds.ADAPTIVE_BANNER;

export function ResultsBanner() {
  const flagOn = useFlag('ads.enabled');
  const dataOk = useDataSaver(bannerAllowed);
  const allowed = flagOn && dataOk;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    startAds()
      .then(() => live && setReady(true))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [allowed]);
  if (!allowed || !ready || failed) return null;
  return (
    <View style={styles.slot} testID="results-banner">
      <BannerAd
        unitId={BANNER_UNIT}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({ slot: { alignItems: 'center', marginVertical: 12 } });
