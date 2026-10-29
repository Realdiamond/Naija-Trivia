/**
 * The console's Overview and Live pages (doc 18 §5–6, build plan step 2.7a): today so far (WAT)
 * against the same span a week ago, money, live games, health, work waiting and the charts; who
 * is online, the party rooms and what just happened. Straight from Postgres (and the rooms in
 * this process); at launch volumes each query is quick, and ClickHouse takes over in M3.
 */
import { EVENT_STREAM_KEY } from '@whosabi/analytics/server';
import type { ConsoleOverview, LiveFeed, LiveOnline, WeekCount } from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import type { PartyRooms } from '../party/registry';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const WAT_OFFSET_MS = HOUR;
const ONLINE_MS = 5 * MINUTE;
const PLAYING = "status IN ('guest', 'active', 'restricted')";
/** One player, signed in or not, in the analytics events. */
const PLAYER = "coalesce(nullif(user_pid, ''), nullif(anon_id, ''))";
const ACTIVE_DUELS = "('created', 'wait_b_r1r2', 'wait_a_r2r3', 'wait_b_r3', 'tiebreak')";

type Deps = Pick<AppDeps, 'pool' | 'redis'>;

/** Midnight WAT at the start of `now`'s day. */
export function watMidnight(now: number): number {
  const wat = new Date(now + WAT_OFFSET_MS);
  return Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate()) - WAT_OFFSET_MS;
}

/** Today so far and the same span a week ago. `$1..$4`: last week's start and end, today's start and end. */
async function weekCount(deps: Deps, sql: string, today: number, now: number): Promise<WeekCount> {
  const row = await deps.pool.query<WeekCount>(sql, [
    new Date(today - WEEK),
    new Date(now - WEEK),
    new Date(today),
    new Date(now),
  ]);
  return row.rows[0]!;
}

const counted = (ts: string, from: string, what = 'count(*)') => `
  SELECT ${what} FILTER (WHERE ${ts} >= $3 AND ${ts} <= $4)::int AS today,
         ${what} FILTER (WHERE ${ts} >= $1 AND ${ts} <= $2)::int AS last_week
    FROM ${from}`;

export async function consoleOverview(deps: Deps, rooms: PartyRooms, now: number): Promise<ConsoleOverview> {
  const { pool, redis } = deps;
  const today = watMidnight(now);
  const span = (ts: string) => `${ts} >= $1 AND ${ts} <= $4`;
  const hourStart = Math.floor(now / HOUR) * HOUR - 23 * HOUR;

  const [
    online,
    hourly,
    active,
    newPlayers,
    signups,
    duels,
    parties,
    dailies,
    time,
    money,
    coins,
    waiting,
    loaded,
    alerts,
    days,
    byHour,
    states,
    categories,
    sources,
  ] = await Promise.all([
    pool.query<{ platform: string | null; n: number }>(
      `SELECT last_platform AS platform, count(*)::int AS n FROM users
        WHERE last_seen_at >= $1 AND last_seen_at <= $2 AND ${PLAYING} GROUP BY last_platform`,
      [new Date(now - ONLINE_MS), new Date(now)],
    ),
    pool.query<{ h: number; n: number }>(
      `SELECT floor(extract(epoch FROM ts - $1) / 3600)::int AS h, count(DISTINCT ${PLAYER})::int AS n
         FROM analytics_events WHERE ts >= $1 AND ts <= $2 GROUP BY 1`,
      [new Date(hourStart), new Date(now)],
    ),
    weekCount(
      deps,
      counted('ts', `analytics_events WHERE ${span('ts')}`, `count(DISTINCT ${PLAYER})`),
      today,
      now,
    ),
    weekCount(
      deps,
      counted('created_at', `users WHERE status <> 'bot' AND ${span('created_at')}`),
      today,
      now,
    ),
    // A sign-up is a player's first account sign-in, not their guest start.
    weekCount(
      deps,
      counted(
        'first',
        `(SELECT min(created_at) AS first FROM auth_identities WHERE provider <> 'guest_device'
           GROUP BY user_id HAVING min(created_at) >= $1) firsts`,
      ),
      today,
      now,
    ),
    weekCount(
      deps,
      counted('completed_at', `duels WHERE state IN ('complete', 'forfeit') AND ${span('completed_at')}`),
      today,
      now,
    ),
    weekCount(deps, counted('ended_at', `party_games WHERE ${span('ended_at')}`), today, now),
    weekCount(deps, counted('completed_at', `daily_results WHERE ${span('completed_at')}`), today, now),
    pool.query<{ minutes: number | null; median: number | null }>(
      `WITH s AS (
         SELECT session_id, sum((props->>'foreground_ms')::numeric) AS ms FROM analytics_events
          WHERE event = 'app_backgrounded' AND ts >= $1 AND ts <= $2 AND props ? 'foreground_ms'
          GROUP BY session_id)
       SELECT (SELECT sum(ms) FROM s) / 60000.0 AS minutes,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FROM s) / 60000.0 AS median`,
      [new Date(today), new Date(now)],
    ),
    pool.query<{ purchases: number; revenue: number; tests: number; ads: number }>(
      `SELECT (SELECT count(*) FROM purchases
                WHERE created_at >= $1 AND created_at <= $2 AND environment = 'production')::int AS purchases,
              (SELECT coalesce(sum(price_micros), 0) / 1000000 FROM purchases
                WHERE created_at >= $1 AND created_at <= $2 AND environment = 'production' AND status = 'completed'
                  AND currency = 'NGN')::int AS revenue,
              (SELECT count(*) FROM purchases
                WHERE created_at >= $1 AND created_at <= $2 AND environment = 'sandbox')::int AS tests,
              (SELECT count(*) FROM ad_rewards
                WHERE received_at >= $1 AND received_at <= $2 AND ledger_tx_id IS NOT NULL)::int AS ads`,
      [new Date(today), new Date(now)],
    ),
    // Coins players earned and spent; a guest's coins moving into their account are neither.
    pool.query<{ earned: number; spent: number }>(
      `SELECT coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::int AS earned,
              coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0), 0)::int AS spent
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.id = e.account_id AND a.owner_user_id IS NOT NULL AND a.currency = 'coins'
         JOIN ledger_transactions t ON t.id = e.transaction_id AND t.reason <> 'merge'
        WHERE e.created_at >= $1 AND e.created_at <= $2`,
      [new Date(today), new Date(now)],
    ),
    pool.query<{ reported: number; suspended: number; flags: number; dsars: number; duels: number }>(
      `SELECT (SELECT count(DISTINCT question_id) FROM question_reports WHERE resolution IS NULL)::int AS reported,
              (SELECT count(*) FROM questions WHERE status = 'suspended')::int AS suspended,
              (SELECT count(*) FROM integrity_flags WHERE status = 'open')::int AS flags,
              (SELECT count(*) FROM dsar_requests
                WHERE status IN ('received', 'in_progress') AND due_at <= $1)::int AS dsars,
              (SELECT count(*) FROM duels WHERE state IN ${ACTIVE_DUELS})::int AS duels`,
      [new Date(now + WEEK)],
    ),
    pool.query<{ at: Date | null }>('SELECT max(loaded_at) AS at FROM analytics_events'),
    pool.query<{ title: string; body: string; created_at: Date }>(
      `SELECT title, body, created_at FROM staff_alerts
        WHERE kind = 'problem' AND created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 10`,
      [new Date(now - DAY), new Date(now)],
    ),
    pool.query<{ day: string; players: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, players FROM analytics_daily
        WHERE platform = '*' AND event = '*' AND day >= ($1::timestamptz AT TIME ZONE 'Africa/Lagos')::date - 29
          AND day < ($1::timestamptz AT TIME ZONE 'Africa/Lagos')::date
        ORDER BY day`,
      [new Date(now)],
    ),
    pool.query<{ hour: number; today: number; last_week: number }>(
      `SELECT extract(hour FROM ts AT TIME ZONE 'Africa/Lagos')::int AS hour,
              count(DISTINCT ${PLAYER}) FILTER (WHERE ts >= $3)::int AS today,
              count(DISTINCT ${PLAYER}) FILTER (WHERE ts < $2)::int AS last_week
         FROM analytics_events
        WHERE (ts >= $1 AND ts < $2) OR (ts >= $3 AND ts <= $4)
        GROUP BY 1 ORDER BY 1`,
      [new Date(today - WEEK), new Date(today - WEEK + DAY), new Date(today), new Date(now)],
    ),
    pool.query<{ state: string; players: number }>(
      `SELECT coalesce(nullif(home_state, ''), nullif(geo_state, '')) AS state, count(DISTINCT ${PLAYER})::int AS players
         FROM analytics_events
        WHERE ts >= $1 AND ts <= $2 AND coalesce(nullif(home_state, ''), nullif(geo_state, '')) IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`,
      [new Date(today), new Date(now)],
    ),
    pool.query<{ category: string; answers: number }>(
      `SELECT props->>'category' AS category, count(*)::int AS answers FROM analytics_events
        WHERE event = 'question_answered' AND ts >= $1 AND ts <= $2 AND props ? 'category'
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`,
      [new Date(today), new Date(now)],
    ),
    pool.query<{ source: string; players: number }>(
      `SELECT coalesce(acquisition_source, 'organic') AS source, count(*)::int AS players FROM users
        WHERE created_at >= $1 AND created_at <= $2 AND status <> 'bot' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6`,
      [new Date(today), new Date(now)],
    ),
  ]);

  const onlineBy = (p: string) => online.rows.find((r) => r.platform === p)?.n ?? 0;
  const last24 = Array.from({ length: 24 }, (_, h) => hourly.rows.find((r) => r.h === h)?.n ?? 0);
  const open = rooms.list().map((r) => r.staffView());
  const w = waiting.rows[0]!;
  const t = time.rows[0]!;
  const m = money.rows[0]!;
  const minutes = t.minutes === null ? null : Number(t.minutes);
  const todayKey = new Date(today + WAT_OFFSET_MS).toISOString().slice(0, 10);
  const lastLoaded = loaded.rows[0]!.at;

  return {
    at: new Date(now).toISOString(),
    online: {
      total: online.rows.reduce((sum, r) => sum + r.n, 0),
      android: onlineBy('android'),
      ios: onlineBy('ios'),
      web: onlineBy('web'),
      last_24h: last24,
    },
    today: {
      active_players: active,
      new_players: newPlayers,
      signups,
      duels_finished: duels,
      party_games: parties,
      dailies,
    },
    time: {
      minutes_per_player:
        minutes === null || active.today === 0 ? null : Math.round((minutes / active.today) * 10) / 10,
      median_session_minutes: t.median === null ? null : Math.round(Number(t.median) * 10) / 10,
    },
    money: {
      purchases: m.purchases,
      revenue_ngn: m.revenue,
      test_purchases: m.tests,
      rewarded_ads: m.ads,
      coins_earned: coins.rows[0]!.earned,
      coins_spent: coins.rows[0]!.spent,
    },
    live: {
      party_rooms: open.length,
      party_players: open.reduce((sum, r) => sum + r.players.length, 0),
      duels_waiting: w.duels,
    },
    health: {
      events_waiting: await redis.xlen(EVENT_STREAM_KEY),
      last_event_loaded_s: lastLoaded ? Math.max(0, Math.round((now - lastLoaded.getTime()) / 1000)) : null,
    },
    queues: {
      reported_questions: w.reported,
      suspended_questions: w.suspended,
      open_flags: w.flags,
      dsars_due: w.dsars,
    },
    alerts: alerts.rows.map((a) => ({
      title: a.title,
      body: a.body,
      created_at: a.created_at.toISOString(),
    })),
    charts: {
      // Every one of the 30 days, so a day nobody played shows as nothing rather than vanishing.
      active_30d: Array.from({ length: 30 }, (_, i) => {
        const day = new Date(today + WAT_OFFSET_MS - (29 - i) * DAY).toISOString().slice(0, 10);
        if (day === todayKey) return { day, players: active.today };
        return { day, players: Number(days.rows.find((d) => d.day === day)?.players ?? 0) };
      }),
      by_hour: byHour.rows,
      top_states: states.rows,
      top_categories: categories.rows,
      new_by_source: sources.rows,
    },
  };
}

export async function liveOnline(
  deps: Pick<AppDeps, 'pool'>,
  now: number,
  platform: 'android' | 'ios' | 'web' | undefined,
): Promise<LiveOnline> {
  const since = new Date(now - ONLINE_MS);
  const filter = platform ? 'AND last_platform = $2' : '';
  const params = platform ? [since, platform] : [since];
  const [players, total, states] = await Promise.all([
    deps.pool.query<{
      id: string;
      username: string | null;
      platform: 'android' | 'ios' | 'web' | null;
      level: number;
      home_state: string | null;
      last_seen_at: Date;
    }>(
      `SELECT id, username, last_platform AS platform, level, home_state, last_seen_at FROM users
        WHERE last_seen_at >= $1 AND ${PLAYING} ${filter} ORDER BY last_seen_at DESC LIMIT 100`,
      params,
    ),
    deps.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE last_seen_at >= $1 AND ${PLAYING} ${filter}`,
      params,
    ),
    deps.pool.query<{ state: string; players: number }>(
      `SELECT home_state AS state, count(*)::int AS players FROM users
        WHERE last_seen_at >= $1 AND ${PLAYING} AND home_state IS NOT NULL ${filter}
        GROUP BY 1 ORDER BY 2 DESC, 1`,
      params,
    ),
  ]);
  return {
    total: total.rows[0]!.n,
    players: players.rows.map((p) => ({ ...p, last_seen_at: p.last_seen_at.toISOString() })),
    by_state: states.rows,
  };
}

const PLATFORM_NAMES: Record<string, string> = { android: 'Android', ios: 'iPhone', web: 'the web' };

/** Words for the feed's events; nothing that names a player. */
function describe(event: string, props: Record<string, unknown>, platform: string): string | null {
  const on = PLATFORM_NAMES[platform] ? ` on ${PLATFORM_NAMES[platform]}` : '';
  switch (event) {
    case 'signup_completed':
      return `A new account${on}`;
    case 'duel_completed':
      return props.result === 'win' ? `A duel won${on}` : null; // one line per duel, not two
    case 'party_game_completed':
      return props.rank === 1 ? `A party game finished: ${String(props.players)} players` : null;
    case 'daily_completed':
      return `A Daily played${on}: ${String(props.score)} points`;
    case 'purchase_completed':
      return `A purchase: ${String(props.sku)}`;
    case 'question_reported':
      return `A question reported: ${String(props.reason).replace(/_/g, ' ')}`;
    case 'party_room_created':
      return `A party room opened${on}`;
    case 'ad_reward_granted':
      return `A rewarded ad watched${on}`;
    default:
      return null;
  }
}

const FEED_EVENTS = [
  'signup_completed',
  'duel_completed',
  'party_game_completed',
  'daily_completed',
  'purchase_completed',
  'question_reported',
  'party_room_created',
  'ad_reward_granted',
];

/** What happened lately (newest first), or since `after` for the next look. */
export async function liveFeed(deps: Pick<AppDeps, 'pool'>, now: number, after?: string): Promise<LiveFeed> {
  const since = after ? new Date(after) : new Date(now - HOUR);
  const rows = await deps.pool.query<{
    event_id: string;
    event: string;
    ts: Date;
    platform: string;
    props: Record<string, unknown>;
  }>(
    `SELECT event_id, event, ts, platform, props FROM analytics_events
      WHERE event = ANY($1) AND ts > $2 ORDER BY ts DESC, event_id DESC LIMIT 200`,
    [FEED_EVENTS, since],
  );
  const items = rows.rows.flatMap((r) => {
    const text = describe(r.event, r.props, r.platform);
    return text ? [{ id: r.event_id, at: r.ts.toISOString(), platform: r.platform, text }] : [];
  });
  return { items: items.slice(0, 50) };
}
