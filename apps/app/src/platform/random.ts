import { getRandomBytes } from 'expo-crypto';

/** URL-safe random id from 24 random bytes (32 characters), e.g. the device id (doc 09 §2.1). */
export function randomId(bytes = 24): string {
  const raw = getRandomBytes(bytes);
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random (version 4) UUID, e.g. a practice game's id. */
export function randomUuid(): string {
  const b = getRandomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
