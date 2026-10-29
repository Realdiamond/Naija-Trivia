import { describe, expect, it } from 'vitest';
import { variantFor, type Experiment } from '../src/experiments';

const exp = (over: Partial<Experiment> = {}): Experiment => ({
  key: 'taste.length',
  status: 'running',
  variants: [
    { key: 'three', weight: 50 },
    { key: 'five', weight: 50 },
  ],
  audience: { percent: 100 },
  ...over,
});

const players = Array.from({ length: 2000 }, (_, i) => `u_${i}`);

describe('experiments', () => {
  it('keeps a player in one variant, and splits players by weight', () => {
    const e = exp();
    expect(variantFor(e, { userId: 'u_7', platform: 'web' })).toBe(
      variantFor(e, { userId: 'u_7', platform: 'android' }),
    );
    const counts = { three: 0, five: 0 };
    for (const p of players) counts[variantFor(e, { userId: p }) as 'three' | 'five'] += 1;
    expect(counts.three).toBeGreaterThan(900);
    expect(counts.five).toBeGreaterThan(900);

    const skewed = exp({
      variants: [
        { key: 'a', weight: 90 },
        { key: 'b', weight: 10 },
      ],
    });
    const b = players.filter((p) => variantFor(skewed, { userId: p }) === 'b').length;
    expect(b).toBeGreaterThan(120);
    expect(b).toBeLessThan(280);
  });

  it('takes only the share and the players it is for, and only while running', () => {
    const half = exp({ audience: { percent: 50 } });
    const inIt = players.filter((p) => variantFor(half, { userId: p }) !== null).length;
    expect(inIt).toBeGreaterThan(900);
    expect(inIt).toBeLessThan(1100);

    const phones = exp({ audience: { percent: 100, platforms: ['android'], min_app_version: '1.2.0' } });
    expect(variantFor(phones, { userId: 'u_1', platform: 'web', appVersion: '1.3.0' })).toBeNull();
    expect(variantFor(phones, { userId: 'u_1', platform: 'android', appVersion: '1.1.9' })).toBeNull();
    expect(variantFor(phones, { userId: 'u_1', platform: 'android', appVersion: null })).toBeNull();
    expect(variantFor(phones, { userId: 'u_1', platform: 'android', appVersion: '1.2.0' })).not.toBeNull();

    expect(variantFor(exp({ status: 'draft' }), { userId: 'u_1' })).toBeNull();
    expect(variantFor(exp({ status: 'stopped' }), { userId: 'u_1' })).toBeNull();
    expect(variantFor(exp(), { userId: null })).toBeNull();
  });
});
