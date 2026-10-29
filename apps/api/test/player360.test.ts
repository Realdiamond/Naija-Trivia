import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  AdminDevicesResponse,
  AdminMatchesResponse,
  AdminMoneyResponse,
  AdminNotesResponse,
  AdminRole,
  AdminSessionsResponse,
  AdminUserSummary,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// A quiet day no other test file plays on: 10 August 2027, 14:00 WAT.
const NOW = Date.UTC(2027, 7, 10, 13, 0, 0);
const TODAY = Date.UTC(2027, 7, 9, 23, 0, 0); // midnight WAT
const DAILY_IDS = [97001, 97002, 97003, 97004, 97005, 97006];

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = NOW;
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(async () => {
  // Other files count whatever is after their own clock (2026, or June 2027 for the Overview):
  // leave nothing dated here behind.
  const from = new Date(Date.UTC(2027, 6, 1));
  await t.pool.query('DELETE FROM analytics_events WHERE ts >= $1', [from]);
  await t.pool.query('DELETE FROM daily_results WHERE daily_id = ANY($1)', [DAILY_IDS]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = ANY($1)', [DAILY_IDS]);
  await t.pool.query('DELETE FROM duels WHERE created_at >= $1', [from]);
  await t.pool.query('DELETE FROM party_games WHERE started_at >= $1', [from]);
  await t.pool.query(
    'DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE created_at >= $1)',
    [from],
  );
  await t.pool.query('DELETE FROM ledger_transactions WHERE created_at >= $1', [from]);
  await t.pool.query(
    'DELETE FROM ledger_accounts WHERE owner_user_id IN (SELECT id FROM users WHERE created_at >= $1)',
    [from],
  );
  await t.pool.query('UPDATE users SET last_seen_at = NULL WHERE last_seen_at >= $1', [from]);
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `p360-${randomInt(1e9)}@whosabi.ng`,
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

async function event(
  userId: string,
  name: string,
  at: number,
  fields: { session: string; platform?: string; network?: string; version?: string; props?: object },
) {
  await t.pool.query(
    `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, session_id, platform, app_version,
                                   network_type, props)
     VALUES ($1, $2, 'client', $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      name,
      new Date(at),
      pseudonymousId(userId, t.config.analyticsKey),
      fields.session,
      fields.platform ?? 'android',
      fields.version ?? '',
      fields.network ?? '',
      JSON.stringify(fields.props ?? {}),
    ],
  );
}

/** A Daily the player finished on `day` (WAT midnight), with the streak it left them on. */
async function playedDaily(userId: string, dailyId: number, day: number, streak: number) {
  const date = new Date(day + HOUR).toISOString().slice(0, 10);
  await t.pool.query(
    `INSERT INTO daily_challenges (id, play_date, question_ids) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [dailyId, date, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']],
  );
  await t.pool.query(
    `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, streak, coins, completed_at)
     VALUES ($1, $2, 5, 900, 40000, 'GGGRGGR', $3, 20, $4)`,
    [dailyId, userId, streak, new Date(day + 10 * HOUR)],
  );
}

describe("User 360's other tabs (step 2.7b)", () => {
  it('adds up time in front per WAT day, split at midnight, with sessions, platforms, areas and hours', async () => {
    const support = await staff(['support']);
    const player = await signInGuest(t.app);
    const id = player.user.id;
    // Opened at 23:50 WAT yesterday, put away at 00:20 today: 10 minutes yesterday, 20 today.
    const late = TODAY - 10 * MINUTE;
    await event(id, 'session_started', late, { session: 's-late', version: '1.2.0', network: '4g' });
    await event(id, 'screen_viewed', late + 5 * MINUTE, {
      session: 's-late',
      props: { screen: 'duel.play', prev_screen: 'home', prev_screen_ms: 5 * MINUTE },
    });
    await event(id, 'app_backgrounded', TODAY + 20 * MINUTE, {
      session: 's-late',
      props: { foreground_ms: 30 * MINUTE, screen: 'duel.play', screen_ms: 25 * MINUTE },
    });
    // A short one on the web this afternoon.
    await event(id, 'session_started', TODAY + 13 * HOUR, { session: 's-web', platform: 'web' });
    await event(id, 'app_backgrounded', TODAY + 13 * HOUR + 6 * MINUTE, {
      session: 's-web',
      platform: 'web',
      props: { foreground_ms: 6 * MINUTE },
    });

    const res = await get(support, `/admin/users/${id}/sessions`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as AdminSessionsResponse;
    expect(body.sessions.map((s) => s.id)).toEqual(['s-web', 's-late']);
    expect(body.sessions[1]).toMatchObject({
      foreground_minutes: 30,
      platform: 'android',
      app_version: '1.2.0',
      network: '4g',
      events: 3,
    });
    expect(body.minutes_by_day).toHaveLength(90);
    expect(body.minutes_by_day.slice(-2)).toEqual([
      { day: '2027-08-09', minutes: 10 },
      { day: '2027-08-10', minutes: 26 },
    ]);
    expect(body.minutes_by_platform).toEqual([
      { platform: 'android', minutes: 30 },
      { platform: 'web', minutes: 6 },
    ]);
    expect(body.minutes_by_area).toEqual([
      { area: 'duel', minutes: 25 },
      { area: 'home', minutes: 5 },
    ]);
    expect(body.average_session_minutes).toBe(18);
    expect(body.by_hour[23]).toBe(2);
    expect(body.by_hour[0]).toBe(1);
    expect(body.by_hour[13]).toBe(2);

    const audit = await t.pool.query(
      "SELECT after FROM admin_audit_log WHERE action = 'view_user_tab' AND entity_id = $1",
      [id],
    );
    expect(audit.rows.map((r) => r.after)).toEqual([{ tab: 'sessions' }]);
  });

  it('lists matches, money and devices, and tells staff without players.view no', async () => {
    const support = await staff(['support']);
    const viewer = await staff(['viewer']);
    const player = await signInGuest(t.app);
    const id = player.user.id;
    for (const tab of ['sessions', 'matches', 'money', 'devices', 'notes']) {
      expect((await get(viewer, `/admin/users/${id}/${tab}`)).statusCode).toBe(403);
    }
    expect((await get(support, `/admin/users/u_${'0'.repeat(26)}/matches`)).statusCode).toBe(404);

    await t.pool.query(
      `INSERT INTO duels (id, player_a, player_b, source, state, score_a, score_b, winner_id, coins_a, created_at,
                         completed_at)
       VALUES ($1, $2, 'u_sabi_bot', 'bot', 'complete', 1200, 800, $2, 30, $3, $3)`,
      [newId('d'), id, new Date(NOW - HOUR)],
    );
    await playedDaily(id, DAILY_IDS[0]!, TODAY - 2 * DAY, 1);
    const game = newId('pg');
    await t.pool.query(
      `INSERT INTO party_games (id, room_code, settings, player_count, questions, started_at, ended_at)
       VALUES ($1, 'QWERT', '{}', 4, 10, $2, $2)`,
      [game, new Date(NOW - 2 * HOUR)],
    );
    await t.pool.query(
      `INSERT INTO party_results (game_id, player_ref, user_id, rank, score, correct_count, name, kind)
       VALUES ($1, $2, $2, 2, 3100, 6, 'Ada', 'app')`,
      [game, id],
    );
    const matches = (await get(support, `/admin/users/${id}/matches`)).json() as AdminMatchesResponse;
    expect(matches.duels).toMatchObject([
      { opponent: 'Sabi Bot', source: 'bot', result: 'win', score: { you: 1200, opponent: 800 }, coins: 30 },
    ]);
    expect(matches.dailies).toMatchObject([
      { id: DAILY_IDS[0], date: '2027-08-08', grid: 'GGGRGGR', streak: 1 },
    ]);
    expect(matches.party_games).toMatchObject([{ room_code: 'QWERT', rank: 2, score: 3100, players: 4 }]);

    await t.pool.query(
      `INSERT INTO purchases (id, user_id, store, product_id, store_tx_id, price_micros, currency, status, coins)
       VALUES ($1, $2, 'play', 'coins_small', $3, 300000000, 'NGN', 'completed', 500)`,
      [newId('pu'), id, `GPA.${randomUUID()}`],
    );
    await t.pool.query(
      `INSERT INTO ad_rewards (reward_ref, user_id, ad_unit, reward_item, reward_amount)
       VALUES ($1, $2, 'unit-1', 'coins', 25)`,
      [randomUUID(), id],
    );
    const money = (await get(support, `/admin/users/${id}/money`)).json() as AdminMoneyResponse;
    expect(money.purchases).toMatchObject([
      { product_id: 'coins_small', price: '₦300', status: 'completed' },
    ]);
    expect(money.ad_rewards).toMatchObject([{ ad_unit: 'unit-1', amount: 25, source: 'admob_ssv' }]);
    const summary = (await get(support, `/admin/users/${id}`)).json() as AdminUserSummary;
    expect(summary.lifetime_spend_ngn).toBe(300);

    await t.pool.query(
      `INSERT INTO devices (id, user_id, platform, push_token, app_version, model, last_seen_at)
       VALUES ($1, $2, 'android', $3, '1.2.0', 'Tecno Spark 10', $4)`,
      [newId('dev'), id, `tok-${randomUUID()}`, new Date(NOW)],
    );
    const devices = (await get(support, `/admin/users/${id}/devices`)).json() as AdminDevicesResponse;
    expect(devices.devices).toMatchObject([{ platform: 'android', model: 'Tecno Spark 10', push: true }]);
  });

  it('keeps staff notes, newest first, never for the player', async () => {
    const moderator = await staff(['moderator']);
    const support = await staff(['support']);
    const player = await signInGuest(t.app);
    const url = `/admin/users/${player.user.id}/notes`;
    expect((await post(moderator, url, { body: '  ' })).statusCode).toBe(400);
    await post(moderator, url, { body: 'Says a duel froze on question 3.' });
    t.clock.t += MINUTE;
    const after = (
      await post(support, url, { body: 'Gave 100 coins for the frozen duel.' })
    ).json() as AdminNotesResponse;
    t.clock.t = NOW;
    expect(after.notes.map((n) => [n.author, n.body])).toEqual([
      ['support', 'Gave 100 coins for the frozen duel.'],
      ['moderator', 'Says a duel froze on question 3.'],
    ]);
    const summary = (await get(support, `/admin/users/${player.user.id}`)).json() as AdminUserSummary;
    expect(summary.notes).toBe(2);
  });
});

describe("support's actions (step 2.7b)", () => {
  it('grants coins through the ledger within the daily limits, with a reason, and logs it', async () => {
    const support = await staff(['support']);
    const admin = await staff(['admin']);
    const moderator = await staff(['moderator']);
    const player = await signInGuest(t.app);
    const url = `/admin/users/${player.user.id}/actions`;
    const grant = (token: string, amount: number) =>
      post(token, url, { type: 'grant_coins', amount, reason: 'Duel froze, ticket 1234' });

    expect((await grant(moderator, 100)).statusCode).toBe(403);
    expect((await post(support, url, { type: 'grant_coins', amount: 100 })).statusCode).toBe(400);
    const first = await grant(support, 300);
    expect(first.statusCode).toBe(200);
    expect(first.json().done).toContain('300');
    const over = await grant(support, 300);
    expect(over.statusCode).toBe(403);
    expect(over.json().detail).toContain('200 left today');
    expect((await grant(admin, 1000)).statusCode).toBe(200);
    expect((await grant(admin, 4000)).statusCode).toBe(403);

    const wallet = (await get(admin, `/admin/users/${player.user.id}/money`)).json() as AdminMoneyResponse;
    expect(wallet.coins).toBe(1300);
    expect(wallet.ledger.filter((e) => e.reason === 'admin_grant').map((e) => e.amount)).toEqual([1000, 300]);
    const mine = await t.app.inject({ method: 'GET', url: '/v1/wallet', headers: bearer(player.access) });
    expect(mine.json().coins).toBe(1300);
    const audit = await t.pool.query(
      "SELECT reason, before, after FROM admin_audit_log WHERE action = 'grant_coins' AND entity_id = $1 ORDER BY id",
      [player.user.id],
    );
    expect(audit.rows).toEqual([
      { reason: 'Duel froze, ticket 1234', before: { coins: 0 }, after: { coins: 300, amount: 300 } },
      { reason: 'Duel froze, ticket 1234', before: { coins: 300 }, after: { coins: 1300, amount: 1000 } },
    ]);

    // Tomorrow (WAT) the limit starts again.
    t.clock.t = TODAY + DAY + MINUTE;
    expect((await grant(support, 500)).statusCode).toBe(200);
    t.clock.t = NOW;
  });

  it('restores a broken streak once every 30 days, joining a run started since', async () => {
    const support = await staff(['support']);
    const restore = (userId: string) =>
      post(support, `/admin/users/${userId}/actions`, { type: 'restore_streak', reason: 'Network was down' });

    // Not played since it broke: 4 days in a row, last on the 6th.
    const idle = await signInGuest(t.app);
    await t.pool.query(
      `INSERT INTO streaks (user_id, current, best, last_play_date, freezes_left, freeze_week)
       VALUES ($1, 4, 4, '2027-08-06', 0, '2027-W31')`,
      [idle.user.id],
    );
    const before = (await get(support, `/admin/users/${idle.user.id}`)).json() as AdminUserSummary;
    expect(before.streak.current).toBe(0);
    const res = await restore(idle.user.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().done).toBe('Streak restored to 4.');
    const after = (await get(support, `/admin/users/${idle.user.id}`)).json() as AdminUserSummary;
    expect(after.streak).toEqual({ current: 4, best: 4, last_play_date: '2027-08-09' });
    const again = await restore(idle.user.id);
    expect(again.statusCode).toBe(403);
    expect(again.json().detail).toContain('once every 30 days');

    // Played three days, missed two, then started again yesterday and today.
    const back = await signInGuest(t.app);
    await playedDaily(back.user.id, DAILY_IDS[1]!, TODAY - 6 * DAY, 1);
    await playedDaily(back.user.id, DAILY_IDS[2]!, TODAY - 5 * DAY, 2);
    await playedDaily(back.user.id, DAILY_IDS[3]!, TODAY - 4 * DAY, 3);
    await playedDaily(back.user.id, DAILY_IDS[4]!, TODAY - DAY, 1);
    await playedDaily(back.user.id, DAILY_IDS[5]!, TODAY, 2);
    await t.pool.query(
      `INSERT INTO streaks (user_id, current, best, last_play_date, freezes_left, freeze_week)
       VALUES ($1, 2, 3, '2027-08-10', 1, '2027-W32')`,
      [back.user.id],
    );
    expect((await restore(back.user.id)).json().done).toBe('Streak restored to 5.');
    const joined = (await get(support, `/admin/users/${back.user.id}`)).json() as AdminUserSummary;
    expect(joined.streak).toEqual({ current: 5, best: 5, last_play_date: '2027-08-10' });

    // Nothing broke.
    const fresh = await signInGuest(t.app);
    expect((await restore(fresh.user.id)).statusCode).toBe(409);
  });

  it('signs the player out everywhere', async () => {
    const support = await staff(['support']);
    const phone = await signInGuest(t.app);
    const res = await post(support, `/admin/users/${phone.user.id}/actions`, {
      type: 'sign_out',
      reason: 'Lost phone, asked by the player',
    });
    expect(res.json().done).toContain('Signed out of 1 session');
    const refresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh: phone.refresh },
    });
    expect(refresh.statusCode).toBe(401);
    const audit = await t.pool.query(
      "SELECT reason, after FROM admin_audit_log WHERE action = 'sign_out_everywhere' AND entity_id = $1",
      [phone.user.id],
    );
    expect(audit.rows).toEqual([{ reason: 'Lost phone, asked by the player', after: { sessions: 1 } }]);
  });
});
