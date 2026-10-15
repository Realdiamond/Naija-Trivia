/**
 * Server-side helpers for the analytics pipeline (doc 18 §15), used by the ingest service
 * and the API. Node only.
 */
import { createHmac } from 'node:crypto';
import type { EventBatch, RejectReason } from '../batch';
import { checkClientEvent } from '../batch';
import { TRACKING_PLAN, type EventProps, type ServerEventName } from '../plan';

/**
 * The pseudonymous id stored in ClickHouse: HMAC-SHA256 of the user id with a secret key.
 * Analysts never see real ids; only the admin API, which holds the key, can map back.
 */
export function pseudonymousId(userId: string, key: string): string {
  if (key.length < 32) throw new Error('analytics key must be at least 32 characters');
  return createHmac('sha256', key).update(userId).digest('hex');
}

/** One row of `analytics.events` (schema/analytics.clickhouse.sql), ready for JSONEachRow. */
export interface AnalyticsRow {
  event_id: string;
  event: string;
  source: 'client' | 'server';
  ts: string;
  user_pid: string;
  anon_id: string;
  session_id: string;
  seq: number;
  platform: string;
  app_version: string;
  os_version: string;
  device_model: string;
  browser: string;
  ram_mb: number;
  network_type: string;
  carrier: string;
  geo_state: string;
  home_state: string;
  language: string;
  age_band: string;
  data_saver: boolean;
  screen: string;
  props: string;
}

/** ClickHouse DateTime64(3) text in UTC: 'YYYY-MM-DD HH:MM:SS.mmm'. */
export function clickhouseTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

export interface PlayerAttributes {
  userPid: string;
  homeState?: string | null;
  ageBand?: string | null;
}

export interface BatchRowsResult {
  rows: AnalyticsRow[];
  rejected: Array<{ event: string; reason: RejectReason }>;
}

/** Device clocks can be far off; never trust an event time more than 7 days old or in the future. */
const MAX_EVENT_AGE_MS = 7 * 86_400_000;

/**
 * Turn a client batch into rows: check every event against the plan and consent, and
 * correct the device clock using the gap between `sent_at` and when we received it.
 */
export function rowsFromBatch(
  batch: EventBatch,
  receivedAtMs: number,
  player: PlayerAttributes,
  geoState = '',
): BatchRowsResult {
  const offset = receivedAtMs - Date.parse(batch.sent_at);
  const ctx = batch.context;
  const rows: AnalyticsRow[] = [];
  const rejected: BatchRowsResult['rejected'] = [];

  for (const event of batch.events) {
    const check = checkClientEvent(event, ctx.consent.behaviour);
    if (!check.ok) {
      rejected.push({ event: event.event, reason: check.reason });
      continue;
    }
    const corrected = Math.min(
      Math.max(Date.parse(event.ts) + offset, receivedAtMs - MAX_EVENT_AGE_MS),
      receivedAtMs,
    );
    rows.push({
      event_id: event.event_id,
      event: event.event,
      source: 'client',
      ts: clickhouseTime(corrected),
      user_pid: player.userPid,
      anon_id: ctx.anon_id,
      session_id: event.session_id,
      seq: event.seq,
      platform: ctx.platform,
      app_version: ctx.app_version,
      os_version: ctx.os_version ?? '',
      device_model: ctx.device_model ?? '',
      browser: ctx.browser ?? '',
      ram_mb: ctx.ram_mb ?? 0,
      network_type: ctx.network_type ?? '',
      carrier: ctx.carrier ?? '',
      geo_state: geoState,
      home_state: player.homeState ?? '',
      language: ctx.language,
      age_band: player.ageBand ?? '',
      data_saver: ctx.data_saver,
      screen: event.screen ?? '',
      props: JSON.stringify(check.props),
    });
  }
  return { rows, rejected };
}

export interface ServerEventMeta extends PlayerAttributes {
  eventId: string;
  atMs: number;
  platform: 'android' | 'ios' | 'web';
  sessionId?: string | null;
  appVersion?: string;
  language?: string;
}

/** A server event row (answers, matches, coins, purchases). Props are checked against the plan. */
export function serverEventRow<E extends ServerEventName>(
  event: E,
  props: EventProps<E>,
  meta: ServerEventMeta,
): AnalyticsRow {
  const parsed = TRACKING_PLAN[event].props.parse(props);
  return {
    event_id: meta.eventId,
    event,
    source: 'server',
    ts: clickhouseTime(meta.atMs),
    user_pid: meta.userPid,
    anon_id: '',
    session_id: meta.sessionId ?? '',
    seq: 0,
    platform: meta.platform,
    app_version: meta.appVersion ?? '',
    os_version: '',
    device_model: '',
    browser: '',
    ram_mb: 0,
    network_type: '',
    carrier: '',
    geo_state: '',
    home_state: meta.homeState ?? '',
    language: meta.language ?? '',
    age_band: meta.ageBand ?? '',
    data_saver: false,
    screen: '',
    props: JSON.stringify(parsed),
  };
}

/** The Redis stream the loader drains into ClickHouse (doc 08 §3). */
export const EVENT_STREAM_KEY = 'ev:stream';
/**
 * Length cap that keeps Redis memory safe if ClickHouse is down: several hours of events
 * at launch volumes. Trimming by length (not time) is immune to clock differences between
 * our servers and Redis. The loader also trims what it has loaded.
 */
export const EVENT_STREAM_MAX_ENTRIES = 300_000;
const BATCH_SEEN_TTL_S = 48 * 3600;

/** Minimal Redis client surface (ioredis satisfies it). */
export interface RedisCommander {
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
}

// Accept a client batch once: remember its id and append it to the stream atomically.
const APPEND_ONCE_SCRIPT = `
if redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1]) then
  redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[2], '*', 'rows', ARGV[3])
  return 1
end
return 0`;

/** Returns false when the batch was already accepted (a client retry). */
export async function appendBatchOnce(
  redis: RedisCommander,
  batchId: string,
  rows: AnalyticsRow[],
): Promise<boolean> {
  const result = await redis.call(
    'EVAL',
    APPEND_ONCE_SCRIPT,
    2,
    `ev:batch:${batchId}`,
    EVENT_STREAM_KEY,
    BATCH_SEEN_TTL_S,
    EVENT_STREAM_MAX_ENTRIES,
    JSON.stringify(rows),
  );
  return result === 1;
}

/** Append server events (each emitted exactly once by the API, so no batch check). */
export async function appendRows(redis: RedisCommander, rows: AnalyticsRow[]): Promise<void> {
  if (rows.length === 0) return;
  await redis.call(
    'XADD',
    EVENT_STREAM_KEY,
    'MAXLEN',
    '~',
    EVENT_STREAM_MAX_ENTRIES,
    '*',
    'rows',
    JSON.stringify(rows),
  );
}
