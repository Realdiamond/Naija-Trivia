/**
 * The analytics loader (doc 18 §15): drains the Redis event stream into `analytics_events`,
 * keeps daily counts in `analytics_daily`, and drops raw rows after ANALYTICS_RETENTION_DAYS.
 * Events live in Postgres until volume calls for ClickHouse (build plan step 1.3); only this
 * file changes then.
 *
 * Loaders read the stream as one consumer group, and an entry is acknowledged and deleted only
 * once its rows are stored. Rows are keyed by event_id, so an entry loaded twice (a loader died
 * before acknowledging it, and another took it over) is stored once.
 */
import { hostname } from 'node:os';
import { EVENT_STREAM_KEY } from '@whosabi/analytics/server';
import { addDays, watDate } from '@whosabi/game-rules';
import type { JobDeps } from './deps';

const DAY = 86_400_000;
const DELETE_BATCH = 5_000;

export interface LoaderOptions {
  stream?: string;
  group?: string;
  consumer?: string;
  /** Entries another loader read but never acknowledged are taken over after this long. */
  claimIdleMs?: number;
}

type StreamEntry = [id: string, fields: string[] | null];

/** A stream row with every column checked, so one bad row can never block the batch. */
interface CleanRow {
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

const TEXT_COLUMNS = [
  'user_pid',
  'anon_id',
  'session_id',
  'platform',
  'app_version',
  'os_version',
  'device_model',
  'browser',
  'network_type',
  'carrier',
  'geo_state',
  'home_state',
  'language',
  'age_band',
  'screen',
] as const;

export class AnalyticsLoader {
  private readonly stream: string;
  private readonly group: string;
  private readonly consumer: string;
  private readonly claimIdleMs: number;

  constructor(
    private readonly deps: Pick<JobDeps, 'pool' | 'redis' | 'clock' | 'log'>,
    options: LoaderOptions = {},
  ) {
    this.stream = options.stream ?? EVENT_STREAM_KEY;
    this.group = options.group ?? 'loader';
    this.consumer = options.consumer ?? `${hostname()}-${process.pid}`;
    this.claimIdleMs = options.claimIdleMs ?? 60_000;
  }

  async ensureGroup(): Promise<void> {
    try {
      await this.deps.redis.xgroup('CREATE', this.stream, this.group, '0', 'MKSTREAM');
    } catch (err) {
      if (!(err as Error).message.includes('BUSYGROUP')) throw err;
    }
  }

  /** Stores one batch of stream entries, waiting up to `blockMs` for new ones. Returns the rows stored. */
  async loadOnce(blockMs = 0, count = 100): Promise<number> {
    let entries = await this.takeOver(count);
    if (entries.length === 0) entries = await this.readNew(blockMs, count);
    if (entries.length === 0) return 0;

    const rows: CleanRow[] = [];
    let rejected = 0;
    for (const [, fields] of entries) {
      for (const raw of parseEntry(fields)) {
        const row = clean(raw);
        if (row) rows.push(row);
        else rejected++;
      }
    }
    if (rejected > 0) this.deps.log.warn({ rejected }, 'analytics rows skipped: not valid');
    const stored = rows.length > 0 ? await this.insert(rows) : 0;
    const ids = entries.map(([id]) => id);
    await this.deps.redis
      .multi()
      .xack(this.stream, this.group, ...ids)
      .xdel(this.stream, ...ids)
      .exec();
    return stored;
  }

  /** Drops raw events older than the retention period; daily counts stay. Returns rows deleted. */
  async deleteOldEvents(retentionDays: number): Promise<number> {
    const cutoff = new Date(this.deps.clock.now() - retentionDays * DAY);
    let deleted = 0;
    for (;;) {
      const res = await this.deps.pool.query(
        `DELETE FROM analytics_events WHERE ctid = ANY(ARRAY(
           SELECT ctid FROM analytics_events WHERE ts < $1 LIMIT ${DELETE_BATCH}))`,
        [cutoff],
      );
      deleted += res.rowCount ?? 0;
      if ((res.rowCount ?? 0) < DELETE_BATCH) return deleted;
    }
  }

  /**
   * Recounts one WAT day ('YYYY-MM-DD'). Only run it while that day's raw rows are still kept.
   * Event '*' counts each platform's players across all events, and platform '*' everyone (the
   * console's active players, step 2.7a).
   */
  async rollupDay(day: string): Promise<void> {
    await this.deps.pool.query(
      `INSERT INTO analytics_daily (day, platform, event, events, players)
       SELECT $1::date, coalesce(platform, '*'), coalesce(event, '*'), count(*),
              count(DISTINCT coalesce(nullif(user_pid, ''), nullif(anon_id, '')))
         FROM analytics_events
        WHERE ts >= ($1::date::timestamp AT TIME ZONE 'Africa/Lagos')
          AND ts < (($1::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos')
        GROUP BY GROUPING SETS ((platform, event), (platform), ())
       ON CONFLICT (day, platform, event) DO UPDATE SET events = EXCLUDED.events, players = EXCLUDED.players`,
      [day],
    );
  }

  /** Hourly upkeep: recount yesterday and today, then drop what is past retention. */
  async maintain(retentionDays: number): Promise<void> {
    const today = watDate(this.deps.clock.now());
    await this.rollupDay(addDays(today, -1));
    await this.rollupDay(today);
    await this.deleteOldEvents(retentionDays);
  }

  private async takeOver(count: number): Promise<StreamEntry[]> {
    const res = (await this.deps.redis.call(
      'XAUTOCLAIM',
      this.stream,
      this.group,
      this.consumer,
      this.claimIdleMs,
      '0-0',
      'COUNT',
      count,
    )) as [string, StreamEntry[]] | null;
    return (res?.[1] ?? []).filter(([, fields]) => fields !== null);
  }

  private async readNew(blockMs: number, count: number): Promise<StreamEntry[]> {
    const args: Array<string | number> = ['GROUP', this.group, this.consumer, 'COUNT', count];
    if (blockMs > 0) args.push('BLOCK', blockMs);
    args.push('STREAMS', this.stream, '>');
    // RESP2 replies [[stream, entries]]; RESP3 (ioredis 6) flattens the map to [stream, entries].
    const res = (await this.deps.redis.call('XREADGROUP', ...args)) as unknown[] | null;
    if (!res || res.length === 0) return [];
    const entries = Array.isArray(res[0]) ? (res[0] as [string, StreamEntry[]])[1] : res[1];
    return Array.isArray(entries) ? (entries as StreamEntry[]) : [];
  }

  private async insert(rows: CleanRow[]): Promise<number> {
    const res = await this.deps.pool.query(
      `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, anon_id, session_id, seq,
              platform, app_version, os_version, device_model, browser, ram_mb, network_type, carrier,
              geo_state, home_state, language, age_band, data_saver, screen, props)
       SELECT event_id, event, source, (ts || '+00')::timestamptz, user_pid, anon_id, session_id, seq,
              platform, app_version, os_version, device_model, browser, ram_mb, network_type, carrier,
              geo_state, home_state, language, age_band, data_saver, screen, props::jsonb
         FROM jsonb_to_recordset($1::jsonb) AS x(event_id text, event text, source text, ts text,
              user_pid text, anon_id text, session_id text, seq int, platform text, app_version text,
              os_version text, device_model text, browser text, ram_mb int, network_type text,
              carrier text, geo_state text, home_state text, language text, age_band text,
              data_saver boolean, screen text, props text)
       ON CONFLICT (event_id) DO NOTHING`,
      [JSON.stringify(rows)],
    );
    return res.rowCount ?? 0;
  }
}

/** An entry holds one field, `rows`: a JSON array of rows (analytics/server appendRows). */
function parseEntry(fields: string[] | null): unknown[] {
  if (!fields) return [];
  const at = fields.indexOf('rows');
  if (at === -1 || at + 1 >= fields.length) return [];
  try {
    const parsed: unknown = JSON.parse(fields[at + 1]!);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [null];
  }
}

const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

function clean(raw: unknown): CleanRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? v : 0);
  if (typeof r.event_id !== 'string' || r.event_id.length === 0 || r.event_id.length > 64) return null;
  if (typeof r.event !== 'string' || r.event.length === 0 || r.event.length > 64) return null;
  if (r.source !== 'client' && r.source !== 'server') return null;
  if (
    typeof r.ts !== 'string' ||
    !TS.test(r.ts) ||
    !Number.isFinite(Date.parse(r.ts.replace(' ', 'T') + 'Z'))
  )
    return null;
  let props = '{}';
  if (typeof r.props === 'string') {
    try {
      JSON.parse(r.props);
      props = r.props;
    } catch {
      // Unreadable props: keep the event, drop its details.
    }
  }
  const row: CleanRow = {
    event_id: r.event_id,
    event: r.event,
    source: r.source,
    ts: r.ts,
    seq: int(r.seq),
    ram_mb: int(r.ram_mb),
    data_saver: r.data_saver === true,
    props,
  } as CleanRow;
  for (const c of TEXT_COLUMNS) row[c] = text(r[c]);
  return row;
}
