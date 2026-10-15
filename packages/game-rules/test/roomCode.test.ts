import { describe, expect, it } from 'vitest';
import { generateRoomCode, normaliseRoomCode, ROOM_CODE_ALPHABET } from '../src/roomCode';

describe('room codes', () => {
  it('uses 5 characters with no look-alikes', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    let seed = 7;
    const code = generateRoomCode((max) => (seed = (seed * 31 + 11) % 1009) % max);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/);
  });

  it('accepts sloppy typing and rejects impossible codes', () => {
    expect(normaliseRoomCode(' abc-de ')).toBe('ABCDE');
    expect(normaliseRoomCode('AB0DE')).toBeNull();
    expect(normaliseRoomCode('ABCD')).toBeNull();
  });

  it('refuses a broken random source', () => {
    expect(() => generateRoomCode(() => 99)).toThrow(RangeError);
  });
});
