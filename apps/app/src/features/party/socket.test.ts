import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartyServerMessage } from '@whosabi/shared-types';
import {
  clockOffset,
  median,
  PartySocket,
  reconnectDelay,
  socketUrl,
  type PartySocketStatus,
  type SocketLike,
} from './socket';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  hear(message: PartyServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe('party socket helpers', () => {
  it('builds the socket address from the API address, or this page when it is the same host', () => {
    expect(socketUrl('https://api.whosabi.ng', '/v1/party/socket', 'a b')).toBe(
      'wss://api.whosabi.ng/v1/party/socket?token=a%20b',
    );
    expect(socketUrl('', '/v1/party/socket', 't', 'http://localhost:8082')).toBe(
      'ws://localhost:8082/v1/party/socket?token=t',
    );
  });

  it('waits longer after each failed try, up to 8 s', () => {
    expect([0, 1, 2, 3, 4, 5].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('takes the middle of the round trip for the server clock, and the median of samples', () => {
    expect(clockOffset(1000, 5100, 1200)).toBe(4000);
    expect(median([30, 10, 20])).toBe(20);
    expect(median([])).toBe(0);
  });
});

describe('PartySocket', () => {
  let sockets: FakeSocket[];
  let statuses: Array<[PartySocketStatus, number | undefined]>;
  let now: number;
  let party: PartySocket;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    statuses = [];
    now = 1000;
    party = new PartySocket(
      'ws://x',
      { message: () => undefined, status: (s, end) => statuses.push([s, end?.code]) },
      () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      () => now,
    );
  });
  afterEach(() => vi.useRealTimers());

  it('syncs the clock when it opens', () => {
    party.connect();
    sockets[0]!.onopen!();
    vi.advanceTimersByTime(1000);
    expect(sockets[0]!.sent.map((m) => JSON.parse(m).type)).toEqual(['time', 'time', 'time']);
    now = 1100;
    sockets[0]!.hear({ type: 'time', t0: 1000, ts: 61_050 });
    expect(party.serverNow()).toBe(1100 + 60_000);
  });

  it('reconnects after a drop, and stops for good when the room says so', () => {
    party.connect();
    sockets[0]!.onopen!();
    sockets[0]!.onclose!({ code: 1006, reason: '' });
    expect(statuses.at(-1)).toEqual(['reconnecting', undefined]);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onopen!();
    sockets[1]!.onclose!({ code: 4001, reason: 'kicked' });
    expect(statuses.at(-1)).toEqual(['closed', 4001]);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
  });

  it('gives up a minute after the drop', () => {
    party.connect();
    sockets[0]!.onopen!();
    sockets[0]!.onclose!({ code: 1006, reason: '' });
    now += 61_000;
    vi.advanceTimersByTime(500);
    sockets[1]!.onclose!({ code: 1006, reason: '' });
    expect(statuses.at(-1)).toEqual(['closed', 1006]);
  });
});
