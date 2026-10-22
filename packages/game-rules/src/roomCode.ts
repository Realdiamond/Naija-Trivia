/**
 * Party room codes (TRD FR-PARTY-1): 5 characters from an alphabet without look-alikes
 * (no 0/O, 1/I/L), so codes read out loud or typed from a screenshot just work.
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

/**
 * @param randomInt returns a uniform integer in [0, maxExclusive); pass a cryptographic
 *   source such as node:crypto's randomInt.
 */
export function generateRoomCode(randomInt: (maxExclusive: number) => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const index = randomInt(ROOM_CODE_ALPHABET.length);
    if (!Number.isInteger(index) || index < 0 || index >= ROOM_CODE_ALPHABET.length) {
      throw new RangeError(`randomInt returned ${index}`);
    }
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/** Tidy what a player typed ("abc de" → "ABCDE"); null if it can't be a room code. */
export function normaliseRoomCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}
