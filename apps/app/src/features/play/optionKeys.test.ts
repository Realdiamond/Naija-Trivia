import { describe, expect, it } from 'vitest';
import { optionForKey } from './optionKeys';

describe('optionForKey', () => {
  it('maps 1–4 and A–D to the four options', () => {
    expect(['1', '2', '3', '4'].map(optionForKey)).toEqual([0, 1, 2, 3]);
    expect(['a', 'B', 'c', 'D'].map(optionForKey)).toEqual([0, 1, 2, 3]);
  });

  it('ignores every other key', () => {
    for (const key of ['0', '5', 'e', 'Enter', 'Escape', 'ArrowDown', ' ', '11']) {
      expect(optionForKey(key)).toBeNull();
    }
  });
});
