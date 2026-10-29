import { describe, expect, it } from 'vitest';
import { nextPracticeGame, practiceXp } from '../src/practice';

describe('practice XP', () => {
  it('pays per answer and for finishing', () => {
    expect(practiceXp(10, 10, true)).toBe(150);
    expect(practiceXp(7, 10, true)).toBe(70 + 6 + 50);
    expect(practiceXp(0, 10, true)).toBe(70);
  });

  it('pays nothing for finishing a game left early', () => {
    expect(practiceXp(3, 4, false)).toBe(32);
  });
});

describe('the next practice game', () => {
  const set = ['a', 'b', 'c', 'd', 'e'];

  it('starts at the top of the set', () => {
    expect(nextPracticeGame(set, {}, 3)).toEqual(['a', 'b', 'c']);
  });

  it('goes round the whole set before repeating a question', () => {
    expect(nextPracticeGame(set, { a: 1, b: 1, c: 1 }, 3)).toEqual(['d', 'e', 'a']);
    expect(nextPracticeGame(set, { a: 2, b: 1, c: 1, d: 1, e: 1 }, 3)).toEqual(['b', 'c', 'd']);
  });

  it('gives what there is when the set is short', () => {
    expect(nextPracticeGame(['a', 'b'], {}, 10)).toEqual(['a', 'b']);
  });
});
