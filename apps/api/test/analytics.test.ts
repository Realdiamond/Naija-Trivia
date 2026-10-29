/**
 * The console's analytics dashboards (build plan step 2.7j): Engagement & time, Growth & invites
 * and Retention over a range of WAT days and a platform, each number as doc 18 §10 defines it.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { AdminRole, EngagementBoard, GrowthBoard, RetentionBoard } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const MINUTE = 60_000;
/** An instant in May 2028 (a month no other test file plays in), at a WAT time of day. */
const wat = (day: number, hour: number, minute = 0) => Date.UTC(2028, 4, day, hour - 1, minute);

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
let analyst: string;
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = wat(1, 8);
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  analyst = await staff(['analyst']);
});
afterAll(async () => {
  await t.pool.query("DELETE FROM analytics_events WHERE ts >= '2028-04-30' AND ts < '2028-07-01'");
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `analytics-${randomInt(1e9)}@whosabi.ng`,
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

const pid = (userId: string) => pseudonymousId(userId, t.config.analyticsKey);

/** One analytics event, as the loader would have stored it. */
async function event(
  name: string,
  at: number,
  who: { pid?: string; anon?: string; platform: string; session?: string; source?: 'client' | 'server' },
  props: Record<string, unknown> = {},
) {
  await t.pool.query(
    `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, anon_id, session_id, platform, props)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `e_${randomUUID()}`,
      name,
      who.source ?? 'client',
      new Date(at),
      who.pid ?? '',
      who.anon ?? '',
      who.session ?? '',
      who.platform,
      JSON.stringify(props),
    ],
  );
}

async function board<T>(name: string, query: string, token = analyst): Promise<T> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/admin/analytics/${name}${query}`,
    headers: bearer(token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
}

describe('analytics dashboards (step 2.7j)', () => {
  it('lets analysts, growth and viewers in, and checks the range', async () => {
    const get = (url: string, token: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
    expect((await get('/admin/analytics/engagement', await staff(['support']))).statusCode).toBe(403);
    expect((await get('/admin/analytics/retention', await staff(['viewer']))).statusCode).toBe(200);
    expect((await get('/admin/analytics/growth', await staff(['growth']))).statusCode).toBe(200);
    expect((await get('/admin/analytics/nothing', analyst)).statusCode).toBe(400);
    expect((await get('/admin/analytics/growth?from=2028-05-03&to=2028-05-01', analyst)).statusCode).toBe(
      400,
    );
    expect((await get('/admin/analytics/growth?from=2028-01-01&to=2028-05-01', analyst)).statusCode).toBe(
      400,
    );
    expect((await get('/admin/analytics/growth?from=2028-02-30&to=2028-03-02', analyst)).statusCode).toBe(
      400,
    );
    // Left out, the range is the last 30 days to today.
    const plain = await board<EngagementBoard>('engagement', '');
    expect(plain).toMatchObject({ from: '2028-04-02', to: '2028-05-01', platform: 'all' });
    expect(plain.days).toHaveLength(30);
  });

  it('counts players, sessions, time in the app, screens, busy hours and Dailies finished', async () => {
    const a = { pid: `p_${randomUUID()}`, platform: 'android' };
    const b = { pid: `p_${randomUUID()}`, platform: 'web' };
    const guest = { anon: `a_${randomUUID()}`, platform: 'web' };
    // Monday 1 May: three players.
    await event('session_started', wat(1, 9), { ...a, session: 'sa1' }, { source: 'launch' });
    await event(
      'screen_viewed',
      wat(1, 9, 1),
      { ...a, session: 'sa1' },
      { screen: 'home', prev_screen: 'duel', prev_screen_ms: 30_000 },
    );
    await event(
      'app_backgrounded',
      wat(1, 9, 2),
      { ...a, session: 'sa1' },
      { foreground_ms: 2 * MINUTE, screen: 'home', screen_ms: MINUTE },
    );
    await event('daily_started', wat(1, 9, 1), { ...a, source: 'server' }, { daily_id: 1 });
    await event(
      'daily_completed',
      wat(1, 9, 2),
      { ...a, source: 'server' },
      { daily_id: 1, score: 900, streak: 1 },
    );
    await event('session_started', wat(1, 20), { ...b, session: 'sb1' }, { source: 'launch' });
    await event('app_backgrounded', wat(1, 20, 15), { ...b, session: 'sb1' }, { foreground_ms: 15 * MINUTE });
    // A session whose last report was lost counts its span: 30 seconds.
    await event('session_started', wat(1, 9), { ...guest, session: 'sc1' }, { source: 'launch' });
    await event('app_foregrounded', wat(1, 9) + 30_000, { ...guest, session: 'sc1' });
    // Tuesday 2 May: one of them, for 40 minutes, starting a Daily they don't finish.
    await event('session_started', wat(2, 9), { ...a, session: 'sa2' }, { source: 'resume' });
    await event('app_backgrounded', wat(2, 9, 40), { ...a, session: 'sa2' }, { foreground_ms: 40 * MINUTE });
    await event('daily_started', wat(2, 9, 1), { ...a, source: 'server' }, { daily_id: 2 });
    t.clock.t = wat(3, 10);

    const e = await board<EngagementBoard>('engagement', '?from=2028-05-01&to=2028-05-02');
    expect(e.days).toEqual([
      { day: '2028-05-01', dau: 3, sessions: 3, minutes: 17, daily_started: 1, daily_completed: 1 },
      { day: '2028-05-02', dau: 1, sessions: 1, minutes: 40, daily_started: 1, daily_completed: 0 },
    ]);
    expect(e.summary).toEqual({
      dau: 2,
      wau: 3,
      mau: 3,
      stickiness: 2 / 3,
      sessions_per_dau: 1,
      minutes_per_dau: 57 / 4,
      daily_completion: 0.5,
    });
    expect(e.session_lengths.map((s) => s.sessions)).toEqual([1, 1, 0, 1, 1]);
    expect(e.screens).toEqual([
      { screen: 'home', minutes: 1 },
      { screen: 'duel', minutes: 0.5 },
    ]);
    expect(e.hours).toEqual(
      expect.arrayContaining([
        { weekday: 0, hour: 9, players: 2 },
        { weekday: 0, hour: 20, players: 1 },
        { weekday: 1, hour: 9, players: 1 },
      ]),
    );
    expect(e.hours).toHaveLength(3);

    const android = await board<EngagementBoard>(
      'engagement',
      '?from=2028-05-01&to=2028-05-02&platform=android',
    );
    expect(android.days.map((d) => [d.dau, d.sessions, d.minutes])).toEqual([
      [1, 1, 2],
      [1, 1, 40],
    ]);
  });

  it('counts new players, sign-ups, invites, the K-factor and web players who moved on', async () => {
    t.clock.t = wat(8, 10);
    const g1 = await signInGuest(t.app, 'android');
    await signInGuest(t.app, 'android');
    const w1 = await signInGuest(t.app, 'web');
    await t.pool.query(
      "INSERT INTO auth_identities (id, user_id, provider, subject, created_at) VALUES ($1, $2, 'email', $3, $4)",
      [newId('ai'), g1.user.id, `g1-${randomUUID()}@example.com`, new Date(wat(8, 11))],
    );
    const sharer = { pid: pid(g1.user.id), platform: 'android' };
    await event('invite_shared', wat(8, 12), sharer, { channel: 'whatsapp', context: 'duel' });
    await event('invite_shared', wat(8, 12, 5), sharer, { channel: 'whatsapp', context: 'party' });
    await event('invite_shared', wat(8, 12, 9), sharer, { channel: 'copy', context: 'duel' });
    await event(
      'invite_opened',
      wat(8, 13),
      { platform: 'android', source: 'server' },
      { type: 'duel', has_app: true, opened_in: 'app' },
    );
    await event(
      'invite_opened',
      wat(8, 13),
      { platform: 'web', source: 'server' },
      { type: 'party', has_app: false, opened_in: 'web' },
    );

    t.clock.t = wat(9, 10);
    await signInGuest(t.app, 'web');
    await t.pool.query(
      "INSERT INTO auth_identities (id, user_id, provider, subject, created_at) VALUES ($1, $2, 'google', $3, $4)",
      [newId('ai'), w1.user.id, `sub-${randomUUID()}`, new Date(wat(9, 11))],
    );
    // The web player later plays in the Android app, signed in.
    await event(
      'session_started',
      wat(9, 12),
      { pid: pid(w1.user.id), platform: 'android', session: 'w1' },
      { source: 'launch' },
    );
    t.clock.t = wat(10, 8);

    const g = await board<GrowthBoard>('growth', '?from=2028-05-08&to=2028-05-09');
    expect(g.days).toEqual([
      { day: '2028-05-08', new_players: 3, android: 2, ios: 0, web: 1, signups: 1 },
      { day: '2028-05-09', new_players: 1, android: 0, ios: 0, web: 1, signups: 1 },
    ]);
    expect(g.summary).toEqual({
      new_players: 4,
      signups: 2,
      invites_shared: 3,
      invites_opened: 2,
      k_factor: (3 / 4) * (2 / 3),
      web_new_players: 2,
      web_to_account: 1,
      web_to_app: 1,
    });
    expect(g.sources).toEqual([{ source: 'organic', players: 4 }]);
    expect(g.signup_methods).toEqual(
      expect.arrayContaining([
        { method: 'email', signups: 1 },
        { method: 'google', signups: 1 },
      ]),
    );
    expect(g.invite_channels).toEqual([
      { channel: 'whatsapp', shared: 2 },
      { channel: 'copy', shared: 1 },
    ]);
    expect(g.invites_opened_by).toEqual(
      expect.arrayContaining([
        { type: 'duel', in_app: 1, on_web: 0 },
        { type: 'party', in_app: 0, on_web: 1 },
      ]),
    );

    const web = await board<GrowthBoard>('growth', '?from=2028-05-08&to=2028-05-09&platform=web');
    expect(web.summary).toMatchObject({ new_players: 2, signups: 1, web_new_players: 2 });
    const android = await board<GrowthBoard>('growth', '?from=2028-05-08&to=2028-05-09&platform=android');
    expect(android.summary).toMatchObject({ new_players: 2, signups: 1, web_new_players: 0 });
  });

  it('follows new players by the week they started: day 1, 7 and 30, once each day has passed', async () => {
    t.clock.t = wat(15, 10); // Monday 15 May
    const back = await signInGuest(t.app, 'android');
    const gone = await signInGuest(t.app, 'android');
    for (const day of [15, 16, 22]) {
      await event(
        'session_started',
        wat(day, 18),
        { pid: pid(back.user.id), platform: 'android', session: `r${day}` },
        { source: 'launch' },
      );
    }
    await event(
      'session_started',
      wat(15, 18),
      { pid: pid(gone.user.id), platform: 'android', session: 'g15' },
      { source: 'launch' },
    );

    // Wednesday: day 1 has passed for both, day 7 not yet.
    t.clock.t = wat(17, 10);
    const early = await board<RetentionBoard>('retention', '?from=2028-05-15&to=2028-05-15');
    expect(early.summary).toEqual({ d1: 0.5, d7: null, d30: null });
    expect(early.cohorts).toEqual([{ week: '2028-05-15', players: 2, d1: 0.5, d7: null, d30: null }]);

    t.clock.t = Date.UTC(2028, 5, 20, 9); // 20 June
    const later = await board<RetentionBoard>('retention', '?from=2028-05-15&to=2028-05-15');
    expect(later.summary).toEqual({ d1: 0.5, d7: 0.5, d30: 0 });
    expect(later.cohorts).toEqual([{ week: '2028-05-15', players: 2, d1: 0.5, d7: 0.5, d30: 0 }]);
    expect(later.curve.slice(0, 3)).toEqual([
      { day: 0, share: 1 },
      { day: 1, share: 0.5 },
      { day: 2, share: 0 },
    ]);
    expect(later.curve).toHaveLength(31);
    // iPhone players: nobody new.
    const ios = await board<RetentionBoard>('retention', '?from=2028-05-15&to=2028-05-15&platform=ios');
    expect(ios).toMatchObject({ summary: { d1: null, d7: null, d30: null }, cohorts: [] });
  });
});
