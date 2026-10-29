import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import {
  PartyCloseCode,
  type AdminRole,
  type ConsoleOverview,
  type CreatePartyResponse,
  type LiveFeed,
  type LiveOnline,
  type LiveRooms,
  type PartySeat,
} from '@whosabi/shared-types';
import { raiseStaffAlert } from '../src/admin/alerts';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { withTransaction } from '../src/db';
import { grantCoins, spendCoins } from '../src/economy/ledger';
import { ServerEvents } from '../src/events';
import { newId } from '../src/ids';
import { AnalyticsLoader } from '../src/jobs/analyticsLoader';
import { bearer, createTestApp, signInGuest } from './helpers';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// A quiet day no other test file plays on: 15 June 2027, 14:00 WAT.
const NOW = Date.UTC(2027, 5, 15, 13, 0, 0);
const TODAY = Date.UTC(2027, 5, 14, 23, 0, 0); // midnight WAT

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp(
    {},
    { partyTimings: { countdownMs: 20, revealMs: 20, leaderboardMs: 20, graceMs: 50 } },
  );
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(async () => {
  // The test database is shared by every file, and others count whatever is after their own
  // clock (2026): leave nothing dated 2027 behind.
  const future = new Date(Date.UTC(2027, 0, 1));
  await t.pool.query('DELETE FROM analytics_events WHERE ts >= $1', [future]);
  await t.pool.query('DELETE FROM analytics_daily WHERE day >= $1', [future]);
  await t.pool.query('UPDATE users SET last_seen_at = NULL WHERE last_seen_at >= $1', [future]);
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `console${randomInt(1e9)}@whosabi.ng`,
    roles.join('+'),
  ]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return (await sessions.create(id)).token;
}

const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (token: string, url: string, payload: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(token), payload });

/** A player straight in the database, made and last seen when we say. */
async function playerRow(fields: {
  createdAt: number;
  lastSeen?: number;
  platform?: 'android' | 'ios' | 'web';
  state?: string;
  source?: string;
  status?: string;
}): Promise<string> {
  const id = newId('u');
  await t.pool.query(
    `INSERT INTO users (id, status, created_at, last_seen_at, last_platform, home_state, acquisition_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      fields.status ?? 'guest',
      new Date(fields.createdAt),
      fields.lastSeen ? new Date(fields.lastSeen) : null,
      fields.platform ?? null,
      fields.state ?? null,
      fields.source ?? null,
    ],
  );
  return id;
}

async function event(
  name: string,
  at: number,
  fields: { pid?: string; platform?: string; state?: string; session?: string; props?: object } = {},
) {
  await t.pool.query(
    `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, session_id, platform, home_state, props)
     VALUES ($1, $2, 'client', $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      name,
      new Date(at),
      fields.pid ?? '',
      fields.session ?? '',
      fields.platform ?? 'android',
      fields.state ?? '',
      JSON.stringify(fields.props ?? {}),
    ],
  );
}

describe("the console's Overview (step 2.7a)", () => {
  it('shows today so far against last week, time, money, queues, alerts and the charts', async () => {
    t.clock.t = NOW;
    const owner = await staff(['owner']);
    const support = await staff(['support']);
    expect((await get(support, '/admin/console/overview')).statusCode).toBe(403);

    // Two players online now (one on Android, one on the web), one gone quiet.
    await playerRow({
      createdAt: TODAY + HOUR,
      lastSeen: NOW - MINUTE,
      platform: 'android',
      source: 'invite',
    });
    await playerRow({ createdAt: TODAY + 2 * HOUR, lastSeen: NOW - 2 * MINUTE, platform: 'web' });
    await playerRow({ createdAt: TODAY - WEEK + HOUR, lastSeen: NOW - HOUR, platform: 'android' });
    await playerRow({ createdAt: TODAY + HOUR, status: 'bot' });

    // Players in the events: two today (Lagos), one at this time last week.
    for (const pid of ['p1', 'p2']) {
      await event('screen_viewed', TODAY + 9 * HOUR, { pid, state: 'LA' });
    }
    await event('screen_viewed', TODAY - WEEK + 9 * HOUR, { pid: 'p9' });
    await event('app_backgrounded', TODAY + 10 * HOUR, {
      pid: 'p1',
      session: 's1',
      props: { foreground_ms: 120_000 },
    });
    await event('app_backgrounded', TODAY + 10 * HOUR, {
      pid: 'p2',
      session: 's2',
      props: { foreground_ms: 60_000 },
    });
    for (let i = 0; i < 3; i++) {
      await event('question_answered', TODAY + 11 * HOUR, { pid: 'p1', props: { category: 'music' } });
    }
    await t.pool.query(
      "INSERT INTO analytics_daily (day, platform, event, events, players) VALUES ('2027-06-14', '*', '*', 40, 5)",
    );

    // Money: one real purchase, one test, a rewarded ad, coins earned and spent.
    const buyer = await playerRow({ createdAt: TODAY - 30 * DAY });
    await withTransaction(t.pool, async (c) => {
      await grantCoins(c, buyer, 300, { key: `console:${buyer}:a`, reason: 'admin_grant', now: NOW - HOUR });
      await spendCoins(c, buyer, 100, { key: `console:${buyer}:b`, reason: 'lifeline', now: NOW - HOUR });
    });
    for (const [env, tx] of [
      ['production', randomUUID()],
      ['sandbox', randomUUID()],
    ] as const) {
      await t.pool.query(
        `INSERT INTO purchases (id, user_id, store, product_id, store_tx_id, price_micros, currency, status,
                                environment, coins, created_at)
         VALUES ($1, $2, 'play', 'coins_medium', $3, 800000000, 'NGN', 'completed', $4, 1500, $5)`,
        [newId('pu'), buyer, tx, env, new Date(NOW - HOUR)],
      );
    }
    await t.pool.query(
      "INSERT INTO dsar_requests (id, user_id, kind, status, due_at) VALUES ($1, $2, 'access', 'received', $3)",
      [randomUUID(), buyer, new Date(NOW + 3 * DAY)],
    );
    await raiseStaffAlert(t.pool, {
      kind: 'problem',
      title: 'Console test problem',
      body: 'Something broke.',
      now: NOW - HOUR,
    });

    const res = await get(owner, '/admin/console/overview');
    expect(res.statusCode, res.body).toBe(200);
    const o = res.json() as ConsoleOverview;
    expect(o.online).toMatchObject({ total: 2, android: 1, ios: 0, web: 1 });
    expect(o.online.last_24h).toHaveLength(24);
    expect(o.today.active_players).toEqual({ today: 2, last_week: 1 });
    expect(o.today.new_players).toEqual({ today: 2, last_week: 1 });
    expect(o.time).toEqual({ minutes_per_player: 1.5, median_session_minutes: 1.5 });
    expect(o.money).toEqual({
      purchases: 1,
      revenue_ngn: 800,
      test_purchases: 1,
      rewarded_ads: 0,
      coins_earned: 300,
      coins_spent: 100,
    });
    expect(o.queues.dsars_due).toBeGreaterThanOrEqual(1);
    expect(o.alerts[0]).toMatchObject({ title: 'Console test problem', body: 'Something broke.' });
    expect(o.charts.active_30d).toHaveLength(30);
    expect(o.charts.active_30d[0]).toEqual({ day: '2027-05-17', players: 0 });
    expect(o.charts.active_30d.at(-2)).toEqual({ day: '2027-06-14', players: 5 });
    expect(o.charts.active_30d.at(-1)).toEqual({ day: '2027-06-15', players: 2 });
    expect(o.charts.by_hour).toContainEqual({ hour: 9, today: 2, last_week: 1 });
    expect(o.charts.top_states).toEqual([{ state: 'LA', players: 2 }]);
    expect(o.charts.top_categories).toEqual([{ category: 'music', answers: 3 }]);
    expect(o.charts.new_by_source).toEqual([
      { source: 'invite', players: 1 },
      { source: 'organic', players: 1 },
    ]);
  });

  it('counts every player across events and platforms in the daily rollup', async () => {
    const day = '2027-07-01';
    const at = Date.UTC(2027, 6, 1, 12);
    await event('screen_viewed', at, { pid: 'r1', platform: 'android' });
    await event('duel_started', at, { pid: 'r1', platform: 'android' });
    await event('screen_viewed', at, { pid: 'r2', platform: 'web' });
    const deps = {
      pool: t.pool,
      redis: t.redis,
      clock: t.clock,
      events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
      log: t.app.log,
    };
    await new AnalyticsLoader(deps).rollupDay(day);
    const rows = await t.pool.query(
      `SELECT platform, events::int, players::int FROM analytics_daily WHERE day = $1 AND event = '*' ORDER BY platform`,
      [day],
    );
    expect(rows.rows).toEqual([
      { platform: '*', events: 3, players: 2 },
      { platform: 'android', events: 2, players: 1 },
      { platform: 'web', events: 1, players: 1 },
    ]);
  });
});

describe("the console's Live page (step 2.7a)", () => {
  it('lists who is online, by platform and state', async () => {
    t.clock.t = NOW + DAY;
    const analyst = await staff(['analyst']);
    await playerRow({ createdAt: NOW, lastSeen: NOW + DAY - MINUTE, platform: 'ios', state: 'KN' });
    await playerRow({ createdAt: NOW, lastSeen: NOW + DAY - 2 * MINUTE, platform: 'web', state: 'KN' });
    const all = (await get(analyst, '/admin/live/online')).json() as LiveOnline;
    expect(all.total).toBe(2);
    expect(all.players.map((p) => p.platform)).toEqual(['ios', 'web']);
    expect(all.by_state).toEqual([{ state: 'KN', players: 2 }]);
    const ios = (await get(analyst, '/admin/live/online?platform=ios')).json() as LiveOnline;
    expect(ios.total).toBe(1);
  });

  it("shows what just happened without naming anyone, and only what's new on the next look", async () => {
    t.clock.t = NOW + 2 * DAY;
    const analyst = await staff(['analyst']);
    const at = NOW + 2 * DAY - 10 * MINUTE;
    await event('signup_completed', at, { pid: 'f1', props: { method: 'google' } });
    await event('duel_completed', at + MINUTE, { pid: 'f1', props: { result: 'loss' } });
    await event('purchase_completed', at + 2 * MINUTE, { pid: 'f1', props: { sku: 'coins_small' } });
    const feed = (await get(analyst, '/admin/live/feed')).json() as LiveFeed;
    expect(feed.items.map((i) => i.text)).toEqual(['A purchase: coins_small', 'A new account on Android']);
    const later = (await get(analyst, `/admin/live/feed?after=${feed.items[0]!.at}`)).json() as LiveFeed;
    expect(later.items).toEqual([]);
  });

  it('shows the party rooms, and lets a moderator remove a player or close a room, with a reason', async () => {
    const moderator = await staff(['moderator']);
    const analyst = await staff(['analyst']);
    const categories = (
      await t.pool.query<{ id: string }>('SELECT id FROM categories WHERE active')
    ).rows.map((r) => r.id);
    const host = await signInGuest(t.app);
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/party/rooms',
      headers: bearer(host.access),
      payload: {
        settings: {
          questions: 5,
          timer_s: 10,
          family_safe: false,
          wahala: true,
          host_plays: true,
          categories,
        },
        nickname: 'Tolu',
      },
    });
    const { room, seat } = created.json() as CreatePartyResponse;
    const guestSeat = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/party/rooms/${room.code}/join`,
        payload: { nickname: 'Ada' },
      })
    ).json() as PartySeat;
    const hostWs = await open(seat.token);
    const guestWs = await open(guestSeat.token);

    const listed = (await get(analyst, '/admin/live/rooms')).json() as LiveRooms;
    const mine = listed.rooms.find((r) => r.code === room.code)!;
    expect(mine).toMatchObject({ host: 'Tolu', phase: 'lobby', question: null, questions: 5, locked: false });
    expect(mine.players.map((p) => [p.name, p.kind, p.connected])).toEqual([
      ['Tolu', 'app', true],
      ['Ada', 'web_guest', true],
    ]);
    const ada = mine.players.find((p) => p.name === 'Ada')!;
    const tolu = mine.players.find((p) => p.name === 'Tolu')!;

    // Looking is one permission; acting is another, and needs a reason.
    expect(
      (await post(analyst, `/admin/live/rooms/${room.code}/kick`, { player_id: ada.id, reason: 'Abuse' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(moderator, `/admin/live/rooms/${room.code}/kick`, { player_id: ada.id })).statusCode,
    ).toBe(400);
    // The host can't be removed; closing the room does that.
    expect(
      (await post(moderator, `/admin/live/rooms/${room.code}/kick`, { player_id: tolu.id, reason: 'Abuse' }))
        .statusCode,
    ).toBe(404);

    const kicked = await post(moderator, `/admin/live/rooms/${room.code}/kick`, {
      player_id: ada.id,
      reason: 'Abusive nickname, reported by the host',
    });
    expect(kicked.statusCode, kicked.body).toBe(200);
    expect(await closedWith(guestWs)).toBe(PartyCloseCode.kicked);

    const closed = await post(moderator, `/admin/live/rooms/${room.code}/close`, { reason: 'Test room' });
    expect(closed.json()).toEqual({ closed: true });
    expect(await closedWith(hostWs)).toBe(PartyCloseCode.closed);
    expect(
      ((await get(analyst, '/admin/live/rooms')).json() as LiveRooms).rooms.some((r) => r.code === room.code),
    ).toBe(false);
    const audit = await t.pool.query(
      "SELECT action, reason FROM admin_audit_log WHERE entity = 'party_room' AND entity_id = $1 ORDER BY id",
      [room.code],
    );
    expect(audit.rows).toEqual([
      { action: 'party_kick', reason: 'Abusive nickname, reported by the host' },
      { action: 'party_close', reason: 'Test room' },
    ]);
  });
});

async function open(token: string): Promise<{ ws: WebSocket; closed: { code: number } | null }> {
  const holder: { ws: WebSocket; closed: { code: number } | null } = {
    ws: null as unknown as WebSocket,
    closed: null,
  };
  holder.ws = await t.app.injectWS(
    `/v1/party/socket?token=${encodeURIComponent(token)}`,
    {},
    {
      onInit: (ws) => {
        ws.on('close', (code) => {
          holder.closed = { code };
        });
      },
    },
  );
  // Seated once the room has sent its state.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return holder;
}

async function closedWith(holder: { closed: { code: number } | null }): Promise<number | undefined> {
  for (let i = 0; i < 100 && !holder.closed; i++) await new Promise((r) => setTimeout(r, 20));
  return holder.closed?.code;
}
