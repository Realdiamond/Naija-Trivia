/** Keyboard play (TRD FR-WEB-5), kept free of React Native so it runs in unit tests. */

/** The option a key picks: 1–4 or A–D (either case), or null for any other key. */
export function optionForKey(key: string): number | null {
  if (/^[1-4]$/.test(key)) return Number(key) - 1;
  if (/^[a-d]$/i.test(key)) return key.toLowerCase().charCodeAt(0) - 97;
  return null;
}
