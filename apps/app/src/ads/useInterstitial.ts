/**
 * Interstitials between games (doc 11 §2): a finished duel is counted once, and when one is due
 * it shows as the player leaves the result, never during a question.
 */
import { useCallback, useEffect, useRef } from 'react';
import { adsAvailable, prepareInterstitial, showInterstitial } from '.';
import { countMatch } from './pacing';

/** `matchKey` is null until there is a finished match to count. Returns a wrapper for leaving. */
export function useInterstitial(matchKey: string | null): (go: () => void) => Promise<void> {
  const due = useRef(false);
  useEffect(() => {
    if (!matchKey || !adsAvailable) return;
    void countMatch(matchKey).then((isDue) => {
      if (!isDue) return;
      due.current = true;
      prepareInterstitial();
    });
  }, [matchKey]);
  return useCallback(async (go: () => void) => {
    if (due.current) {
      due.current = false;
      await showInterstitial();
    }
    go();
  }, []);
}
