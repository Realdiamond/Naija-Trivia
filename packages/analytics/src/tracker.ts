/**
 * Client event tracker, shared by the Android, iOS and web builds (doc 18 §15).
 *
 * - Sessions: a run of activity with no gap longer than 30 minutes.
 * - Time spent: foreground time, reported on every move to the background
 *   (`app_backgrounded.foreground_ms`); on the web, "background" is the tab being hidden.
 * - Time per screen: each screen view is closed exactly once, by the next
 *   `screen_viewed` (prev_screen_ms) or by `app_backgrounded` (screen_ms).
 * - Delivery: events are queued in storage and sent in batches. A batch keeps its
 *   batch_id until the server accepts it, so a retry is never counted twice.
 *
 * Platform specifics (storage, transport, device context) are injected, so this file
 * has no Node, DOM or React Native dependencies.
 */
import type { BatchContext, ClientEvent, EventBatch } from './batch';
import { TRACKING_PLAN, type ClientEventName, type EventName, type EventProps } from './plan';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

export type DeviceContext = Omit<BatchContext, 'anon_id' | 'consent'>;

/** 'accepted' and 'drop' both clear the batch; 'retry' keeps it for later. */
export type SendOutcome = 'accepted' | 'retry' | 'drop';
export type Transport = (batch: EventBatch) => Promise<SendOutcome>;

interface TimerHost {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface TrackerOptions {
  transport: Transport;
  storage: KeyValueStore;
  getContext: () => DeviceContext;
  hasBehaviourConsent: () => boolean;
  now?: () => number;
  newId?: () => string;
  timers?: TimerHost;
  /** Send at least this often while visible (30 s, or 2 min in Data Saver). */
  flushIntervalMs?: number;
  dataSaverFlushIntervalMs?: number;
  /** Send as soon as this many events are waiting. */
  flushAtEvents?: number;
  maxBatchEvents?: number;
  sessionTimeoutMs?: number;
  /** Events older than this are dropped instead of sent (7 days offline). */
  maxEventAgeMs?: number;
  /** Check props against the tracking plan and throw on mistakes (development and tests). */
  validate?: boolean;
  onError?: (error: unknown) => void;
}

interface PersistedState {
  v: 1;
  anonId: string;
  queue: ClientEvent[];
  inflight: EventBatch | null;
  sessionId: string | null;
  seq: number;
  lastActivityAt: number | null;
}

export const TRACKER_STORAGE_KEY = 'whosabi.analytics.v1';

const MINUTE = 60_000;

export class Tracker {
  private readonly opts: Required<Omit<TrackerOptions, 'onError'>> & Pick<TrackerOptions, 'onError'>;
  private state: PersistedState | null = null;
  private foregroundSince: number | null = null;
  private screenName: string | null = null;
  private screenSince = 0;
  private flushing: Promise<void> | null = null;
  private timer: unknown = null;
  private failures = 0;
  private retryAt = 0;

  constructor(options: TrackerOptions) {
    const host = globalThis as unknown as TimerHost;
    this.opts = {
      now: () => Date.now(),
      newId: randomUuid,
      timers: { setInterval: host.setInterval.bind(host), clearInterval: host.clearInterval.bind(host) },
      flushIntervalMs: 30_000,
      dataSaverFlushIntervalMs: 120_000,
      flushAtEvents: 20,
      maxBatchEvents: 500,
      sessionTimeoutMs: 30 * MINUTE,
      maxEventAgeMs: 7 * 24 * 60 * MINUTE,
      validate: false,
      ...options,
    };
  }

  /** Load saved state, start or continue the session, and mark the app visible. */
  async start(firstOpenSource: 'organic' | 'deeplink' | 'referrer' = 'organic'): Promise<void> {
    const saved = parseState(await this.opts.storage.getItem(TRACKER_STORAGE_KEY));
    this.state = saved ?? {
      v: 1,
      anonId: this.opts.newId(),
      queue: [],
      inflight: null,
      sessionId: null,
      seq: 0,
      lastActivityAt: null,
    };
    this.ensureSession(this.opts.now(), 'launch');
    if (!saved) this.record('first_opened', { source: firstOpenSource });
    this.foreground();
  }

  get anonId(): string {
    return this.requireState().anonId;
  }

  /** Sent as X-Session-Id so server events land in the same session. */
  get sessionId(): string | null {
    return this.state?.sessionId ?? null;
  }

  track<E extends ClientEventName>(event: E, props: EventProps<E>): void {
    this.record(event, props as Record<string, unknown>);
  }

  /** Call whenever the visible screen changes. */
  screen(name: string): void {
    const now = this.opts.now();
    const previous = this.screenName;
    const previousMs = previous ? now - this.screenSince : 0;
    this.screenName = name;
    this.screenSince = now;
    if (this.foregroundSince === null) return; // reported when the app comes back
    this.record('screen_viewed', { screen: name, prev_screen: previous ?? '', prev_screen_ms: previousMs });
  }

  /** Call when the app or tab becomes visible. */
  foreground(): void {
    if (this.foregroundSince !== null) return;
    const now = this.opts.now();
    this.ensureSession(now, 'resume');
    this.foregroundSince = now;
    this.record('app_foregrounded', {});
    if (this.screenName) {
      this.screenSince = now;
      this.record('screen_viewed', { screen: this.screenName, prev_screen: '', prev_screen_ms: 0 });
    }
    this.startTimer();
  }

  /** Call when the app or tab is hidden or closing. Resolves once a send has been tried. */
  background(): Promise<void> {
    if (this.foregroundSince === null) return Promise.resolve();
    const now = this.opts.now();
    const props: Record<string, unknown> = { foreground_ms: now - this.foregroundSince };
    if (this.screenName && this.opts.hasBehaviourConsent()) {
      props.screen = this.screenName;
      props.screen_ms = now - this.screenSince;
    }
    this.record('app_backgrounded', props);
    this.foregroundSince = null;
    this.stopTimer();
    return this.flush();
  }

  /** Send what is waiting. Safe to call at any time; concurrent calls share one send. */
  flush(): Promise<void> {
    if (!this.flushing) this.flushing = this.sendPending().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /** Stop the background timer (tests, or before re-creating the tracker). */
  stop(): void {
    this.stopTimer();
  }

  private record(event: EventName, props: Record<string, unknown>): void {
    const state = this.requireState();
    const spec = TRACKING_PLAN[event];
    if (spec.sentBy !== 'client')
      throw new Error(`'${event}' is a server event and can't be sent by a client`);
    if (spec.consent === 'behaviour' && !this.opts.hasBehaviourConsent()) return;
    if (this.opts.validate) spec.props.parse(props);

    const now = this.opts.now();
    if (event !== 'session_started') this.ensureSession(now, 'resume');
    state.queue.push({
      event_id: this.opts.newId(),
      event,
      ts: new Date(now).toISOString(),
      session_id: state.sessionId!,
      seq: state.seq++,
      screen: this.screenName,
      props,
    });
    state.lastActivityAt = now;
    this.persist();
    if (state.queue.length >= this.opts.flushAtEvents) void this.flush();
  }

  private ensureSession(now: number, source: 'launch' | 'resume'): void {
    const state = this.requireState();
    const idle = state.lastActivityAt === null ? Infinity : now - state.lastActivityAt;
    if (state.sessionId && idle <= this.opts.sessionTimeoutMs) return;
    state.sessionId = this.opts.newId();
    state.seq = 0;
    state.lastActivityAt = now;
    this.record('session_started', { source });
  }

  private async sendPending(): Promise<void> {
    const state = this.requireState();
    if (this.opts.now() < this.retryAt) return;

    if (!state.inflight) {
      const cutoff = this.opts.now() - this.opts.maxEventAgeMs;
      state.queue = state.queue.filter((e) => Date.parse(e.ts) >= cutoff);
      if (state.queue.length === 0) return;
      state.inflight = {
        batch_id: this.opts.newId(),
        sent_at: new Date(this.opts.now()).toISOString(),
        context: {
          ...this.opts.getContext(),
          anon_id: state.anonId,
          consent: { behaviour: this.opts.hasBehaviourConsent() },
        },
        events: state.queue.splice(0, this.opts.maxBatchEvents),
      };
      this.persist();
    }

    // Same batch_id and events on every attempt; sent_at is refreshed so the server can
    // still measure the device's clock offset.
    const batch: EventBatch = { ...state.inflight, sent_at: new Date(this.opts.now()).toISOString() };
    let outcome: SendOutcome;
    try {
      outcome = await this.opts.transport(batch);
    } catch (error) {
      this.opts.onError?.(error);
      outcome = 'retry';
    }

    if (outcome === 'retry') {
      this.failures++;
      this.retryAt = this.opts.now() + Math.min(5_000 * 2 ** (this.failures - 1), 5 * MINUTE);
      return;
    }
    state.inflight = null;
    this.failures = 0;
    this.retryAt = 0;
    this.persist();
    if (state.queue.length >= this.opts.flushAtEvents) await this.sendPending();
  }

  private startTimer(): void {
    this.stopTimer();
    const interval = this.opts.getContext().data_saver
      ? this.opts.dataSaverFlushIntervalMs
      : this.opts.flushIntervalMs;
    this.timer = this.opts.timers.setInterval(() => void this.flush(), interval);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.opts.timers.clearInterval(this.timer);
    this.timer = null;
  }

  private persist(): void {
    try {
      const pending = this.opts.storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(this.state));
      if (pending) pending.catch((error: unknown) => this.opts.onError?.(error));
    } catch (error) {
      this.opts.onError?.(error);
    }
  }

  private requireState(): PersistedState {
    if (!this.state) throw new Error('Tracker.start() must finish before tracking');
    return this.state;
  }
}

function parseState(raw: string | null): PersistedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed && parsed.v === 1 && typeof parsed.anonId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** crypto.randomUUID where available; otherwise a v4 UUID from Math.random (fine for event ids). */
function randomUuid(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Math.floor(Math.random() * 4) + 8) as number).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
