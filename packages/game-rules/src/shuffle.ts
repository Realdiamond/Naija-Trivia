/**
 * Per-player option order (TRD §5.4): both duel players get the same questions, but
 * each sees the options in their own order. The order is a pure function of
 * (match, player, question), so it never has to be stored to be checked later.
 */
import { xxh64 } from './hash';

const MASK64 = 0xffffffffffffffffn;

/** Seed = xxHash64 of "matchId|userId|questionId". */
export function shuffleSeed(matchId: string, userId: string, questionId: string): bigint {
  return xxh64(`${matchId}|${userId}|${questionId}`);
}

/**
 * A permutation of 0..n-1 where `perm[displayIndex] = canonicalIndex`.
 * Fisher–Yates driven by SplitMix64.
 */
export function optionPermutation(n: number, seed: bigint): number[] {
  if (!Number.isInteger(n) || n < 1 || n > 16)
    throw new RangeError(`n must be an integer from 1 to 16, got ${n}`);
  const perm = Array.from({ length: n }, (_, i) => i);
  const next = splitMix64(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Number(next() % BigInt(i + 1));
    const tmp = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = tmp;
  }
  return perm;
}

/** The options in the order this player sees them. */
export function displayOrder<T>(canonical: readonly T[], perm: readonly number[]): T[] {
  if (canonical.length !== perm.length) throw new RangeError('permutation length does not match options');
  return perm.map((c) => canonical[c]!);
}

/** Map the index the player tapped back to the canonical option index. */
export function toCanonicalIndex(perm: readonly number[], displayIndex: number): number {
  const canonical = perm[displayIndex];
  if (canonical === undefined) throw new RangeError(`display index ${displayIndex} is out of range`);
  return canonical;
}

/** Where a canonical option appears for this player (e.g. to highlight the right answer). */
export function toDisplayIndex(perm: readonly number[], canonicalIndex: number): number {
  const display = perm.indexOf(canonicalIndex);
  if (display === -1) throw new RangeError(`canonical index ${canonicalIndex} is out of range`);
  return display;
}

function splitMix64(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  };
}
