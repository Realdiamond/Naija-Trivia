/**
 * Practice kept on the device (GDD §2.6, UX §4 "Offline", build plan step 2.8g): each opened
 * pack's practice set (questions with their answers), how often each question has been played
 * here, and finished games waiting to be sent. It survives restarts and no network, and goes on
 * sign-out. A guest who signs in keeps it: the server moves their sets into the account.
 */
import { create } from 'zustand';
import {
  routes,
  type PackSummary,
  type PracticeResultRequest,
  type PracticeResultResponse,
  type PracticeSet,
} from '@whosabi/shared-types';
import { api } from '../../api';
import { storage } from '../../platform/storage';
import { keepForRetry } from './game';

const KEY = 'whosabi.practice';

export interface SavedPack {
  pack: PackSummary;
  set: PracticeSet;
}

interface Saved {
  packs: Record<string, SavedPack>;
  /** Times each question was played here, so a game goes round the whole set. */
  plays: Record<string, number>;
  /** Finished games not sent yet, oldest first. */
  queue: PracticeResultRequest[];
}

export const usePractice = create<Saved & { loaded: boolean }>(() => ({
  loaded: false,
  packs: {},
  plays: {},
  queue: [],
}));

function persist(): void {
  const { packs, plays, queue } = usePractice.getState();
  void storage.setItem(KEY, JSON.stringify({ packs, plays, queue } satisfies Saved));
}

/** Reads what this device kept, once. */
export async function loadPractice(): Promise<void> {
  if (usePractice.getState().loaded) return;
  try {
    const raw = await storage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    usePractice.setState({
      loaded: true,
      packs: saved.packs ?? {},
      plays: saved.plays ?? {},
      queue: saved.queue ?? [],
    });
  } catch {
    usePractice.setState({ loaded: true });
  }
}

export function savePack(pack: PackSummary, set: PracticeSet): void {
  usePractice.setState((s) => ({ packs: { ...s.packs, [pack.id]: { pack, set } } }));
  persist();
}

/** A finished (or abandoned) game: its questions count as played, and it waits to be sent. */
export function recordGame(result: PracticeResultRequest): void {
  usePractice.setState((s) => {
    const plays = { ...s.plays };
    for (const a of result.answers) plays[a.qid] = (plays[a.qid] ?? 0) + 1;
    return { plays, queue: [...s.queue.filter((r) => r.id !== result.id), result] };
  });
  persist();
}

let sending: Promise<Map<string, PracticeResultResponse>> | null = null;

/**
 * Sends the waiting games, oldest first. One that the server turns down for good is dropped;
 * when the network or the server fails, the rest wait for next time. Returns what each paid.
 */
export function sendQueued(): Promise<Map<string, PracticeResultResponse>> {
  sending ??= (async () => {
    const paid = new Map<string, PracticeResultResponse>();
    await loadPractice();
    for (const result of [...usePractice.getState().queue]) {
      try {
        paid.set(result.id, await api.post<PracticeResultResponse>(routes.practiceResults(), result));
      } catch (e) {
        if (keepForRetry(e)) break;
      }
      usePractice.setState((s) => ({ queue: s.queue.filter((r) => r.id !== result.id) }));
      persist();
    }
    return paid;
  })().finally(() => {
    sending = null;
  });
  return sending;
}

/** On sign-out: the sets and games belong to the player leaving. */
export async function forgetPractice(): Promise<void> {
  usePractice.setState({ packs: {}, plays: {}, queue: [] });
  await storage.removeItem(KEY);
}
