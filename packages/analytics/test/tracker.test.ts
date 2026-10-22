import { describe, expect, it } from 'vitest';
import { EventBatch } from '../src/batch';
import { Tracker, TRACKER_STORAGE_KEY, type KeyValueStore, type SendOutcome } from '../src/tracker';

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const START = Date.UTC(2026, 10, 2, 7, 0, 0); // 08:00 WAT
let idCounter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

function setup(
  options: { consent?: boolean; outcomes?: SendOutcome[]; store?: MemoryStore; startAt?: number } = {},
) {
  let now = options.startAt ?? START;
  const sent: EventBatch[] = [];
  const outcomes = [...(options.outcomes ?? [])];
  const store = options.store ?? new MemoryStore();
  const tracker = new Tracker({
    transport: async (batch) => {
      sent.push(EventBatch.parse(structuredClone(batch)));
      return outcomes.shift() ?? 'accepted';
    },
    storage: store,
    getContext: () => ({ platform: 'android', app_version: '1.0.0', language: 'en', data_saver: false }),
    hasBehaviourConsent: () => options.consent ?? true,
    now: () => now,
    newId,
    timers: { setInterval: () => 0, clearInterval: () => {} },
    validate: true,
    flushAtEvents: 1000,
  });
  return {
    tracker,
    sent,
    store,
    advance: (ms: number) => (now += ms),
    now: () => now,
    events: () => sent.flatMap((b) => b.events),
  };
}

describe('Tracker', () => {
  it('opens a session, records the first open once, and continues the session after a quick restart', async () => {
    const first = setup();
    await first.tracker.start();
    first.advance(5000);
    await first.tracker.background();
    expect(first.events().map((e) => e.event)).toEqual([
      'session_started',
      'first_opened',
      'app_foregrounded',
      'app_backgrounded',
    ]);
    const sessionId = first.events()[0]!.session_id;

    const second = setup({ store: first.store, startAt: first.now() + 10 * 60_000 });
    await second.tracker.start();
    await second.tracker.flush();
    expect(second.events().map((e) => e.event)).toEqual(['app_foregrounded']);
    expect(second.events()[0]!.session_id).toBe(sessionId);

    const third = setup({ store: first.store, startAt: second.now() + 45 * 60_000 });
    await third.tracker.start();
    await third.tracker.flush();
    expect(third.events().map((e) => e.event)).toEqual(['session_started', 'app_foregrounded']);
    expect(third.events()[0]!.session_id).not.toBe(sessionId);
    expect(third.events()[0]!.props).toEqual({ source: 'launch' });
  });

  it('measures foreground time and closes every screen view exactly once', async () => {
    const t = setup();
    await t.tracker.start();
    t.advance(1000);
    t.tracker.screen('home');
    t.advance(15_000);
    t.tracker.screen('duel.question');
    t.advance(330_000);
    await t.tracker.background();

    const byName = (name: string) => t.events().filter((e) => e.event === name);
    expect(byName('screen_viewed').map((e) => e.props)).toEqual([
      { screen: 'home', prev_screen: '', prev_screen_ms: 0 },
      { screen: 'duel.question', prev_screen: 'home', prev_screen_ms: 15_000 },
    ]);
    expect(byName('app_backgrounded')[0]!.props).toEqual({
      foreground_ms: 346_000,
      screen: 'duel.question',
      screen_ms: 330_000,
    });
  });

  it('reopens the same screen on return, and starts a new session after 30 idle minutes', async () => {
    const t = setup();
    await t.tracker.start();
    t.tracker.screen('home');
    await t.tracker.background();
    t.advance(60_000);
    t.tracker.foreground();
    t.advance(31 * 60_000);
    await t.tracker.background();
    t.advance(31 * 60_000);
    t.tracker.foreground();
    await t.tracker.flush();

    const events = t.events();
    expect(events.map((e) => e.event)).toEqual([
      'session_started',
      'first_opened',
      'app_foregrounded',
      'screen_viewed',
      'app_backgrounded',
      'app_foregrounded',
      'screen_viewed',
      // 31 minutes visible but idle: the next event belongs to a new session
      'session_started',
      'app_backgrounded',
      'session_started',
      'app_foregrounded',
      'screen_viewed',
    ]);
    const sessions = events.map((e) => e.session_id);
    expect(new Set(sessions.slice(0, 7)).size).toBe(1);
    expect(new Set(sessions.slice(7, 9)).size).toBe(1);
    expect(new Set(sessions.slice(9)).size).toBe(1);
    expect(new Set(t.events().map((e) => e.session_id)).size).toBe(3);
  });

  it('sends no screen-level detail without analytics consent', async () => {
    const t = setup({ consent: false });
    await t.tracker.start();
    t.tracker.screen('home');
    t.tracker.track('invite_shared', { channel: 'whatsapp', context: 'duel' });
    t.advance(20_000);
    await t.tracker.background();
    expect(t.events().map((e) => e.event)).toEqual([
      'session_started',
      'first_opened',
      'app_foregrounded',
      'app_backgrounded',
    ]);
    expect(t.events()[3]!.props).toEqual({ foreground_ms: 20_000 });
    expect(t.sent[0]!.context.consent).toEqual({ behaviour: false });
  });

  it('keeps the same batch id until the server accepts it, with backoff between tries', async () => {
    const t = setup({ outcomes: ['retry', 'retry', 'accepted'] });
    await t.tracker.start();
    await t.tracker.flush();
    await t.tracker.flush(); // still backing off: nothing sent
    expect(t.sent).toHaveLength(1);
    t.advance(5000);
    await t.tracker.flush();
    t.advance(10_000);
    await t.tracker.flush();
    expect(t.sent).toHaveLength(3);
    expect(new Set(t.sent.map((b) => b.batch_id)).size).toBe(1);
    expect(t.sent[2]!.events).toEqual(t.sent[0]!.events);
    expect(t.sent[2]!.sent_at).not.toBe(t.sent[0]!.sent_at);
    await t.tracker.flush();
    expect(t.sent).toHaveLength(3);
  });

  it('resends an unconfirmed batch after the app restarts', async () => {
    const offline = setup({ outcomes: ['retry'] });
    await offline.tracker.start();
    await offline.tracker.flush();
    const batchId = offline.sent[0]!.batch_id;
    expect(JSON.parse(offline.store.data.get(TRACKER_STORAGE_KEY)!).inflight.batch_id).toBe(batchId);

    const online = setup({ store: offline.store, startAt: offline.now() + 60_000 });
    await online.tracker.start();
    await online.tracker.flush();
    expect(online.sent[0]!.batch_id).toBe(batchId);
    await online.tracker.flush();
    expect(online.sent[1]!.events.map((e) => e.event)).toEqual(['app_foregrounded']);
  });

  it('drops events that waited more than 7 days', async () => {
    const t = setup({ outcomes: [] });
    await t.tracker.start();
    t.advance(8 * 24 * 3600_000);
    await t.tracker.flush();
    expect(t.sent).toHaveLength(0);
  });

  it('rejects mistakes in development builds', async () => {
    const t = setup();
    await t.tracker.start();
    expect(() => t.tracker.track('invite_shared', { channel: 'pigeon', context: 'duel' } as never)).toThrow();
    expect(() => t.tracker.track('purchase_completed' as never, {} as never)).toThrow(/server event/);
  });
});
