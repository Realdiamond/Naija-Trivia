/**
 * The analytics dashboards (doc 18 §9–10, build plan steps 2.7j–2.7l): Engagement & time, Growth
 * & invites, Retention, Funnels, Gameplay, Content performance, Monetisation, Economy, Platforms
 * & tech health and Integrity over a range of WAT days and a
 * platform. Straight from Postgres at launch volumes, like the Overview: activity from
 * `analytics_events`, new players and sign-ups from `users` and `auth_identities` (so the numbers
 * match the Overview, AD-6), matches, purchases and coins from the game's own tables. ClickHouse
 * takes over in M3 behind the same responses. Counts only; nobody is named.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEventName, TRACKING_PLAN } from '@whosabi/analytics';
import { pseudonymousId } from '@whosabi/analytics/server';
import { addDays, daysBetween, isoWeekStart, watDate } from '@whosabi/game-rules';
import {
  ANALYTICS_BOARD_PERMISSION,
  ANALYTICS_MAX_DAYS,
  AnalyticsBoard,
  AnalyticsQuery,
  ErrorCode,
  FUNNEL_MAX_STEPS,
  READY_FUNNELS,
  type AnalyticsRange,
  type AnalyticsResponse,
  type ContentBoard,
  type EconomyBoard,
  type EngagementBoard,
  type FunnelsBoard,
  type GameplayBoard,
  type GrowthBoard,
  type IntegrityBoard,
  type MonetisationBoard,
  type MoneyByCurrency,
  type RetentionBoard,
  type TechBoard,
} from '@whosabi/shared-types';
import type { AppDeps } from '../app';
import { ApiError, parse } from '../errors';
import { requireAdmin, type AdminDeps } from './context';

const WAT = 3_600_000;
const MINUTE = 60_000;
/** One player, signed in or not, in the analytics events (as on the Overview). */
const playerIn = (table?: string) => {
  const column = (name: string) => (table ? `${table}.${name}` : name);
  return `coalesce(nullif(${column('user_pid')}, ''), nullif(${column('anon_id')}, ''))`;
};
const PLAYER = playerIn();
const LAGOS_DAY = "(ts AT TIME ZONE 'Africa/Lagos')::date";
/** Everyone but the Sabi Bot, counted as the Overview counts new players. */
const PLAYING = "status <> 'bot'";
const RETENTION_DAYS = 30;
/** Each store's platform, for the platform filter on purchases. */
const STORE_PLATFORM = "CASE store WHEN 'play' THEN 'android' WHEN 'app_store' THEN 'ios' ELSE 'web' END";

const DUEL_OUTCOMES: Record<string, string> = {
  complete: 'Finished',
  forfeit: 'Forfeited',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
const PARTY_SIZES = [
  ['2', 2],
  ['3–4', 4],
  ['5–8', 8],
  ['9–15', 15],
  ['16 or more', Infinity],
] as const;
/** Balance buckets: each starts where the one before ends (`width_bucket` bounds). */
const BALANCE_BUCKETS = ['1–99', '100–499', '500–1,999', '2,000–9,999', '10,000 or more'];
const BALANCE_BOUNDS = [100, 500, 2_000, 10_000];
/** Content performance flags a question after this many answers, if nearly all or few get it right. */
const FLAG_MIN_PLAYS = 30;
const TOO_EASY = 0.9;
const TOO_HARD = 0.15;

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

  /** Days up to today in the range, each with the row the query found for it, or none. */
  function eachDay<T extends { day: string }>(
    r: Range,
    rows: T[],
  ): Array<{ day: string; row: T | undefined }> {
    const byDay = new Map(rows.map((row) => [row.day, row]));
    return r.days.filter((day) => day <= r.today).map((day) => ({ day, row: byDay.get(day) }));
  }

  async function gameplay(r: Range): Promise<GameplayBoard> {
    const span = (column: string) => `${column} >= $1 AND ${column} < $2`;
    const at = [r.start, r.end];
    const args = [r.start, r.end, r.platformOrNull];
    const events = `FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)`;
    const [duels, outcomes, sources, parties, dailies, answers, lifelines] = await Promise.all([
      pool.query<{ day: string; duels: number; forfeits: number; hours: number | null }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS duels,
                count(*) FILTER (WHERE state = 'forfeit')::int AS forfeits,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS hours
           FROM (SELECT (completed_at AT TIME ZONE 'Africa/Lagos')::date AS day, state,
                        extract(epoch FROM completed_at - created_at) / 3600 AS hours
                   FROM duels WHERE state IN ('complete', 'forfeit') AND ${span('completed_at')}) d
          GROUP BY ROLLUP (day)`,
        at,
      ),
      pool.query<{ state: string; n: number }>(
        `SELECT state::text, count(*)::int AS n FROM duels WHERE ${span('created_at')} GROUP BY 1`,
        at,
      ),
      pool.query<{ source: string; n: number }>(
        `SELECT source, count(*)::int AS n FROM duels WHERE ${span('created_at')} GROUP BY 1 ORDER BY 2 DESC`,
        at,
      ),
      pool.query<{ day: string; players: number; guests: number }>(
        `SELECT to_char((g.ended_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day,
                count(r.player_ref)::int AS players,
                count(r.player_ref) FILTER (WHERE r.kind = 'web_guest')::int AS guests
           FROM party_games g LEFT JOIN party_results r ON r.game_id = g.id
          WHERE ${span('g.ended_at')}
          GROUP BY g.id, 1`,
        at,
      ),
      pool.query<{ day: string; correct: number; n: number }>(
        `SELECT to_char((completed_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day,
                correct_count AS correct, count(*)::int AS n
           FROM daily_results WHERE ${span('completed_at')} GROUP BY 1, 2`,
        at,
      ),
      pool.query<{ category: string; n: number; hits: number }>(
        `SELECT props->>'category' AS category, count(*)::int AS n,
                count(*) FILTER (WHERE (props->>'correct')::boolean)::int AS hits
           ${events} AND event = 'question_answered' GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{ type: string; coins: number; ads: number }>(
        `SELECT props->>'type' AS type,
                count(*) FILTER (WHERE props->>'paid_with' = 'coins')::int AS coins,
                count(*) FILTER (WHERE props->>'paid_with' = 'ad')::int AS ads
           ${events} AND event = 'lifeline_used' GROUP BY 1 ORDER BY count(*) DESC`,
        args,
      ),
    ]);

    const total = duels.rows.find((d) => d.day === null);
    const perDay = duels.rows.filter((d) => d.day !== null);
    const partyDays = new Map<string, number>();
    for (const g of parties.rows) partyDays.set(g.day, (partyDays.get(g.day) ?? 0) + 1);
    const dailyDays = new Map<string, number>();
    const scores = Array.from({ length: 8 }, (_, correct) => ({ correct, players: 0 }));
    for (const d of dailies.rows) {
      dailyDays.set(d.day, (dailyDays.get(d.day) ?? 0) + d.n);
      if (d.correct >= 0 && d.correct <= 7) scores[d.correct]!.players += d.n;
    }
    const partyPlayers = parties.rows.reduce((sum, g) => sum + g.players, 0);
    const partyGuests = parties.rows.reduce((sum, g) => sum + g.guests, 0);
    const sizes = PARTY_SIZES.map(([size]) => ({ size, games: 0 }));
    for (const g of parties.rows) {
      const i = PARTY_SIZES.findIndex(([, most]) => g.players <= most);
      if (i >= 0) sizes[i]!.games += 1;
    }
    const outcomeCounts = new Map<string, number>();
    for (const o of outcomes.rows) {
      const outcome = DUEL_OUTCOMES[o.state] ?? 'Still going';
      outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + o.n);
    }
    const answered = answers.rows.reduce((sum, a) => sum + a.n, 0);
    const right = answers.rows.reduce((sum, a) => sum + a.hits, 0);
    return {
      board: 'gameplay',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        duels_finished: total?.duels ?? 0,
        forfeit_rate: total ? share(total.forfeits, total.duels) : null,
        duel_hours_median: total?.hours ?? null,
        party_games: parties.rows.length,
        party_players_avg: parties.rows.length ? partyPlayers / parties.rows.length : null,
        web_guest_share: share(partyGuests, partyPlayers),
        dailies_finished: scores.reduce((sum, d) => sum + d.players, 0),
        correct_rate: share(right, answered),
      },
      days: eachDay(r, perDay).map(({ day, row }) => ({
        day,
        duels: row?.duels ?? 0,
        party_games: partyDays.get(day) ?? 0,
        dailies: dailyDays.get(day) ?? 0,
      })),
      duel_outcomes: [...outcomeCounts]
        .sort((a, b) => b[1] - a[1])
        .map(([outcome, n]) => ({ outcome, duels: n })),
      duel_sources: sources.rows.map((d) => ({ source: d.source, duels: d.n })),
      party_sizes: sizes,
      daily_scores: scores,
      categories: answers.rows.map((a) => ({
        category: a.category,
        answers: a.n,
        correct_rate: a.hits / a.n,
      })),
      lifelines: lifelines.rows.map((l) => ({ type: l.type, with_coins: l.coins, with_ads: l.ads })),
    };
  }

  async function monetisation(r: Range): Promise<MonetisationBoard> {
    const args = [r.start, r.end, r.platformOrNull];
    const real = `environment = 'production' AND ($3::text IS NULL OR ${STORE_PLATFORM} = $3)`;
    const events = `FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)`;
    const [bought, refunds, products, payers, players, ads, adMoney, placements] = await Promise.all([
      pool.query<{ day: string; n: number; micros: string | null }>(
        `SELECT to_char((created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n,
                sum(price_micros) FILTER (WHERE status = 'completed' AND currency = 'NGN') AS micros
           FROM purchases WHERE ${real} AND status <> 'pending' AND created_at >= $1 AND created_at < $2
          GROUP BY 1`,
        args,
      ),
      pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM purchases WHERE ${real} AND refunded_at >= $1 AND refunded_at < $2`,
        args,
      ),
      pool.query<{ product_id: string; n: number; micros: string | null }>(
        `SELECT product_id, count(*)::int AS n, sum(price_micros) FILTER (WHERE currency = 'NGN') AS micros
           FROM purchases WHERE ${real} AND status = 'completed' AND created_at >= $1 AND created_at < $2
          GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{ n: number }>(
        `SELECT count(DISTINCT user_id)::int AS n FROM purchases
          WHERE ${real} AND status = 'completed' AND created_at >= $1 AND created_at < $2`,
        args,
      ),
      // Players active in the range, and player-days (the sum of each day's DAU).
      pool.query<{ players: number; player_days: number }>(
        `SELECT count(DISTINCT ${PLAYER})::int AS players,
                count(DISTINCT (${PLAYER}, ${LAGOS_DAY})) FILTER (WHERE ${PLAYER} IS NOT NULL)::int AS player_days
           ${events}`,
        args,
      ),
      pool.query<{ day: string; shown: number; asked: number; rewarded: number }>(
        `SELECT to_char(${LAGOS_DAY}, 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE event = 'ad_shown')::int AS shown,
                count(*) FILTER (WHERE event = 'ad_requested')::int AS asked,
                count(*) FILTER (WHERE event = 'ad_reward_granted')::int AS rewarded
           ${events} AND event IN ('ad_shown', 'ad_requested', 'ad_reward_granted') GROUP BY 1`,
        args,
      ),
      pool.query<{ currency: string; micros: string }>(
        `SELECT props->>'currency' AS currency, sum((props->>'value_micros')::bigint) AS micros
           ${events} AND event = 'ad_paid' GROUP BY 1`,
        args,
      ),
      pool.query<{ format: string; placement: string; n: number }>(
        `SELECT props->>'format' AS format, props->>'placement' AS placement, count(*)::int AS n
           ${events} AND event = 'ad_shown' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
        args,
      ),
    ]);

    const naira = (micros: string | null) => (micros === null ? 0 : Number(micros) / 1e6);
    const adDays = new Map(ads.rows.map((a) => [a.day, a]));
    const days = eachDay(r, bought.rows).map(({ day, row }) => ({
      day,
      store_ngn: naira(row?.micros ?? null),
      purchases: row?.n ?? 0,
      rewarded_views: adDays.get(day)?.rewarded ?? 0,
      ads_shown: adDays.get(day)?.shown ?? 0,
    }));
    const revenue = bought.rows.reduce((sum, d) => sum + naira(d.micros), 0);
    const payerCount = payers.rows[0]!.n;
    const { players: active, player_days: playerDays } = players.rows[0]!;
    const shown = ads.rows.reduce((sum, a) => sum + a.shown, 0);
    const asked = ads.rows.reduce((sum, a) => sum + a.asked, 0);
    const rewarded = ads.rows.reduce((sum, a) => sum + a.rewarded, 0);
    const adRevenue: MoneyByCurrency = {};
    for (const a of adMoney.rows) adRevenue[a.currency] = Number(a.micros) / 1e6;
    return {
      board: 'monetisation',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        store_revenue_ngn: revenue,
        purchases: bought.rows.reduce((sum, d) => sum + d.n, 0),
        refunds: refunds.rows[0]!.n,
        payers: payerCount,
        payer_conversion: share(payerCount, active),
        arppu_ngn: payerCount > 0 ? revenue / payerCount : null,
        arpdau_ngn: playerDays > 0 ? revenue / playerDays : null,
        ad_revenue: adRevenue,
        ads_shown: shown,
        fill_rate: share(shown, asked),
        rewarded_views: rewarded,
        rewarded_per_dau: playerDays > 0 ? rewarded / playerDays : null,
      },
      days,
      by_product: products.rows.map((p) => ({
        product_id: p.product_id,
        purchases: p.n,
        revenue_ngn: naira(p.micros),
      })),
      ad_placements: placements.rows.map((p) => ({ format: p.format, placement: p.placement, shown: p.n })),
    };
  }

  async function economy(r: Range): Promise<EconomyBoard> {
    const [moves, balances] = await Promise.all([
      // Coins on players' balances, by day and reason; a guest's coins moving into an account are neither.
      pool.query<{ day: string; reason: string; earned: string; spent: string }>(
        `SELECT to_char((e.created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day, t.reason,
                coalesce(sum(e.amount) FILTER (WHERE e.amount > 0), 0) AS earned,
                coalesce(-sum(e.amount) FILTER (WHERE e.amount < 0), 0) AS spent
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id
           JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE a.owner_user_id IS NOT NULL AND a.currency = 'coins' AND t.reason <> 'merge'
            AND e.created_at >= $1 AND e.created_at < $2
          GROUP BY 1, 2`,
        [r.start, r.end],
      ),
      // Today's balances, counted in the database: a few rows however many players hold coins.
      pool.query<{ bucket: number; players: number; holders: number; median: number | null }>(
        `SELECT width_bucket(a.balance, $1::bigint[]) AS bucket, count(*)::int AS players,
                sum(count(*)) OVER ()::int AS holders,
                (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h.balance)
                   FROM ledger_accounts h JOIN users hu ON hu.id = h.owner_user_id
                  WHERE h.currency = 'coins' AND h.balance > 0 AND hu.status <> 'bot') AS median
           FROM ledger_accounts a JOIN users u ON u.id = a.owner_user_id
          WHERE a.currency = 'coins' AND a.balance > 0 AND u.status <> 'bot'
          GROUP BY 1`,
        [BALANCE_BOUNDS],
      ),
    ]);

    const byDay = new Map<string, { day: string; earned: number; spent: number }>();
    const sources = new Map<string, number>();
    const sinks = new Map<string, number>();
    for (const m of moves.rows) {
      const earned = Number(m.earned);
      const spent = Number(m.spent);
      const d = byDay.get(m.day) ?? { day: m.day, earned: 0, spent: 0 };
      d.earned += earned;
      d.spent += spent;
      byDay.set(m.day, d);
      if (earned) sources.set(m.reason, (sources.get(m.reason) ?? 0) + earned);
      if (spent) sinks.set(m.reason, (sinks.get(m.reason) ?? 0) + spent);
    }
    const earned = [...sources.values()].reduce((sum, n) => sum + n, 0);
    const spent = [...sinks.values()].reduce((sum, n) => sum + n, 0);
    const held = balances.rows[0];
    const sorted = (m: Map<string, number>) =>
      [...m].sort((a, b) => b[1] - a[1]).map(([reason, coins]) => ({ reason, coins }));
    return {
      board: 'economy',
      from: r.from,
      to: r.to,
      // The ledger knows no platforms: every platform, always.
      platform: 'all',
      summary: {
        earned,
        spent,
        inflation: spent > 0 ? earned / spent : null,
        holders: held?.holders ?? 0,
        balance_median: held?.median ?? null,
      },
      days: eachDay(r, [...byDay.values()]).map(({ day, row }) => ({
        day,
        earned: row?.earned ?? 0,
        spent: row?.spent ?? 0,
      })),
      sources: sorted(sources),
      sinks: sorted(sinks),
      balances: BALANCE_BUCKETS.map((bucket, i) => ({
        bucket,
        players: balances.rows.find((b) => b.bucket === i)?.players ?? 0,
      })),
    };
  }

  async function funnels(r: Range, query: AnalyticsQuery): Promise<FunnelsBoard> {
    const id = query.funnel;
    let funnel: string;
    let steps: Array<{ label: string; events: string[] }>;
    if (id === 'custom') {
      const names = (query.steps ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
      const unknown = names.filter((e) => !isEventName(e));
      if (names.length < 2 || names.length > FUNNEL_MAX_STEPS || unknown.length > 0) {
        throw badRange(
          `A funnel takes 2 to ${FUNNEL_MAX_STEPS} known events${unknown.length ? `, not ${unknown.join(', ')}` : ''}.`,
        );
      }
      funnel = 'custom';
      steps = names.map((e) => ({ label: e, events: [e] }));
    } else {
      funnel = id && READY_FUNNELS[id] ? id : 'first_time';
      steps = READY_FUNNELS[funnel]!.steps;
    }
    const window = query.window ?? 24;

    // Step 1 in the range; each next step after the step before, within the window of step 1.
    const ctes = steps.map((_, i) =>
      i === 0
        ? `s0 AS (SELECT ${PLAYER} AS p, min(ts) AS first, min(ts) AS t FROM analytics_events
                   WHERE event = ANY($4) AND ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)
                     AND ${PLAYER} IS NOT NULL
                   GROUP BY 1)`
        : `s${i} AS (SELECT s.p, s.first, min(e.ts) AS t FROM s${i - 1} s
                     JOIN analytics_events e ON ${playerIn('e')} = s.p
                    WHERE e.event = ANY($${i + 4}) AND e.ts >= s.t AND e.ts < s.first + make_interval(hours => $${steps.length + 4})
                      AND ($3::text IS NULL OR e.platform = $3)
                    GROUP BY s.p, s.first)`,
    );
    const counted = await pool.query<Record<string, number>>(
      `WITH ${ctes.join(',\n')}
       SELECT ${steps.map((_, i) => `(SELECT count(*) FROM s${i})::int AS n${i}`).join(', ')}`,
      [r.start, r.end, r.platformOrNull, ...steps.map((s) => s.events), window],
    );
    const players = steps.map((_, i) => counted.rows[0]![`n${i}`] ?? 0);
    return {
      board: 'funnels',
      from: r.from,
      to: r.to,
      platform: r.platform,
      funnel,
      window_hours: window,
      steps: steps.map((s, i) => ({
        label: s.label,
        events: [...s.events],
        players: players[i]!,
        of_first: i === 0 ? null : share(players[i]!, players[0]!),
        of_previous: i === 0 ? null : share(players[i]!, players[i - 1]!),
      })),
      ready: Object.entries(READY_FUNNELS).map(([key, f]) => ({ id: key, title: f.title })),
      events: Object.keys(TRACKING_PLAN).sort(),
    };
  }

  async function content(r: Range): Promise<ContentBoard> {
    const args = [r.start, r.end, r.platformOrNull];
    const answers = `analytics_events WHERE event = 'question_answered' AND ts >= $1 AND ts < $2
                       AND ($3::text IS NULL OR platform = $3)`;
    const [totals, categories, questions, reports] = await Promise.all([
      pool.query<{ answers: number; questions: number; hits: number; too_easy: number; too_hard: number }>(
        `WITH q AS (SELECT props->>'qid' AS id, count(*) AS n,
                           count(*) FILTER (WHERE (props->>'correct')::boolean) AS hits
                      FROM ${answers} GROUP BY 1)
         SELECT coalesce(sum(n), 0)::int AS answers, count(*)::int AS questions, coalesce(sum(hits), 0)::int AS hits,
                count(*) FILTER (WHERE n >= ${FLAG_MIN_PLAYS} AND hits >= n * ${TOO_EASY})::int AS too_easy,
                count(*) FILTER (WHERE n >= ${FLAG_MIN_PLAYS} AND hits <= n * ${TOO_HARD})::int AS too_hard
           FROM q`,
        args,
      ),
      pool.query<{ category: string; n: number; hits: number; avg_ms: number }>(
        `SELECT props->>'category' AS category, count(*)::int AS n,
                count(*) FILTER (WHERE (props->>'correct')::boolean)::int AS hits,
                avg((props->>'accepted_elapsed_ms')::int)::float AS avg_ms
           FROM ${answers} GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{
        id: string;
        text: string | null;
        category: string;
        difficulty: number | null;
        n: number;
        hits: number;
        avg_ms: number;
        reports: number;
      }>(
        `WITH a AS (SELECT props->>'qid' AS id, min(props->>'category') AS category, count(*)::int AS n,
                           count(*) FILTER (WHERE (props->>'correct')::boolean)::int AS hits,
                           avg((props->>'accepted_elapsed_ms')::int)::float AS avg_ms
                      FROM ${answers} GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 50)
         SELECT a.*, q.text, q.difficulty,
                (SELECT count(*) FROM question_reports r
                  WHERE r.question_id = a.id AND r.created_at >= $1 AND r.created_at < $2)::int AS reports
           FROM a LEFT JOIN questions q ON q.id = a.id
          ORDER BY a.n DESC, a.id`,
        args,
      ),
      // Reports come from every platform.
      pool.query<{ category: string; n: number }>(
        `SELECT q.category_id AS category, count(*)::int AS n
           FROM question_reports r JOIN questions q ON q.id = r.question_id
          WHERE r.created_at >= $1 AND r.created_at < $2 GROUP BY 1`,
        [r.start, r.end],
      ),
    ]);
    const t = totals.rows[0]!;
    const reportsBy = new Map(reports.rows.map((x) => [x.category, x.n]));
    const reportCount = reports.rows.reduce((sum, x) => sum + x.n, 0);
    const flag = (n: number, hits: number): 'too_easy' | 'too_hard' | null =>
      n < FLAG_MIN_PLAYS
        ? null
        : hits >= n * TOO_EASY
          ? 'too_easy'
          : hits <= n * TOO_HARD
            ? 'too_hard'
            : null;
    return {
      board: 'content',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        answers: t.answers,
        questions_played: t.questions,
        correct_rate: share(t.hits, t.answers),
        reports: reportCount,
        reports_per_1k: t.answers > 0 ? (reportCount / t.answers) * 1000 : null,
        too_easy: t.too_easy,
        too_hard: t.too_hard,
      },
      categories: categories.rows.map((c) => ({
        category: c.category,
        answers: c.n,
        correct_rate: c.hits / c.n,
        avg_ms: Math.round(c.avg_ms),
        reports: reportsBy.get(c.category) ?? 0,
      })),
      questions: questions.rows.map((q) => ({
        id: q.id,
        text: q.text ?? '(no longer in the bank)',
        category: q.category,
        difficulty: q.difficulty ?? 0,
        plays: q.n,
        correct_rate: q.hits / q.n,
        avg_ms: Math.round(q.avg_ms),
        reports: q.reports,
        flag: flag(q.n, q.hits),
      })),
    };
  }

  async function tech(r: Range): Promise<TechBoard> {
    const args = [r.start, r.end, r.platformOrNull];
    const events = `FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ($3::text IS NULL OR platform = $3)`;
    const [starts, byRam, versions, otp, push, connection, vitals] = await Promise.all([
      pool.query<{ p50: number | null; p90: number | null }>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'cold_start_ms')::int) AS p50,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY (props->>'cold_start_ms')::int) AS p90
           ${events} AND event = 'app_opened' AND props ? 'cold_start_ms'`,
        args,
      ),
      pool.query<{ ram: string; opens: number; p50: number | null }>(
        `SELECT CASE WHEN ram_mb = 0 THEN 'Not reported' WHEN ram_mb < 2048 THEN 'Under 2 GB'
                     WHEN ram_mb < 3072 THEN '2–3 GB' WHEN ram_mb < 4096 THEN '3–4 GB' ELSE '4 GB or more' END AS ram,
                count(*)::int AS opens,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'cold_start_ms')::int) AS p50
           ${events} AND event = 'app_opened' AND props ? 'cold_start_ms'
          GROUP BY 1 ORDER BY min(ram_mb)`,
        args,
      ),
      pool.query<{ platform: string; app_version: string; players: number }>(
        `SELECT platform, app_version, count(DISTINCT ${PLAYER})::int AS players
           ${events} AND source = 'client' AND app_version <> '' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
        args,
      ),
      pool.query<{ provider: string; sent: number; verified: number; failed: number }>(
        `SELECT props->>'provider' AS provider,
                count(*) FILTER (WHERE event = 'otp_sent')::int AS sent,
                count(*) FILTER (WHERE event = 'otp_verified')::int AS verified,
                count(*) FILTER (WHERE event = 'otp_failed')::int AS failed
           ${events} AND event IN ('otp_sent', 'otp_verified', 'otp_failed') GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{ type: string; sent: number; received: number; opened: number }>(
        `SELECT props->>'type' AS type,
                count(*) FILTER (WHERE event = 'push_sent')::int AS sent,
                count(*) FILTER (WHERE event = 'push_received')::int AS received,
                count(*) FILTER (WHERE event = 'push_opened')::int AS opened
           ${events} AND event IN ('push_sent', 'push_received', 'push_opened') GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{ mode: string; lost: number; restored: number; gap: number | null }>(
        `SELECT props->>'mode' AS mode,
                count(*) FILTER (WHERE event = 'connection_lost')::int AS lost,
                count(*) FILTER (WHERE event = 'connection_restored')::int AS restored,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'gap_ms')::int)
                  FILTER (WHERE event = 'connection_restored') AS gap
           ${events} AND event IN ('connection_lost', 'connection_restored') GROUP BY 1 ORDER BY 2 DESC`,
        args,
      ),
      pool.query<{ lcp: number | null; inp: number | null; cls: number | null }>(
        `SELECT percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'lcp_ms')::int) AS lcp,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'inp_ms')::int) AS inp,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'cls')::float) AS cls
           ${events} AND event = 'web_vitals'`,
        args,
      ),
    ]);
    const sum = <T>(rows: T[], key: keyof T) => rows.reduce((total, row) => total + Number(row[key]), 0);
    const v = vitals.rows[0]!;
    return {
      board: 'tech',
      from: r.from,
      to: r.to,
      platform: r.platform,
      summary: {
        cold_start_p50_ms: starts.rows[0]!.p50,
        cold_start_p90_ms: starts.rows[0]!.p90,
        otp_success: share(sum(otp.rows, 'verified'), sum(otp.rows, 'sent')),
        push_opened: share(sum(push.rows, 'opened'), sum(push.rows, 'sent')),
        reconnected: share(sum(connection.rows, 'restored'), sum(connection.rows, 'lost')),
        web_lcp_p75_ms: v.lcp,
        web_inp_p75_ms: v.inp,
        web_cls_p75: v.cls,
      },
      cold_start_by_ram: byRam.rows.map((x) => ({ ram: x.ram, opens: x.opens, p50_ms: x.p50 })),
      versions: versions.rows,
      otp: otp.rows,
      push: push.rows,
      connection: connection.rows.map((c) => ({
        mode: c.mode,
        lost: c.lost,
        restored: c.restored,
        gap_p50_ms: c.gap,
      })),
    };
  }

  async function integrity(r: Range): Promise<IntegrityBoard> {
    const at = [r.start, r.end];
    const [flags, open, actions] = await Promise.all([
      pool.query<{ day: string; kind: string; status: string; n: number }>(
        `SELECT to_char((created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day, kind, status,
                count(*)::int AS n
           FROM integrity_flags WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2, 3`,
        at,
      ),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM integrity_flags WHERE status = 'open'`),
      pool.query<{ day: string; action: string; n: number }>(
        `SELECT to_char((created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day, action,
                count(*)::int AS n
           FROM moderation_actions WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2`,
        at,
      ),
    ]);
    const kinds = new Map<
      string,
      { kind: string; flags: number; open: number; dismissed: number; actioned: number }
    >();
    const flagDays = new Map<string, number>();
    for (const f of flags.rows) {
      const k = kinds.get(f.kind) ?? { kind: f.kind, flags: 0, open: 0, dismissed: 0, actioned: 0 };
      k.flags += f.n;
      if (f.status === 'open' || f.status === 'dismissed' || f.status === 'actioned') k[f.status] += f.n;
      kinds.set(f.kind, k);
      flagDays.set(f.day, (flagDays.get(f.day) ?? 0) + f.n);
    }
    const byAction = new Map<string, number>();
    const actionDays = new Map<string, number>();
    for (const a of actions.rows) {
      byAction.set(a.action, (byAction.get(a.action) ?? 0) + a.n);
      actionDays.set(a.day, (actionDays.get(a.day) ?? 0) + a.n);
    }
    const all = [...kinds.values()];
    return {
      board: 'integrity',
      from: r.from,
      to: r.to,
      // Flags and actions know no platforms.
      platform: 'all',
      summary: {
        flags: all.reduce((total, k) => total + k.flags, 0),
        open_now: open.rows[0]!.n,
        dismissed: all.reduce((total, k) => total + k.dismissed, 0),
        actioned: all.reduce((total, k) => total + k.actioned, 0),
        actions: [...byAction.values()].reduce((total, n) => total + n, 0),
      },
      days: r.days
        .filter((day) => day <= r.today)
        .map((day) => ({ day, flags: flagDays.get(day) ?? 0, actions: actionDays.get(day) ?? 0 })),
      kinds: all.sort((a, b) => b.flags - a.flags),
      actions: [...byAction].sort((a, b) => b[1] - a[1]).map(([action, count]) => ({ action, count })),
    };
  }

  app.get('/admin/analytics/:board', async (request): Promise<AnalyticsResponse> => {
    const { board } = parse(Params, request.params);
    await requireAdmin(request, ctx, ANALYTICS_BOARD_PERMISSION[board]);
    const query = parse(AnalyticsQuery, request.query);
    const range = rangeOf(query, clock.now());
    switch (board) {
      case 'engagement':
        return engagement(range);
      case 'growth':
        return growth(range);
      case 'retention':
        return retention(range);
      case 'gameplay':
        return gameplay(range);
      case 'monetisation':
        return monetisation(range);
      case 'economy':
        return economy(range);
      case 'funnels':
        return funnels(range, query);
      case 'content':
        return content(range);
      case 'tech':
        return tech(range);
      case 'integrity':
        return integrity(range);
    }
  });
}
