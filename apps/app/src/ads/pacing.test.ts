import { beforeEach, describe, expect, it } from 'vitest';
import { countMatch, countSession } from './pacing';

// The web build's storage is localStorage; a Map stands in for it here.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

describe('interstitial pacing (step 2.4c)', () => {
  beforeEach(() => store.clear());

  it('never in the first session', async () => {
    await countSession();
    const due = [];
    for (let i = 1; i <= 6; i++) due.push(await countMatch(`duel:${i}`));
    expect(due).toEqual([false, false, false, false, false, false]);
  });

  it('after every 3rd finished duel from the second session, each duel counted once', async () => {
    await countSession();
    await countSession();
    expect(await countMatch('duel:a')).toBe(false);
    expect(await countMatch('duel:b')).toBe(false);
    // Opening an old result again counts nothing.
    expect(await countMatch('duel:b')).toBe(false);
    expect(await countMatch('duel:c')).toBe(true);
    expect(await countMatch('duel:c')).toBe(false);
    expect(await countMatch('duel:d')).toBe(false);
  });
});
