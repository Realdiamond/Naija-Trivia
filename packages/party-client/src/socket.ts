/**
 * A party room's WebSocket (API §3): JSON in and out, the server's clock, and reconnecting
 * after a drop with the same seat token (0.5 s, 1 s, 2 s, 4 s … for up to a minute). The room
 * closing, a kick, the seat opening elsewhere, a bad token or a full room end it for good.
 */
import type { PartyClientMessage } from '@whosabi/shared-types';
// The protocol's own entry point keeps the light web client free of the validation library.
import { PartyCloseCode, type PartyServerMessage } from '@whosabi/shared-types/party-protocol';

export type PartySocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface PartyEnd {
  code: number;
  reason: string;
}

export interface PartySocketEvents {
  message(message: PartyServerMessage): void;
  status(status: PartySocketStatus, end?: PartyEnd): void;
}

/** What the socket needs from a WebSocket (the browser's, React Native's, or a test's). */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Closes after which coming back makes no sense. */
const FINAL: readonly number[] = Object.values(PartyCloseCode);
/** Keep trying this long after a drop. */
const GIVE_UP_MS = 60_000;
/** Clock samples kept; the middle one wins. */
const CLOCK_SAMPLES = 5;

/** ws(s)://host/path?token=… for a seat; an empty API address means this page's own host. */
export function socketUrl(apiUrl: string, path: string, token: string, here?: string): string {
  const base = apiUrl || here || '';
  return `${base.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(token)}`;
}

/** The wait before reconnect attempt `n` (from 0): 0.5 s doubling, at most 8 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000);
}

/** The server clock's lead over ours, from a `time` reply: the middle of the round trip. */
export function clockOffset(sentAt: number, serverTs: number, receivedAt: number): number {
  return serverTs - (sentAt + receivedAt) / 2;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export class PartySocket {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private droppedAt: number | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private offsets: number[] = [];

  constructor(
    private readonly url: string,
    private readonly events: PartySocketEvents,
    private readonly open: (url: string) => SocketLike = (url) => new WebSocket(url) as unknown as SocketLike,
    private readonly now: () => number = Date.now,
  ) {}

  connect(): void {
    this.stopped = false;
    this.dial();
  }

  send(message: PartyClientMessage): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // Not open yet, or just dropped: the room's next state brings the screen up to date.
    }
  }

  /** Leaving on purpose: no reconnecting. */
  close(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close(1000, 'bye');
    this.socket = null;
  }

  /** Now, by the server's clock. */
  serverNow(): number {
    return this.now() + median(this.offsets);
  }

  private dial(): void {
    this.events.status(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = this.open(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.droppedAt = null;
      this.events.status('open');
      // A few clock samples, a moment apart.
      for (const delay of [0, 400, 900]) setTimeout(() => this.send({ type: 'time', t0: this.now() }), delay);
    };
    socket.onmessage = (event) => {
      let message: PartyServerMessage;
      try {
        message = JSON.parse(String(event.data)) as PartyServerMessage;
      } catch {
        return;
      }
      if (message.type === 'time') {
        this.offsets = [clockOffset(message.t0, message.ts, this.now()), ...this.offsets].slice(
          0,
          CLOCK_SAMPLES,
        );
      }
      this.events.message(message);
    };
    socket.onerror = () => undefined;
    socket.onclose = ({ code, reason }) => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      if (FINAL.includes(code)) {
        this.stopped = true;
        this.events.status('closed', { code, reason });
        return;
      }
      this.droppedAt ??= this.now();
      if (this.now() - this.droppedAt > GIVE_UP_MS) {
        this.stopped = true;
        this.events.status('closed', { code, reason });
        return;
      }
      this.events.status('reconnecting');
      this.retry = setTimeout(() => this.dial(), reconnectDelay(this.attempt++));
    };
  }
}
