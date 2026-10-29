import { describe, expect, it } from 'vitest';
import { bannerAllowed, dataSaverOn, interstitialsAllowed } from './rules';

describe('Data Saver (step 2.8b)', () => {
  it('follows the connection until the player chooses', () => {
    expect(dataSaverOn({ choice: null, slow: true, wifi: false })).toBe(true);
    expect(dataSaverOn({ choice: null, slow: false, wifi: false })).toBe(false);
    expect(dataSaverOn({ choice: false, slow: true, wifi: false })).toBe(false);
    expect(dataSaverOn({ choice: true, slow: false, wifi: true })).toBe(true);
  });

  it('keeps ads between games for Wi-Fi and the banner off', () => {
    const on = { choice: true, slow: false, wifi: false };
    expect([interstitialsAllowed(on), bannerAllowed(on)]).toEqual([false, false]);
    expect([interstitialsAllowed({ ...on, wifi: true }), bannerAllowed({ ...on, wifi: true })]).toEqual([
      true,
      false,
    ]);
    const off = { choice: false, slow: true, wifi: false };
    expect([interstitialsAllowed(off), bannerAllowed(off)]).toEqual([true, true]);
  });
});
