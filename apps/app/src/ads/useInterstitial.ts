/**
 * Interstitials between games (doc 11 §2): a finished duel is counted once, and when one is due
 * it shows as the player leaves the result, never during a question. In Data Saver they wait
 * for Wi-Fi (step 2.8b), and a duel played without one doesn't count towards the next.
 */
import { useCallback, useEffect, useRef } from 'react';
import { adsAvailable, prepareInterstitial, showInterstitial } from '.';
import { interstitialsAllowed } from '../features/dataSaver/rules';
import { useDataSaver } from '../features/dataSaver/store';
import { useFlag, useGameConfig } from '../features/liveops/config';
import { countMatch } from './pacing';

/** `matchKey` is null until there is a finished match to count. Returns a wrapper for leaving. */
export function useInterstitial(matchKey: string | null): (go: () => void) => Promise<void> {
  const due = useRef(false);
  // Staff can switch ads off (step 2.7c); a match then isn't counted towards one either.
  const flagOn = useFlag('ads.enabled');
  const dataOk = useDataSaver(interstitialsAllowed);
  const adsOn = flagOn && dataOk;
  const every = useGameConfig()['ads.interstitial_every_n_matches'];
  useEffect(() => {
    if (!matchKey || !adsAvailable || !adsOn) return;
    void countMatch(matchKey, every).then((isDue) => {
      if (!isDue) return;
      due.current = true;
      prepareInterstitial();
    });
  }, [matchKey, adsOn, every]);
  return useCallback(async (go: () => void) => {
    if (due.current) {
      due.current = false;
      await showInterstitial();
    }
    go();
  }, []);
}
