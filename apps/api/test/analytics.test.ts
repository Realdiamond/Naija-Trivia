/**
 * The console's analytics dashboards (build plan step 2.7j): Engagement & time, Growth & invites
 * and Retention over a range of WAT days and a platform, each number as doc 18 §10 defines it.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  AdminRole,
  EconomyBoard,
  EngagementBoard,
  GameplayBoard,
  GrowthBoard,
  MonetisationBoard,
  RetentionBoard,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { withTransaction } from '../src/db';
import { grantCoins, spendCoins } from '../src/economy/ledger';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const MINUTE = 60_000;
/** An instant in May 2028 (a month no other test file plays in), at a WAT time of day. */
const wat = (day: number, hour: number, minute = 0) => Date.UTC(2028, 4, day, hour - 1, minute);
/** The same in July 2028, for the matches, money and coins. */
const july = (day: number, hour: number) => Date.UTC(2028, 6, day, hour - 1);
const DAILY_ID = 9_000_701;

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
const made = { duels: [] as string[], parties: [] as string[], players: [] as string[] };
afterAll(async () => {
  await t.pool.query("DELETE FROM analytics_events WHERE ts >= '2028-04-30' AND ts < '2028-08-01'");
  await t.pool.query('DELETE FROM duels WHERE id = ANY($1)', [made.duels]);
  await t.pool.query('DELETE FROM party_games WHERE id = ANY($1)', [made.parties]);
  await t.pool.query('DELETE FROM daily_results WHERE daily_id = $1', [DAILY_ID]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = $1', [DAILY_ID]);
  await t.pool.query('DELETE FROM purchases WHERE user_id = ANY($1)', [made.players]);
  const txs = (
    await t.pool.query<{ transaction_id: string }>(
      `SELECT DISTINCT e.transaction_id FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.owner_user_id = ANY($1)`,
      [made.players],
    )
  ).rows.map((r) => r.transaction_id);
  await t.pool.query('DELETE FROM ledger_entries WHERE transaction_id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_transactions WHERE id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_accounts WHERE owner_user_id = ANY($1)', [made.players]);
  await t.close();
});

async function julyPlayer(platform: 'android' | 'ios' | 'web' = 'android'): Promise<string> {
  const id = (await signInGuest(t.app, platform)).user.id;
  made.players.push(id);
  return id;
}

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
  it('shows matches, Daily scores, categories and lifelines (Gameplay)', async () => {
    t.clock.t = july(1, 9);
    const [a, b] = [await julyPlayer(), await julyPlayer()];
    const duel = async (state: string, source: string, started: number, finished: number | null) => {
      const id = newId('d');
      made.duels.push(id);
      await t.pool.query(
        `INSERT INTO duels (id, player_a, player_b, source, state, created_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, a, b, source, state, new Date(started), finished === null ? null : new Date(finished)],
      );
    };
    await duel('complete', 'friend', july(3, 10), july(3, 12)); // 2 hours
    await duel('complete', 'random', july(3, 9), july(4, 9)); // 24 hours
    await duel('forfeit', 'friend', july(4, 8), july(4, 10)); // 2 hours
    await duel('declined', 'link', july(4, 11), null);
    await duel('wait_b_r1r2', 'bot', july(4, 12), null);

    const party = async (results: Array<string | null>) => {
      const id = newId('pg');
      made.parties.push(id);
      await t.pool.query(
        `INSERT INTO party_games (id, room_code, host_user_id, settings, player_count, started_at, ended_at, questions)
         VALUES ($1, 'ABCDE', $2, '{}', $3, $4, $5, 10)`,
        [id, a, results.length, new Date(july(3, 20)), new Date(july(3, 21))],
      );
      for (const [i, user] of results.entries()) {
        await t.pool.query(
          `INSERT INTO party_results (game_id, player_ref, user_id, rank, score, correct_count, name, kind)
           VALUES ($1, $2, $3, $4, 100, 3, 'Ada', $5)`,
          [id, user ?? `guest:Ada#${i}`, user, i + 1, user ? 'app' : 'web_guest'],
        );
      }
    };
    await party([a, b, null]);
    await party([null, null]);

    await t.pool.query(
      `INSERT INTO daily_challenges (id, play_date, question_ids, locked) VALUES ($1, '2028-07-03', $2, true)`,
      [DAILY_ID, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']],
    );
    for (const [user, correct] of [
      [a, 7],
      [b, 5],
    ] as const) {
      await t.pool.query(
        `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, completed_at)
         VALUES ($1, $2, $3, 900, 60000, 'GGGGGGG', $4)`,
        [DAILY_ID, user, correct, new Date(july(3, 8))],
      );
    }

    const onAndroid = { pid: pid(a), platform: 'android', source: 'server' as const };
    const onWeb = { pid: pid(b), platform: 'web', source: 'server' as const };
    for (const correct of [true, false, true]) {
      await event('question_answered', july(3, 10), onAndroid, { category: 'music', correct });
    }
    await event('question_answered', july(4, 10), onWeb, { category: 'sports', correct: false });
    await event('lifeline_used', july(3, 10), onAndroid, { type: 'fifty', paid_with: 'coins', mode: 'duel' });
    await event('lifeline_used', july(4, 10), onWeb, { type: 'skip', paid_with: 'ad', mode: 'duel' });
    t.clock.t = july(5, 9);

    const g = await board<GameplayBoard>('gameplay', '?from=2028-07-03&to=2028-07-04');
    expect(g.summary).toEqual({
      duels_finished: 3,
      forfeit_rate: 1 / 3,
      duel_hours_median: 2,
      party_games: 2,
      party_players_avg: 2.5,
      web_guest_share: 3 / 5,
      dailies_finished: 2,
      correct_rate: 0.5,
    });
    expect(g.days).toEqual([
      { day: '2028-07-03', duels: 1, party_games: 2, dailies: 2 },
      { day: '2028-07-04', duels: 2, party_games: 0, dailies: 0 },
    ]);
    expect(g.duel_outcomes).toEqual(
      expect.arrayContaining([
        { outcome: 'Finished', duels: 2 },
        { outcome: 'Forfeited', duels: 1 },
        { outcome: 'Declined', duels: 1 },
        { outcome: 'Still going', duels: 1 },
      ]),
    );
    expect(g.duel_outcomes[0]).toEqual({ outcome: 'Finished', duels: 2 });
    expect(g.duel_sources[0]).toEqual({ source: 'friend', duels: 2 });
    expect(g.party_sizes.slice(0, 2)).toEqual([
      { size: '2', games: 1 },
      { size: '3–4', games: 1 },
    ]);
    expect(g.daily_scores[7]).toEqual({ correct: 7, players: 1 });
    expect(g.daily_scores[5]).toEqual({ correct: 5, players: 1 });
    expect(g.categories).toEqual([
      { category: 'music', answers: 3, correct_rate: 2 / 3 },
      { category: 'sports', answers: 1, correct_rate: 0 },
    ]);
    expect(g.lifelines).toEqual(
      expect.arrayContaining([
        { type: 'fifty', with_coins: 1, with_ads: 0 },
        { type: 'skip', with_coins: 0, with_ads: 1 },
      ]),
    );

    // On Android only: the answers and lifelines from there; matches still count everywhere.
    const android = await board<GameplayBoard>('gameplay', '?from=2028-07-03&to=2028-07-04&platform=android');
    expect(android.categories).toEqual([{ category: 'music', answers: 3, correct_rate: 2 / 3 }]);
    expect(android.lifelines).toEqual([{ type: 'fifty', with_coins: 1, with_ads: 0 }]);
    expect(android.summary.duels_finished).toBe(3);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/admin/analytics/gameplay',
          headers: bearer(await staff(['finance'])),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('shows store money, payers, ARPDAU and ads (Monetisation)', async () => {
    t.clock.t = july(9, 9);
    const [a, b] = [await julyPlayer('android'), await julyPlayer('ios')];
    const purchase = async (
      user: string,
      fields: {
        store: string;
        product: string;
        naira: number;
        at: number;
        status?: string;
        environment?: string;
        refunded?: number;
      },
    ) =>
      t.pool.query(
        `INSERT INTO purchases (id, user_id, store, product_id, store_tx_id, price_micros, currency, status, coins,
                                environment, created_at, refunded_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'NGN', $7, 1000, $8, $9, $10)`,
        [
          newId('pu'),
          user,
          fields.store,
          fields.product,
          `GPA.${randomUUID()}`,
          fields.naira * 1_000_000,
          fields.status ?? 'completed',
          fields.environment ?? 'production',
          new Date(fields.at),
          fields.refunded ? new Date(fields.refunded) : null,
        ],
      );
    await purchase(a, { store: 'play', product: 'coins_medium', naira: 800, at: july(10, 10) });
    await purchase(b, { store: 'app_store', product: 'coins_large', naira: 1500, at: july(11, 10) });
    await purchase(a, {
      store: 'play',
      product: 'coins_small',
      naira: 300,
      at: july(10, 11),
      status: 'refunded',
      refunded: july(11, 9),
    });
    await purchase(a, {
      store: 'play',
      product: 'coins_small',
      naira: 300,
      at: july(10, 12),
      environment: 'sandbox',
    });

    const onA = { pid: pid(a), platform: 'android' };
    await event('session_started', july(10, 9), { ...onA, session: 'ma1' }, { source: 'launch' });
    await event('session_started', july(11, 9), { ...onA, session: 'ma2' }, { source: 'launch' });
    await event(
      'session_started',
      july(10, 9),
      { pid: pid(b), platform: 'ios', session: 'mb1' },
      { source: 'launch' },
    );
    await event(
      'session_started',
      july(10, 9),
      { anon: `a_${randomUUID()}`, platform: 'web', session: 'mc1' },
      { source: 'launch' },
    );
    // An event with nobody on it (an invite opened before sign-in) is no player-day.
    await event(
      'invite_opened',
      july(10, 13),
      { platform: 'android', source: 'server' },
      { type: 'duel', has_app: false, opened_in: 'web' },
    );
    for (let i = 0; i < 4; i++)
      await event('ad_requested', july(10, 10), onA, { format: 'rewarded', placement: 'lifeline' });
    await event('ad_shown', july(10, 10), onA, { format: 'rewarded', placement: 'lifeline' });
    await event('ad_shown', july(10, 10), onA, { format: 'rewarded', placement: 'lifeline' });
    await event('ad_shown', july(11, 10), onA, { format: 'interstitial', placement: 'results' });
    await event('ad_paid', july(10, 10), onA, {
      value_micros: 1_500_000,
      currency: 'USD',
      precision: 'estimated',
      format: 'rewarded',
    });
    await event('ad_paid', july(11, 10), onA, {
      value_micros: 500_000,
      currency: 'USD',
      precision: 'estimated',
      format: 'interstitial',
    });
    await event(
      'ad_reward_granted',
      july(10, 10),
      { ...onA, source: 'server' },
      { format: 'rewarded', amount: 20 },
    );
    await event(
      'ad_reward_granted',
      july(11, 10),
      { ...onA, source: 'server' },
      { format: 'rewarded', amount: 20 },
    );
    t.clock.t = july(12, 9);

    const m = await board<MonetisationBoard>(
      'monetisation',
      '?from=2028-07-10&to=2028-07-11',
      await staff(['finance']),
    );
    expect(m.summary).toEqual({
      store_revenue_ngn: 2300,
      purchases: 3,
      refunds: 1,
      payers: 2,
      payer_conversion: 2 / 3,
      arppu_ngn: 1150,
      arpdau_ngn: 2300 / 4,
      ad_revenue: { USD: 2 },
      ads_shown: 3,
      fill_rate: 0.75,
      rewarded_views: 2,
      rewarded_per_dau: 0.5,
    });
    expect(m.days).toEqual([
      { day: '2028-07-10', store_ngn: 800, purchases: 2, rewarded_views: 1, ads_shown: 2 },
      { day: '2028-07-11', store_ngn: 1500, purchases: 1, rewarded_views: 1, ads_shown: 1 },
    ]);
    expect(m.by_product).toEqual(
      expect.arrayContaining([
        { product_id: 'coins_medium', purchases: 1, revenue_ngn: 800 },
        { product_id: 'coins_large', purchases: 1, revenue_ngn: 1500 },
      ]),
    );
    expect(m.by_product).toHaveLength(2);
    expect(m.ad_placements[0]).toEqual({ format: 'rewarded', placement: 'lifeline', shown: 2 });

    // Google Play only: its purchases and Android's players and ads.
    const android = await board<MonetisationBoard>(
      'monetisation',
      '?from=2028-07-10&to=2028-07-11&platform=android',
    );
    expect(android.summary).toMatchObject({
      store_revenue_ngn: 800,
      purchases: 2,
      refunds: 1,
      payers: 1,
      payer_conversion: 1,
    });
  });

  it('shows coins earned and spent, by reason, and balances (Economy)', async () => {
    t.clock.t = july(16, 9);
    const [a, b] = [await julyPlayer(), await julyPlayer()];
    const move = (at: number, work: Parameters<typeof withTransaction>[1]) => {
      t.clock.t = at;
      return withTransaction(t.pool, work);
    };
    await move(july(17, 10), (c) =>
      grantCoins(c, a, 100, { key: `an-${randomUUID()}`, reason: 'daily', now: july(17, 10) }),
    );
    await move(july(17, 11), (c) =>
      grantCoins(c, b, 30, { key: `an-${randomUUID()}`, reason: 'duel_win', now: july(17, 11) }),
    );
    await move(july(18, 10), (c) =>
      spendCoins(c, a, 40, { key: `an-${randomUUID()}`, reason: 'lifeline', now: july(18, 10) }),
    );
    t.clock.t = july(19, 9);

    const e = await board<EconomyBoard>('economy', '?from=2028-07-17&to=2028-07-18&platform=web');
    expect(e.platform).toBe('all');
    expect(e.summary).toMatchObject({ earned: 130, spent: 40, inflation: 130 / 40 });
    expect(e.summary.holders).toBeGreaterThanOrEqual(2);
    expect(e.days).toEqual([
      { day: '2028-07-17', earned: 130, spent: 0 },
      { day: '2028-07-18', earned: 0, spent: 40 },
    ]);
    expect(e.sources).toEqual([
      { reason: 'daily', coins: 100 },
      { reason: 'duel_win', coins: 30 },
    ]);
    expect(e.sinks).toEqual([{ reason: 'lifeline', coins: 40 }]);
    expect(e.balances.map((x) => x.bucket)).toEqual([
      '1–99',
      '100–499',
      '500–1,999',
      '2,000–9,999',
      '10,000 or more',
    ]);
    expect(e.balances[0]!.players).toBeGreaterThanOrEqual(2); // 60 and 30 coins
  });
});
