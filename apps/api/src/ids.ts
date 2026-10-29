/** Sortable ids: a prefix plus a ULID (48-bit time, 80 random bits, Crockford base32). */
import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(nowMs: number = Date.now()): string {
  let time = nowMs;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(16);
  let randomPart = '';
  for (let i = 0; i < 16; i++) randomPart += CROCKFORD[random[i]! % 32];
  return timePart + randomPart;
}

/** pr: a party room; pg: one game played in it; lt: a ledger transaction; pu: a purchase. */
export type IdPrefix =
  'u' | 'ai' | 'rt' | 'r' | 'd' | 'req' | 'adm' | 'q' | 'dev' | 'pr' | 'pg' | 'lt' | 'pu';

export function newId(prefix: IdPrefix, nowMs?: number): string {
  return `${prefix}_${ulid(nowMs)}`;
}
