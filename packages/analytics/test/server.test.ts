import { describe, expect, it } from 'vitest';
import type { EventBatch } from '../src/batch';
import {
  appendBatchOnce,
  appendRows,
  clickhouseTime,
  EVENT_STREAM_KEY,
  pseudonymousId,
  rowsFromBatch,
  serverEventRow,
} from '../src/server';

const KEY = 'k'.repeat(32);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function batch(events: EventBatch['events'], sentAt: string, behaviour = true): EventBatch {
  return {
    batch_id: 'b_0000000001',
    sent_at: sentAt,
    context: {
      platform: 'web',
      app_version: '1.0.0',
      browser: 'chrome_android',
      language: 'pcm',
      data_saver: true,
      anon_id: 'anon_1234567',
      consent: { behaviour },
    },
    events,
  };
}

describe('pseudonymousId', () => {
  it('is stable per key and reveals nothing without it', () => {
    expect(pseudonymousId('u_1', KEY)).toBe(pseudonymousId('u_1', KEY));
    expect(pseudonymousId('u_1', KEY)).not.toBe(pseudonymousId('u_1', 'z'.repeat(32)));
    expect(pseudonymousId('u_1', KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => pseudonymousId('u_1', 'short')).toThrow();
  });
});

describe('rowsFromBatch', () => {
  it("corrects the device clock and drops what the plan or consent doesn't allow", () => {
    // Device clock is 2 hours behind: it says it sent at 06:00, we received at 08:00.
    const received = Date.parse('2026-11-02T08:00:00.000Z');
    const events: EventBatch['events'] = [
      {
        event_id: uuid(1),
        event: 'app_backgrounded',
        ts: '2026-11-02T05:59:00.000Z',
        session_id: 's1',
        seq: 4,
        screen: 'home',
        props: { foreground_ms: 60_000 },
      },
      {
        event_id: uuid(2),
        event: 'purchase_completed',
        ts: '2026-11-02T05:59:00.000Z',
        session_id: 's1',
        seq: 5,
        screen: null,
        props: { sku: 'coins_small', store: 'paystack', net_kobo: 1 },
      },
      {
        event_id: uuid(3),
        event: 'made_up',
        ts: '2026-11-02T05:59:00.000Z',
        session_id: 's1',
        seq: 6,
        screen: null,
        props: {},
      },
      {
        event_id: uuid(4),
        event: 'screen_viewed',
        ts: '2026-11-02T05:59:00.000Z',
        session_id: 's1',
        seq: 7,
        screen: 'home',
        props: { screen: 'home', prev_screen: '', prev_screen_ms: 0 },
      },
      {
        event_id: uuid(5),
        event: 'app_backgrounded',
        ts: '2026-11-02T05:59:00.000Z',
        session_id: 's1',
        seq: 8,
        screen: null,
        props: { foreground_ms: -1 },
      },
    ];
    const { rows, rejected } = rowsFromBatch(
      batch(events, '2026-11-02T06:00:00.000Z', false),
      received,
      { userPid: 'pid', homeState: 'LA', ageBand: '18_plus' },
      'LA',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: 'app_backgrounded',
      source: 'client',
      ts: '2026-11-02 07:59:00.000',
      user_pid: 'pid',
      platform: 'web',
      browser: 'chrome_android',
      home_state: 'LA',
      geo_state: 'LA',
      data_saver: true,
      props: '{"foreground_ms":60000}',
    });
    expect(rejected).toEqual([
      { event: 'purchase_completed', reason: 'server_only' },
      { event: 'made_up', reason: 'unknown_event' },
      { event: 'screen_viewed', reason: 'no_consent' },
      { event: 'app_backgrounded', reason: 'bad_props' },
    ]);
  });

  it('never dates an event in the future', () => {
    const received = Date.parse('2026-11-02T08:00:00.000Z');
    const ahead = batch(
      [
        {
          event_id: uuid(6),
          event: 'app_foregrounded',
          ts: '2026-11-02T09:00:00.000Z',
          session_id: 's1',
          seq: 0,
          screen: null,
          props: {},
        },
      ],
      '2026-11-02T08:00:00.000Z',
    );
    expect(rowsFromBatch(ahead, received, { userPid: 'pid' }).rows[0]!.ts).toBe('2026-11-02 08:00:00.000');
  });
});

describe('serverEventRow', () => {
  it('checks props against the plan', () => {
    const row = serverEventRow(
      'question_answered',
      {
        qid: 'q_seed-0001',
        category: 'slang',
        difficulty: 1,
        correct: true,
        timed_out: false,
        accepted_elapsed_ms: 4210,
        points: 172,
        mode: 'taste_test',
        lifeline: null,
      },
      { eventId: uuid(7), atMs: Date.parse('2026-11-02T08:00:00Z'), platform: 'android', userPid: 'pid' },
    );
    expect(row).toMatchObject({
      source: 'server',
      event: 'question_answered',
      ts: '2026-11-02 08:00:00.000',
    });
    expect(() =>
      serverEventRow(
        'coins_changed',
        { delta: 1.5, reason: 'x', balance_after: 0 },
        {
          eventId: uuid(8),
          atMs: 0,
          platform: 'web',
          userPid: 'pid',
        },
      ),
    ).toThrow();
  });

  it('formats ClickHouse timestamps in UTC', () => {
    expect(clickhouseTime(Date.parse('2026-01-02T03:04:05.006Z'))).toBe('2026-01-02 03:04:05.006');
  });
});

describe('stream writes', () => {
  it('appends a client batch once and server rows directly', async () => {
    const calls: Array<Array<string | number>> = [];
    const redis = {
      call: async (...args: Array<string | number>) => {
        calls.push(args);
        return 1;
      },
    };
    const now = Date.parse('2026-11-02T08:00:00Z');
    expect(await appendBatchOnce(redis, 'b1', [], now)).toBe(true);
    await appendRows(redis, [], now);
    await appendRows(redis, [{ event: 'x' } as never], now);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.slice(0, 1)).toEqual(['EVAL']);
    expect(calls[0]!.slice(2, 5)).toEqual([2, 'ev:batch:b1', EVENT_STREAM_KEY]);
    expect(calls[1]!.slice(0, 5)).toEqual(['XADD', EVENT_STREAM_KEY, 'MINID', '~', now - 86_400_000]);
  });
});
