/**
 * xxHash64 (XXH64) in plain TypeScript with BigInt, so the same code runs on Node,
 * Hermes and browsers. Used for deterministic option shuffles (TRD §5.4).
 * Checked against the reference implementation in test/hash.test.ts.
 */

const MASK64 = 0xffffffffffffffffn;
const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;

/** UTF-8 bytes of a string; lone surrogates become U+FFFD, as TextEncoder does. */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

export function xxh64(input: string | Uint8Array, seed: bigint = 0n): bigint {
  const b = typeof input === 'string' ? utf8Bytes(input) : input;
  const len = b.length;
  const s = seed & MASK64;
  let i = 0;
  let h: bigint;

  if (len >= 32) {
    let v1 = (s + P1 + P2) & MASK64;
    let v2 = (s + P2) & MASK64;
    let v3 = s;
    let v4 = (s - P1) & MASK64;
    do {
      v1 = round(v1, readU64(b, i));
      v2 = round(v2, readU64(b, i + 8));
      v3 = round(v3, readU64(b, i + 16));
      v4 = round(v4, readU64(b, i + 24));
      i += 32;
    } while (i <= len - 32);
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK64;
    h = mergeRound(h, v1);
    h = mergeRound(h, v2);
    h = mergeRound(h, v3);
    h = mergeRound(h, v4);
  } else {
    h = (s + P5) & MASK64;
  }

  h = (h + BigInt(len)) & MASK64;
  while (i + 8 <= len) {
    h ^= round(0n, readU64(b, i));
    h = (rotl(h, 27n) * P1 + P4) & MASK64;
    i += 8;
  }
  if (i + 4 <= len) {
    h ^= (readU32(b, i) * P1) & MASK64;
    h = (rotl(h, 23n) * P2 + P3) & MASK64;
    i += 4;
  }
  while (i < len) {
    h ^= (BigInt(b[i]!) * P5) & MASK64;
    h = (rotl(h, 11n) * P1) & MASK64;
    i += 1;
  }

  h ^= h >> 33n;
  h = (h * P2) & MASK64;
  h ^= h >> 29n;
  h = (h * P3) & MASK64;
  h ^= h >> 32n;
  return h;
}

/** xxHash64 as 16 lowercase hex characters. */
export function xxh64Hex(input: string | Uint8Array, seed: bigint = 0n): string {
  return xxh64(input, seed).toString(16).padStart(16, '0');
}

function rotl(x: bigint, r: bigint): bigint {
  return ((x << r) | (x >> (64n - r))) & MASK64;
}

function round(acc: bigint, lane: bigint): bigint {
  const a = (acc + lane * P2) & MASK64;
  return (rotl(a, 31n) * P1) & MASK64;
}

function mergeRound(acc: bigint, val: bigint): bigint {
  return ((acc ^ round(0n, val)) * P1 + P4) & MASK64;
}

function readU32(b: Uint8Array, i: number): bigint {
  return BigInt((b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0);
}

function readU64(b: Uint8Array, i: number): bigint {
  return (readU32(b, i + 4) << 32n) | readU32(b, i);
}
