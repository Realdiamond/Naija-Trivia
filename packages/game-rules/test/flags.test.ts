import { describe, expect, it } from 'vitest';
import { compareVersions, flagBucket, flagOn, type Flag } from '../src/flags';

const flag = (rules: Flag['rules'], enabled = true): Flag => ({ key: 'party.enabled', enabled, rules });

describe('flags', () => {
  it('compares app versions number by number', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
    expect(compareVersions('dev', '1.0.0')).toBeNull();
  });

  it('is off for everyone when switched off, and on for everyone with no rules', () => {
    expect(flagOn(flag([], false), { userId: 'u1', platform: 'android' })).toBe(false);
    expect(flagOn(flag([{ platform: 'web' }], false), { platform: 'web' })).toBe(false);
    expect(flagOn(flag([]), {})).toBe(true);
  });

  it('matches a rule by platform and minimum app version', () => {
    const f = flag([{ platform: 'android', min_app_version: '1.2.0' }]);
    expect(flagOn(f, { platform: 'android', appVersion: '1.2.1' })).toBe(true);
    expect(flagOn(f, { platform: 'android', appVersion: '1.1.9' })).toBe(false);
    expect(flagOn(f, { platform: 'android' })).toBe(false);
    expect(flagOn(f, { platform: 'web', appVersion: '2.0.0' })).toBe(false);
    // Any rule will do.
    expect(flagOn(flag([{ platform: 'ios' }, { platform: 'web' }]), { platform: 'web' })).toBe(true);
  });

  it('gives a stable share of players by percent, and none without a signed-in player', () => {
    const f = flag([{ percent: 30 }]);
    const ids = Array.from({ length: 2000 }, (_, i) => `u_${i}`);
    const on = ids.filter((id) => flagOn(f, { userId: id })).length;
    expect(on / ids.length).toBeGreaterThan(0.26);
    expect(on / ids.length).toBeLessThan(0.34);
    expect(flagOn(f, { userId: 'u_7' })).toBe(flagOn(f, { userId: 'u_7' }));
    expect(flagOn(f, {})).toBe(false);
    expect(flagOn(flag([{ percent: 100 }]), {})).toBe(true);
    expect(flagOn(flag([{ percent: 0 }]), { userId: 'u_1' })).toBe(false);
    // Different flags bucket the same player independently.
    const buckets = new Set(['a', 'b', 'c', 'd', 'e'].map((k) => flagBucket(k, 'u_1')));
    expect(buckets.size).toBeGreaterThan(1);
  });
});
