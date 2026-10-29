/**
 * The analytics dashboards (doc 18 §9–10, build plan step 2.7j): Engagement & time, Growth &
 * invites and Retention over a range of WAT days and a platform. Straight from Postgres at
 * launch volumes, like the Overview: activity from `analytics_events`, new players and sign-ups
 * from `users` and `auth_identities` (so the numbers match the Overview, AD-6). ClickHouse takes
 * over in M3 behind the same responses. Counts only; nobody is named.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pseudonymousId } from '@whosabi/analytics/server';
import { addDays, daysBetween, isoWeekStart, watDate } from '@whosabi/game-rules';
import {
  ANALYTICS_BOARD_PERMISSION,
  ANALYTICS_MAX_DAYS,
  AnalyticsBoard,
  AnalyticsQuery,
  ErrorCode,
  type AnalyticsRange,
  type AnalyticsResponse,
  type EngagementBoard,
  type GrowthBoard,
  type RetentionBoard,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { ApiError, parse } from '../errors';
import { requireAdmin, type AdminDeps } from './context';

const WAT = 3_600_000;
const MINUTE = 60_000;
/** One player, signed in or not, in the analytics events (as on the Overview). */
const PLAYER = "coalesce(nullif(user_pid, ''), nullif(anon_id, ''))";
const LAGOS_DAY = "(ts AT TIME ZONE 'Africa/Lagos')::date";
/** Everyone but the Sabi Bot, counted as the Overview counts new players. */
const PLAYING = "status <> 'bot'";
const RETENTION_DAYS = 30;

const SESSION_BUCKETS = [
  ['Under 1 min', MINUTE],
  ['1–3 min', 3 * MINUTE],
  ['3–10 min', 10 * MINUTE],
  ['10–30 min', 30 * MINUTE],
  ['30 min or more', Infinity],
] as const;

const Params = z.object({ board: AnalyticsBoard });

interface Range extends AnalyticsRange {
  /** The range as instants: the first day's midnight WAT, and the end (exclusive, never after now). */
  start: Date;
  end: Date;
  days: string[];
  platformOrNull: string | null;
  today: string;
}

const badRange = (detail: string) =>
  new ApiError(400, ErrorCode.validation, 'The request is not valid', detail);

function rangeOf(query: AnalyticsQuery, now: number): Range {
  const today = watDate(now);
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -29);
  // A real calendar day each: 2028-02-30 is not 1 March.
  const real = (day: string) => {
    try {
      return addDays(day, 0) === day;
    } catch {
      return false;
    }
  };
  if (!real(from) || !real(to)) throw badRange('Dates are real days, as YYYY-MM-DD.');
  const length = daysBetween(from, to) + 1;
  if (length < 1) throw badRange('`from` comes after `to`.');
  if (length > ANALYTICS_MAX_DAYS) throw badRange(`At most ${ANALYTICS_MAX_DAYS} days at a time.`);
  return {
    from,
    to,
    platform: query.platform,
    start: new Date(Date.parse(from) - WAT),
    end: new Date(Math.min(Date.parse(addDays(to, 1)) - WAT, now)),
    days: Array.from({ length }, (_, i) => addDays(from, i)),
    platformOrNull: query.platform === 'all' ? null : query.platform,
    today,
  };
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function adminAnalyticsRoutes(app: FastifyInstance, deps: AppDeps, ctx: AdminDeps): void {
  const { pool, clock, config } = deps;

  async function engagement(r: Range): Promise<EngagementBoard> {
    const args = [r.start, r.end, r.platformOrNull];
    const where = `ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)`;
    const [days, reach, sessions, screens, hours] = await Promise.all([
      pool.query<{
        day: string;
        dau: number;
        sessions: number;
        ms: string;
        started: number;
        completed: number;
      }>(
        `SELECT to_char(${LAGOS_DAY}, 'YYYY-MM-DD') AS day,
                count(DISTINCT ${PLAYER})::int AS dau,
                count(*) FILTER (WHERE event = 'session_started')::int AS sessions,
                coalesce(sum((props->>'foreground_ms')::bigint) FILTER (WHERE event = 'app_backgrounded'), 0) AS ms,
                count(*) FILTER (WHERE event = 'daily_started')::int AS started,
                count(*) FILTER (WHERE event = 'daily_completed')::int AS completed
           FROM analytics_events WHERE ${where} GROUP BY 1`,
        args,
      ),
      // WAU and MAU: the 7 and 30 days up to the end of the range.
      pool.query<{ wau: number; mau: number }>(
        `SELECT count(DISTINCT ${PLAYER}) FILTER (WHERE ts >= $1::timestamptz + interval '23 days')::int AS wau,
                count(DISTINCT ${PLAYER})::int AS mau
           FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)`,
        [new Date(Date.parse(addDays(r.to, -29)) - WAT), r.end, r.platformOrNull],
      ),
      // A session's time in front: its foreground reports, or its span when the last report was lost.
      pool.query<{ ms: string }>(
        `SELECT coalesce(sum((props->>'foreground_ms')::bigint) FILTER (WHERE event = 'app_backgrounded'),
                         (extract(epoch FROM max(ts) - min(ts)) * 1000)::bigint) AS ms
           FROM analytics_events
          WHERE ${where} AND source = 'client' AND session_id <> ''
          GROUP BY session_id`,
        args,
      ),
      pool.query<{ screen: string; ms: string }>(
        `SELECT screen, sum(ms) AS ms FROM (
           SELECT props->>'prev_screen' AS screen, (props->>'prev_screen_ms')::bigint AS ms
             FROM analytics_events WHERE ${where} AND event = 'screen_viewed' AND props->>'prev_screen' <> ''
           UNION ALL
           SELECT props->>'screen', (props->>'screen_ms')::bigint
             FROM analytics_events WHERE ${where} AND event = 'app_backgrounded' AND props ? 'screen_ms'
         ) s GROUP BY screen ORDER BY sum(ms) DESC LIMIT 12`,
        args,
      ),
      pool.query<{ weekday: number; hour: number; players: number }>(
        `SELECT extract(isodow FROM ts AT TIME ZONE 'Africa/Lagos')::int - 1 AS weekday,
                extract(hour FROM ts AT TIME ZONE 'Africa/Lagos')::int AS hour,
                count(DISTINCT ${PLAYER})::int AS players
           FROM analytics_events WHERE ${where} GROUP BY 1, 2`,
        args,
      ),
    ]);

    const byDay = new Map(days.rows.map((d) => [d.day, d]));
    const rows = r.days
      .filter((day) => day <= r.today)
      .map((day) => {
        const d = byDay.get(day);
        return {
          day,
          dau: d?.dau ?? 0,
          sessions: d?.sessions ?? 0,
          minutes: d ? Number(d.ms) / MINUTE : 0,
          daily_started: d?.started ?? 0,
          daily_completed: d?.completed ?? 0,
        };
      });
    const sum = (key: 'dau' | 'sessions' | 'minutes' | 'daily_started' | 'daily_completed') =>
      rows.reduce((total, d) => total + d[key], 0);
    const playerDays = sum('dau');
    const dau = rows.length ? playerDays / rows.length : 0;
    const { wau, mau } = reach.rows[0]!;
    const buckets = SESSION_BUCKETS.map(([bucket]) => ({ bucket, sessions: 0 }));
    for (const s of sessions.rows) {
      buckets[SESSION_BUCKETS.findIndex(([, below]) => Number(s.ms) < below)]!.sessions += 1;
    }
    return {
      board: 'engagement',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        dau,
        wau,
        mau,
        stickiness: mau > 0 ? dau / mau : 0,
        sessions_per_dau: playerDays > 0 ? sum('sessions') / playerDays : 0,
        minutes_per_dau: playerDays > 0 ? sum('minutes') / playerDays : 0,
        daily_completion: share(sum('daily_completed'), sum('daily_started')),
      },
      days: rows,
      session_lengths: buckets,
      screens: screens.rows.map((s) => ({ screen: s.screen, minutes: Number(s.ms) / MINUTE })),
      hours: hours.rows,
    };
  }

  async function growth(r: Range): Promise<GrowthBoard> {
    const users = `FROM users WHERE ${PLAYING} AND created_at >= $1 AND created_at < $2
                     AND ($3::text IS NULL OR signup_platform = $3)`;
    const args = [r.start, r.end, r.platformOrNull];
    const events = `FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)`;
    const [newPlayers, signups, sources, shared, opened, web] = await Promise.all([
      pool.query<{ day: string; platform: string | null; n: number }>(
        `SELECT to_char((created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day,
                signup_platform AS platform, count(*)::int AS n
           ${users} GROUP BY 1, 2`,
        args,
      ),
      // A sign-up is a player's first account sign-in, not their guest start (as on the Overview).
      pool.query<{ day: string; method: string; n: number }>(
        `SELECT to_char((f.first AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day, f.method, count(*)::int AS n
           FROM (SELECT DISTINCT ON (a.user_id) a.user_id, a.created_at AS first, a.provider AS method
                   FROM auth_identities a WHERE a.provider <> 'guest_device'
                  ORDER BY a.user_id, a.created_at) f
           JOIN users u ON u.id = f.user_id
          WHERE f.first >= $1 AND f.first < $2 AND ($3::text IS NULL OR u.signup_platform = $3)
          GROUP BY 1, 2`,
        args,
      ),
      pool.query<{ source: string; n: number }>(
        `SELECT coalesce(acquisition_source, 'organic') AS source, count(*)::int AS n ${users}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
        args,
      ),
      pool.query<{ channel: string; n: number }>(
        `SELECT props->>'channel' AS channel, count(*)::int AS n ${events} AND event = 'invite_shared'
          GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{ type: string; in_app: number; on_web: number }>(
        `SELECT props->>'type' AS type,
                count(*) FILTER (WHERE (props->>'has_app')::boolean)::int AS in_app,
                count(*) FILTER (WHERE NOT (props->>'has_app')::boolean)::int AS on_web
           ${events} AND event = 'invite_opened' GROUP BY 1 ORDER BY count(*) DESC`,
        args,
      ),
      // New players who first came on the web: did they make an account?
      pool.query<{ id: string; account: boolean }>(
        `SELECT u.id, EXISTS (SELECT 1 FROM auth_identities a
                               WHERE a.user_id = u.id AND a.provider <> 'guest_device') AS account
           FROM users u
          WHERE ${PLAYING} AND created_at >= $1 AND created_at < $2 AND signup_platform = 'web'
            AND ($3::text IS NULL OR $3 = 'web')`,
        args,
      ),
    ]);
    // ...and did they play on a phone afterwards (seen in the app under the same account)?
    const webPids = web.rows.map((u) => pseudonymousId(u.id, config.analyticsKey));
    const onPhone = webPids.length
      ? Number(
          (
            await pool.query<{ n: number }>(
              `SELECT count(DISTINCT user_pid)::int AS n FROM analytics_events
                WHERE user_pid = ANY($1) AND platform IN ('android', 'ios') AND ts >= $2`,
              [webPids, r.start],
            )
          ).rows[0]!.n,
        )
      : 0;

    const days = new Map(
      r.days
        .filter((day) => day <= r.today)
        .map((day) => [day, { day, new_players: 0, android: 0, ios: 0, web: 0, signups: 0 }]),
    );
    for (const row of newPlayers.rows) {
      const d = days.get(row.day);
      if (!d) continue;
      d.new_players += row.n;
      if (row.platform === 'android' || row.platform === 'ios' || row.platform === 'web')
        d[row.platform] += row.n;
    }
    const byMethod = new Map<string, number>();
    for (const row of signups.rows) {
      const d = days.get(row.day);
      if (d) d.signups += row.n;
      byMethod.set(row.method, (byMethod.get(row.method) ?? 0) + row.n);
    }
    const rows = [...days.values()];
    const newCount = rows.reduce((total, d) => total + d.new_players, 0);
    const sharedCount = shared.rows.reduce((total, c) => total + c.n, 0);
    const openedCount = opened.rows.reduce((total, o) => total + o.in_app + o.on_web, 0);
    return {
      board: 'growth',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        new_players: newCount,
        signups: rows.reduce((total, d) => total + d.signups, 0),
        invites_shared: sharedCount,
        invites_opened: openedCount,
        k_factor:
          newCount > 0
            ? (sharedCount / newCount) * (sharedCount > 0 ? Math.min(1, openedCount / sharedCount) : 0)
            : null,
        web_new_players: web.rows.length,
        web_to_account: web.rows.filter((u) => u.account).length,
        web_to_app: onPhone,
      },
      days: rows,
      sources: sources.rows.map((s) => ({ source: s.source, players: s.n })),
      signup_methods: [...byMethod]
        .sort((a, b) => b[1] - a[1])
        .map(([method, n]) => ({ method, signups: n })),
      invite_channels: shared.rows.map((c) => ({ channel: c.channel, shared: c.n })),
      invites_opened_by: opened.rows,
    };
  }

  async function retention(r: Range): Promise<RetentionBoard> {
    // Each new player's first day; their activity is in the events under their pseudonymous id.
    const cohort = await pool.query<{ id: string; first_day: string }>(
      `SELECT id, to_char((created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS first_day
         FROM users
        WHERE ${PLAYING} AND created_at >= $1 AND created_at < $2 AND ($3::text IS NULL OR signup_platform = $3)`,
      [r.start, r.end, r.platformOrNull],
    );
    const pids = cohort.rows.map((u) => pseudonymousId(u.id, config.analyticsKey));
    const active = cohort.rows.length
      ? await pool.query<{ first_day: string; n: number; players: number }>(
          `WITH c AS (SELECT * FROM unnest($1::text[], $2::date[]) AS c(pid, first_day)),
                a AS (SELECT DISTINCT user_pid, ${LAGOS_DAY} AS day FROM analytics_events
                       WHERE user_pid = ANY($1) AND ts >= $3 AND ts < $4)
           SELECT to_char(c.first_day, 'YYYY-MM-DD') AS first_day, (a.day - c.first_day) AS n,
                  count(*)::int AS players
             FROM c JOIN a ON a.user_pid = c.pid
            WHERE a.day - c.first_day BETWEEN 0 AND ${RETENTION_DAYS}
            GROUP BY 1, 2`,
          [
            pids,
            cohort.rows.map((u) => u.first_day),
            r.start,
            new Date(Math.min(Date.parse(addDays(r.to, RETENTION_DAYS + 1)) - WAT, clock.now())),
          ],
        )
      : { rows: [] };

    // Day n has been lived in full by players who started on `first` when first + n is before today.
    const lived = (first: string, n: number) => addDays(first, n) < r.today;
    const starters = new Map<string, number>();
    for (const u of cohort.rows) starters.set(u.first_day, (starters.get(u.first_day) ?? 0) + 1);
    const back = new Map<string, number>();
    for (const a of active.rows) back.set(`${a.first_day}|${a.n}`, a.players);

    /** Share of the players who started on `firstDays` back on day n, once every one of them has lived it. */
    const rate = (firstDays: string[], n: number, all: boolean): number | null => {
      let players = 0;
      let returned = 0;
      for (const first of firstDays) {
        if (!lived(first, n)) {
          if (all) return null;
          continue;
        }
        players += starters.get(first) ?? 0;
        returned += back.get(`${first}|${n}`) ?? 0;
      }
      return share(returned, players);
    };

    const firstDays = [...starters.keys()].sort();
    const weeks = new Map<string, string[]>();
    for (const first of firstDays) {
      const week = isoWeekStart(first);
      weeks.set(week, [...(weeks.get(week) ?? []), first]);
    }
    return {
      board: 'retention',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        d1: rate(firstDays, 1, false),
        d7: rate(firstDays, 7, false),
        d30: rate(firstDays, 30, false),
      },
      cohorts: [...weeks].map(([week, days]) => ({
        week,
        players: days.reduce((total, d) => total + (starters.get(d) ?? 0), 0),
        d1: rate(days, 1, true),
        d7: rate(days, 7, true),
        d30: rate(days, 30, true),
      })),
      curve: Array.from({ length: RETENTION_DAYS + 1 }, (_, n) => ({
        day: n,
        share: rate(firstDays, n, false),
      })),
    };
  }

  app.get('/admin/analytics/:board', async (request): Promise<AnalyticsResponse> => {
    const { board } = parse(Params, request.params);
    await requireAdmin(request, ctx, ANALYTICS_BOARD_PERMISSION[board]);
    const range = rangeOf(parse(AnalyticsQuery, request.query), clock.now());
    if (board === 'engagement') return engagement(range);
    if (board === 'growth') return growth(range);
    return retention(range);
  });
}
