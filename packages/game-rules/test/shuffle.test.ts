import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  displayOrder,
  optionPermutation,
  shuffleSeed,
  toCanonicalIndex,
  toDisplayIndex,
} from '../src/shuffle';

describe('optionPermutation', () => {
  it('is always a permutation of 0..n-1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (n, seed) => {
        const perm = optionPermutation(n, seed);
        expect([...perm].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      }),
    );
  });

  it('is deterministic for the same match, player and question', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (match, user, qid) => {
        const seed = shuffleSeed(match, user, qid);
        expect(optionPermutation(4, seed)).toEqual(optionPermutation(4, shuffleSeed(match, user, qid)));
      }),
    );
  });

  it('gives the two duel players different orders for most questions', () => {
    let same = 0;
    for (let q = 0; q < 1000; q++) {
      const a = optionPermutation(4, shuffleSeed('d_1', 'u_tolu', `q_${q}`));
      const b = optionPermutation(4, shuffleSeed('d_1', 'u_chidi', `q_${q}`));
      if (a.join() === b.join()) same++;
    }
    // 24 possible orders, so about 1 in 24 match by chance.
    expect(same).toBeLessThan(80);
  });

  it('puts the correct answer in each position about equally often', () => {
    const counts = [0, 0, 0, 0];
    const trials = 40_000;
    for (let i = 0; i < trials; i++) {
      const perm = optionPermutation(4, shuffleSeed('m', `u_${i}`, 'q'));
      counts[toDisplayIndex(perm, 0)]!++;
    }
    for (const c of counts) expect(Math.abs(c / trials - 0.25)).toBeLessThan(0.01);
  });
});

describe('index mapping', () => {
  it('round-trips between display and canonical indexes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (n, seed) => {
        const perm = optionPermutation(n, seed);
        for (let d = 0; d < n; d++) expect(toDisplayIndex(perm, toCanonicalIndex(perm, d))).toBe(d);
      }),
    );
  });

  it('shows the options in permutation order', () => {
    expect(displayOrder(['A', 'B', 'C', 'D'], [2, 0, 3, 1])).toEqual(['C', 'A', 'D', 'B']);
    expect(toCanonicalIndex([2, 0, 3, 1], 0)).toBe(2);
    expect(toDisplayIndex([2, 0, 3, 1], 0)).toBe(1);
  });

  it('rejects out-of-range indexes', () => {
    expect(() => toCanonicalIndex([0, 1], 2)).toThrow(RangeError);
    expect(() => toDisplayIndex([0, 1], 5)).toThrow(RangeError);
    expect(() => optionPermutation(0, 1n)).toThrow(RangeError);
  });
});
