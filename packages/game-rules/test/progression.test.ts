import { describe, expect, it } from 'vitest';
import { levelForXp, xpToNextLevel } from '../src/progression';

describe('levels', () => {
  it('follows 200 × level^1.4', () => {
    expect(xpToNextLevel(1)).toBe(200);
    expect(xpToNextLevel(2)).toBe(528);
    expect(xpToNextLevel(10)).toBe(5024);
  });

  it('turns total XP into a level and progress', () => {
    expect(levelForXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 200 });
    expect(levelForXp(199)).toEqual({ level: 1, xpIntoLevel: 199, xpForNextLevel: 200 });
    expect(levelForXp(200)).toEqual({ level: 2, xpIntoLevel: 0, xpForNextLevel: 528 });
    expect(levelForXp(200 + 528 + 5)).toMatchObject({ level: 3, xpIntoLevel: 5 });
  });

  it('rejects invalid input', () => {
    expect(() => xpToNextLevel(0)).toThrow(RangeError);
    expect(() => levelForXp(-1)).toThrow(RangeError);
  });
});
