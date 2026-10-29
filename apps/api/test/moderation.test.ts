import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminIntegrityFlag,
  AdminIntegrityResponse,
  AdminRole,
  AdminSafetyResponse,
  AdminUserSummary,
  LeaderboardResponse,
  Me,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const DAY = 86_400_000;
// A week no other test file plays in: Monday 20 September 2027, 10:00 WAT.
const NOW = Date.UTC(2027, 8, 20, 9, 0, 0);
const DAILY_ID = 98001;

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
  await t.pool.query('DELETE FROM daily_results WHERE daily_id = $1', [DAILY_ID]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = $1', [DAILY_ID]);
  await t.pool.query("UPDATE users SET last_seen_at = NULL WHERE last_seen_at >= '2027-09-01'");
  await t.close();
});

async function staff(roles: AdminRole[], name = roles.join('+')): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `mod-${randomInt(1e9)}@whosabi.ng`,
    name,
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
const act = (token: string, userId: string, action: object) =>
  post(token, `/admin/users/${userId}/actions`, action);
const me = async (access: string) =>
  (await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(access) })).json() as Me;

/** A guest made into an account with a username, straight in the database. */
async function account(username: string) {
  const guest = await signInGuest(t.app);
  await t.pool.query(
    "UPDATE users SET status = 'active', username = $2, age_band = '18_plus' WHERE id = $1",
    [guest.user.id, username],
  );
  await t.pool.query(
    "INSERT INTO auth_identities (id, user_id, provider, subject) VALUES ($1, $2, 'phone', $3)",
    [newId('ai'), guest.user.id, `+23480${randomInt(10_000_000, 99_999_999)}`],
  );
  return guest;
}

describe('moderation (step 2.7d)', () => {
  it('warns a player, who reads it once in the app', async () => {
    const moderator = await staff(['moderator'], 'Ngozi Mod');
    const support = await staff(['support']);
    const p = await signInGuest(t.app);
    const warning = 'Please keep party nicknames clean. Next time the account is suspended.';

    expect(
      (await act(support, p.user.id, { type: 'warn', message: warning, reason: 'Report 12' })).statusCode,
    ).toBe(403);
    expect(
      (await act(moderator, p.user.id, { type: 'grant_coins', amount: 10, reason: 'Not mine' })).statusCode,
    ).toBe(403);
    const res = await act(moderator, p.user.id, { type: 'warn', message: warning, reason: 'Report 12' });
    expect(res.statusCode).toBe(200);

    const notices = (await me(p.access)).notices;
    expect(notices).toMatchObject([{ kind: 'warning', message: warning }]);
    const seen = await t.app.inject({
      method: 'POST',
      url: `/v1/me/notices/${notices[0]!.id}/seen`,
      headers: bearer(p.access),
    });
    expect(seen.statusCode).toBe(204);
    expect((await me(p.access)).notices).toEqual([]);

    const safety = (await get(support, `/admin/users/${p.user.id}/safety`)).json() as AdminSafetyResponse;
    expect(safety.moderation).toMatchObject([{ action: 'warn', actor: 'Ngozi Mod', message: warning }]);
    expect(safety.moderation[0]!.seen_at).not.toBeNull();
  });

  it('takes a username away; the player picks a new one', async () => {
    const moderator = await staff(['moderator']);
    const p = await account(`rude_${randomInt(1e6)}`);
    const old = (await me(p.access)).username!;
    const res = await act(moderator, p.user.id, { type: 'rename', reason: 'Offensive name' });
    expect(res.json().done).toContain(old);
    const after = await me(p.access);
    expect(after.username).toBeNull();
    expect(after.notices).toMatchObject([{ kind: 'renamed' }]);
    const fresh = `kind_${randomInt(1e6)}`;
    const patched = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: bearer(p.access),
      payload: { username: fresh },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(
      (await act(moderator, (await signInGuest(t.app)).user.id, { type: 'rename', reason: 'x1x' }))
        .statusCode,
    ).toBe(409);
    const safety = (await get(moderator, `/admin/users/${p.user.id}/safety`)).json() as AdminSafetyResponse;
    expect(safety.moderation[0]).toMatchObject({ action: 'rename', details: { old_username: old } });
  });

  it('hides a player from the boards other players see, but not from their own', async () => {
    const moderator = await staff(['moderator']);
    const ada = await signInGuest(t.app);
    const bola = await signInGuest(t.app);
    await t.pool.query(
      "INSERT INTO daily_challenges (id, play_date, question_ids) VALUES ($1, '2027-09-20', $2)",
      [DAILY_ID, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']],
    );
    for (const [p, score] of [
      [ada, 900],
      [bola, 1200],
    ] as const) {
      await t.pool.query(
        `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, completed_at)
         VALUES ($1, $2, 6, $3, 30000, 'GGGGGGR', $4)`,
        [DAILY_ID, p.user.id, score, new Date(NOW)],
      );
    }
    const board = async (p: { access: string }) =>
      (
        (
          await t.app.inject({
            method: 'GET',
            url: '/v1/leaderboards/week?scope=global',
            headers: bearer(p.access),
          })
        ).json() as LeaderboardResponse
      ).entries.map((e) => [e.score, e.you]);

    expect(await board(ada)).toEqual([
      [1200, false],
      [900, true],
    ]);
    await act(moderator, bola.user.id, {
      type: 'shadow_restrict',
      reason: 'Answers in 0.4 s on every hard question',
    });
    expect(await board(ada)).toEqual([[900, true]]);
    expect(await board(bola)).toEqual([
      [1200, true],
      [900, false],
    ]);
    expect(
      (await act(moderator, bola.user.id, { type: 'shadow_restrict', reason: 'Again' })).statusCode,
    ).toBe(409);
    const summary = (await get(moderator, `/admin/users/${bola.user.id}`)).json() as AdminUserSummary;
    expect(summary.hidden_from_boards).toBe(true);
    await act(moderator, bola.user.id, { type: 'unrestrict', reason: 'Appeal upheld' });
    expect((await board(ada)).length).toBe(2);
  });

  it('bans for up to 30 days (longer needs an admin), signs the player out, and the ban ends itself', async () => {
    const moderator = await staff(['moderator']);
    const admin = await staff(['admin']);
    const p = await account(`cheat_${randomInt(1e6)}`);

    const long = await act(moderator, p.user.id, { type: 'ban', days: 90, reason: 'Third strike' });
    expect([long.statusCode, long.json().title]).toEqual([403, 'Needs an admin']);
    expect(
      (await act(moderator, p.user.id, { type: 'ban', days: null, reason: 'For good' })).statusCode,
    ).toBe(403);
    const ban = await act(moderator, p.user.id, { type: 'ban', days: 7, reason: 'Collusion in duels' });
    expect(ban.json().done).toBe('Banned for 7 days, and signed out everywhere.');

    const refresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh: p.refresh },
    });
    expect(refresh.statusCode).toBe(401);
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { device_id: p.deviceId, platform: 'android' },
    });
    expect(again.statusCode).toBe(403);
    expect(again.json().detail).toMatch(/^This account is suspended until 27 Sept? 2027\. To appeal/);
    const summary = (await get(admin, `/admin/users/${p.user.id}`)).json() as AdminUserSummary;
    expect(summary).toMatchObject({ status: 'banned', banned_until: new Date(NOW + 7 * DAY).toISOString() });

    // A guest's ban says when it ends and how to appeal.
    const guest = await signInGuest(t.app);
    await act(admin, guest.user.id, { type: 'ban', days: 60, reason: 'Ad reward abuse' });
    const refused = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { device_id: guest.deviceId, platform: 'android' },
    });
    expect([refused.statusCode, refused.json().code]).toEqual([403, 'ACCOUNT_UNAVAILABLE']);
    expect(refused.json().detail).toBe(
      'This account is suspended until 19 Nov 2027. To appeal, write to help@whosabi.ng.',
    );

    // Sixty days on, the guest's ban has ended: they sign in again as the same guest.
    t.clock.t = NOW + 61 * DAY;
    const back = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/guest',
      payload: { device_id: guest.deviceId, platform: 'android' },
    });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().user.id).toBe(guest.user.id);
    t.clock.t = NOW;
    const safety = (await get(admin, `/admin/users/${guest.user.id}/safety`)).json() as AdminSafetyResponse;
    expect(safety.moderation.map((m) => [m.action, m.actor])).toEqual([
      ['unban', 'Automatic'],
      ['ban', 'admin'],
    ]);

    // An admin lifts the account's ban early.
    expect((await act(admin, p.user.id, { type: 'unban', reason: 'Appeal upheld' })).json().done).toBe(
      'Ban lifted. They can sign in again.',
    );
    expect(((await get(admin, `/admin/users/${p.user.id}`)).json() as AdminUserSummary).status).toBe(
      'active',
    );
    expect((await act(admin, p.user.id, { type: 'unban', reason: 'Again' })).statusCode).toBe(409);
    expect((await act(admin, 'u_sabi_bot', { type: 'ban', days: 1, reason: 'The bot' })).statusCode).toBe(
      409,
    );
  });
});

describe('the integrity queue (step 2.7d)', () => {
  it('lists open flags riskiest first; a moderator dismisses or acts on each, with a note', async () => {
    const moderator = await staff(['moderator'], 'Ife Mod');
    const support = await staff(['support']);
    const p = await signInGuest(t.app);
    const flag = async (kind: string, score: number) =>
      (
        await t.pool.query<{ id: string }>(
          `INSERT INTO integrity_flags (user_id, kind, score, evidence) VALUES ($1, $2, $3, $4) RETURNING id`,
          [p.user.id, kind, score, JSON.stringify({ z: score * 5, answers: 120 })],
        )
      ).rows[0]!.id;
    const low = Number(await flag('tab_hidden', 0.41));
    const high = Number(await flag('accuracy_outlier', 0.93));

    expect((await get(support, '/admin/integrity')).statusCode).toBe(403);
    const open = (await get(moderator, '/admin/integrity')).json() as AdminIntegrityResponse;
    const mine = open.flags.filter((f) => f.user_id === p.user.id);
    expect(mine.map((f) => [f.kind, f.score])).toEqual([
      ['accuracy_outlier', expect.closeTo(0.93, 5)],
      ['tab_hidden', expect.closeTo(0.41, 5)],
    ]);
    expect(mine[0]!.evidence).toEqual({ z: expect.closeTo(4.65, 5), answers: 120 });

    const dismissed = await post(moderator, `/admin/integrity/${low}`, {
      status: 'dismissed',
      note: 'Switching apps to answer a call',
    });
    expect(dismissed.json() as AdminIntegrityFlag).toMatchObject({
      status: 'dismissed',
      reviewed_by: 'Ife Mod',
    });
    expect(
      (await post(moderator, `/admin/integrity/${low}`, { status: 'actioned', note: 'Again' })).statusCode,
    ).toBe(404);
    await post(moderator, `/admin/integrity/${high}`, { status: 'actioned', note: 'Hidden from boards' });
    const actioned = (
      await get(moderator, '/admin/integrity?status=actioned')
    ).json() as AdminIntegrityResponse;
    expect(actioned.flags.find((f) => f.id === high)).toMatchObject({ review_note: 'Hidden from boards' });
    const safety = (await get(moderator, `/admin/users/${p.user.id}/safety`)).json() as AdminSafetyResponse;
    expect(safety.flags.map((f) => f.status).sort()).toEqual(['actioned', 'dismissed']);
  });
});
