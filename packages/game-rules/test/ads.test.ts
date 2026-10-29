import { describe, expect, it } from 'vitest';
import { interstitialDue, REWARDED_AD_COINS, REWARDED_DAILY_CAP } from '../src/ads';

describe('ads (doc 11 §2)', () => {
  it('pays 25 coins a rewarded video, up to 10 a day', () => {
    expect([REWARDED_AD_COINS, REWARDED_DAILY_CAP]).toEqual([25, 10]);
  });

  it('shows an interstitial after every 3rd finished match', () => {
    const due = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      interstitialDue({ completedMatches: n, sessions: 2, hasPass: false }),
    );
    expect(due).toEqual([false, false, true, false, false, true, false]);
  });

  it('never in the first session, and never for the Sabi Pass', () => {
    expect(interstitialDue({ completedMatches: 3, sessions: 1, hasPass: false })).toBe(false);
    expect(interstitialDue({ completedMatches: 3, sessions: 5, hasPass: true })).toBe(false);
    expect(interstitialDue({ completedMatches: 0, sessions: 5, hasPass: false })).toBe(false);
    expect(interstitialDue({ completedMatches: 4, sessions: 5, hasPass: false, every: 4 })).toBe(true);
  });
});
