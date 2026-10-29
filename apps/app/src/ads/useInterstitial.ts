/**
 * Interstitials between games (doc 11 §2): a finished duel is counted once, and when one is due
 * it shows as the player leaves the result, never during a question.
 */
import { useCallback, useEffect, useRef } from 'react';
import { adsAvailable, prepareInterstitial, showInterstitial } from '.';
import { useFlag } from '../features/liveops/config';
import { countMatch } from './pacing';

/** `matchKey` is null until there is a finished match to count. Returns a wrapper for leaving. */
export function useInterstitial(matchKey: string | null): (go: () => void) => Promise<void> {
  const due = useRef(false);
  // Staff can switch ads off (step 2.7c); a match then isn't counted towards one either.
  const adsOn = useFlag('ads.enabled');
  useEffect(() => {
    if (!matchKey || !adsAvailable || !adsOn) return;
    void countMatch(matchKey).then((isDue) => {
      if (!isDue) return;
      due.current = true;
      prepareInterstitial();
    });
  }, [matchKey, adsOn]);
  return useCallback(async (go: () => void) => {
    if (due.current) {
      due.current = false;
      await showInterstitial();
    }
    go();
  }, []);
}
