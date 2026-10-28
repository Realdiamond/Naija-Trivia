import { getRandomBytes } from 'expo-crypto';

/** URL-safe random id from 24 random bytes (32 characters), e.g. the device id (doc 09 §2.1). */
export function randomId(bytes = 24): string {
  const raw = getRandomBytes(bytes);
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
