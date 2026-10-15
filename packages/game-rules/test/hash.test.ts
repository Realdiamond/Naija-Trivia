import { describe, expect, it } from 'vitest';
import { utf8Bytes, xxh64Hex } from '../src/hash';

// Reference values from the official xxhash implementation (python-xxhash).
const VECTORS: Array<[string | Uint8Array, bigint, string]> = [
  ['', 0n, 'ef46db3751d8e999'],
  ['a', 0n, 'd24ec4f1a98c6e5b'],
  ['abc', 0n, '44bc2cf5ad770999'],
  ['xxhash', 20141025n, 'b559b98d844e0635'],
  ['Nobody inspects the spammish repetition', 0n, 'fbcea83c8a378bf1'],
  ['Ọmọ Naija sabi! 🇳🇬', 0n, 'c679cab6543f9cdf'],
  ['d_01J9|u_123|q_seed-0024', 0n, 'd28c41948c4bec55'],
  [Uint8Array.from({ length: 100 }, (_, i) => i), 7n, '80653e7e9b887cdd'],
];

describe('xxh64', () => {
  it.each(VECTORS)('matches the reference for %j (seed %s)', (input, seed, expected) => {
    expect(xxh64Hex(input, seed)).toBe(expected);
  });
});

describe('utf8Bytes', () => {
  it('encodes like TextEncoder, including emoji and lone surrogates', () => {
    for (const text of ['abc', 'Ọmọ', '₦1,200', '🇳🇬 Naija', 'lone \ud800 surrogate', '']) {
      expect(Array.from(utf8Bytes(text))).toEqual(Array.from(new TextEncoder().encode(text)));
    }
  });
});
