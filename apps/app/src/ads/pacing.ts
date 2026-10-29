/**
 * When an interstitial is due (doc 11 §2): after every 3rd finished duel, never in the first
 * session on this device. Counted on the device, like the session itself; a duel counts once
 * however often its result is opened.
 */
import { interstitialDue } from '@whosabi/game-rules';
import { storage } from '../platform/storage';

const KEY = 'whosabi.ads';
/** Duels already counted, newest last. */
const REMEMBERED = 50;

interface Counts {
  sessions: number;
  matches: number;
  counted: string[];
}

async function read(): Promise<Counts> {
  try {
    const raw = await storage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Counts>) : {};
    return {
      sessions: Number(parsed.sessions) || 0,
      matches: Number(parsed.matches) || 0,
      counted: Array.isArray(parsed.counted) ? parsed.counted.slice(-REMEMBERED) : [],
    };
  } catch {
    return { sessions: 0, matches: 0, counted: [] };
  }
}

const write = (counts: Counts) => storage.setItem(KEY, JSON.stringify(counts));

/** How many times the app has started on this device, this one included. */
export async function sessionsHere(): Promise<number> {
  return (await read()).sessions;
}

/** Once each time the app starts. */
export async function countSession(): Promise<void> {
  const counts = await read();
  await write({ ...counts, sessions: counts.sessions + 1 });
}

/** A finished duel's result is on screen: true when an interstitial is due as the player leaves it. */
export async function countMatch(key: string, every?: number): Promise<boolean> {
  const counts = await read();
  if (counts.counted.includes(key)) return false;
  const next = {
    ...counts,
    matches: counts.matches + 1,
    counted: [...counts.counted, key].slice(-REMEMBERED),
  };
  await write(next);
  return interstitialDue({ completedMatches: next.matches, sessions: next.sessions, hasPass: false, every });
}
