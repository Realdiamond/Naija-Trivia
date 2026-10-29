import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { AdminDsarResponse, AdminRole } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { befriend, bearer, createTestApp, signInGuest, testUsername } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp();
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(() => t.close());

async function staff(roles: AdminRole[], name = roles.join('+')): Promise<{ token: string; id: string }> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `dsar-${randomInt(1e9)}@whosabi.ng`,
    name,
  ]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return { token: (await sessions.create(id)).token, id };
}

/** A guest made into an account with a username and a phone, straight in the database. */
async function account() {
  const guest = await signInGuest(t.app);
  const username = testUsername('dsar_');
  await t.pool.query(
    "UPDATE users SET status = 'active', username = $2, age_band = '18_plus', home_state = 'LA' WHERE id = $1",
    [guest.user.id, username],
  );
  await t.pool.query(
    "INSERT INTO auth_identities (id, user_id, provider, subject) VALUES ($1, $2, 'phone', $3)",
    [newId('ai'), guest.user.id, `+23480${randomInt(10_000_000, 99_999_999)}`],
  );
  return { ...guest, username };
}

const count = async (sql: string, params: unknown[]) =>
  Number((await t.pool.query<{ n: string }>(sql, params)).rows[0]!.n);

describe("a player's own data (step 2.8a)", () => {
  it('downloads a copy of their data as JSON', async () => {
    const p = await account();
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/consents',
      headers: bearer(p.access),
      payload: {
        source: 'settings',
        consents: [{ purpose: 'analytics', granted: true, policy_version: '2026-10' }],
      },
    });
    const res = await t.app.inject({ method: 'GET', url: '/v1/me/export', headers: bearer(p.access) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="whosabi-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const data = res.json();
    expect(data.profile).toMatchObject({ id: p.user.id, username: p.username, home_state: 'LA' });
    expect(data.sign_in_methods.map((m: { provider: string }) => m.provider).sort()).toEqual([
      'guest_device',
      'phone',
    ]);
    expect(data.consents).toMatchObject([{ purpose: 'analytics', granted: true }]);
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['duels', 'dailies', 'party_games', 'coins_and_gems', 'purchases', 'devices']),
    );
    expect(
      await count(
        "SELECT count(*) AS n FROM dsar_requests WHERE user_id = $1 AND kind = 'access' AND status = 'completed' AND handled_by = 'player'",
        [p.user.id],
      ),
    ).toBe(1);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me/export' })).statusCode).toBe(401);
  });

  it('deletes their account at once, keeping only what the law or the game needs', async () => {
    const p = await account();
    const friend = await signInGuest(t.app);
    await befriend(t.pool, p.user.id, friend.user.id);
    const admin = await staff(['support']);
    await t.pool.query('INSERT INTO user_notes (user_id, author_id, body) VALUES ($1, $2, $3)', [
      p.user.id,
      admin.id,
      'Asked about a missing streak',
    ]);
    await t.pool.query(
      `INSERT INTO devices (id, user_id, platform, push_token) VALUES ($1, $2, 'android', $3)`,
      [newId('dev'), p.user.id, `tok-${randomUUID()}`],
    );
    await t.pool.query(
      `INSERT INTO analytics_events (event_id, event, source, ts, user_pid) VALUES ($1, 'session_started', 'client', now(), $2)`,
      [randomUUID(), pseudonymousId(p.user.id, t.config.analyticsKey)],
    );
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/consents',
      headers: bearer(p.access),
      payload: {
        source: 'settings',
        consents: [{ purpose: 'analytics', granted: true, policy_version: '2026-10' }],
      },
    });

    const unconfirmed = await t.app.inject({
      method: 'POST',
      url: '/v1/me/delete',
      headers: bearer(p.access),
      payload: {},
    });
    expect(unconfirmed.statusCode).toBe(400);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/me/delete',
      headers: bearer(p.access),
      payload: { confirm: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().dsar_id).toMatch(/^ds_/);

    const user = (
      await t.pool.query('SELECT status, username, home_state, deleted_at FROM users WHERE id = $1', [
        p.user.id,
      ])
    ).rows[0];
    expect(user).toMatchObject({ status: 'deleted', username: null, home_state: null });
    expect(user.deleted_at).not.toBeNull();
    for (const [table, column] of [
      ['auth_identities', 'user_id'],
      ['devices', 'user_id'],
      ['user_notes', 'user_id'],
    ]) {
      expect(await count(`SELECT count(*) AS n FROM ${table} WHERE ${column} = $1`, [p.user.id])).toBe(0);
    }
    expect(
      await count('SELECT count(*) AS n FROM friendships WHERE user_a = $1 OR user_b = $1', [p.user.id]),
    ).toBe(0);
    expect(
      await count('SELECT count(*) AS n FROM analytics_events WHERE user_pid = $1', [
        pseudonymousId(p.user.id, t.config.analyticsKey),
      ]),
    ).toBe(0);
    // Consent records stay (accountability, doc 08 §4).
    expect(await count('SELECT count(*) AS n FROM consent_records WHERE user_id = $1', [p.user.id])).toBe(1);
    // Signed out everywhere, and the account can't be used again.
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh: p.refresh } }))
        .statusCode,
    ).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(p.access) })).statusCode).toBe(
      401,
    );
  });
});

describe('the data request queue in the console (step 2.8a)', () => {
  it('support logs a request, the DPO exports and erases with reasons, all audited', async () => {
    const support = await staff(['support'], 'Tunde Support');
    const dpo = await staff(['dpo'], 'Amaka DPO');
    const admin = await staff(['admin']);
    const p = await account();
    const post = (who: { token: string }, url: string, payload: object) =>
      t.app.inject({ method: 'POST', url, headers: bearer(who.token), payload });
    const get = (who: { token: string }, url: string) =>
      t.app.inject({ method: 'GET', url, headers: bearer(who.token) });

    expect((await post(support, `/admin/users/${p.user.id}/dsar`, { kind: 'erasure' })).statusCode).toBe(400);
    const started = await post(support, `/admin/users/${p.user.id}/dsar`, {
      kind: 'erasure',
      note: 'Email to help@ on 28 Oct',
    });
    expect(started.statusCode).toBe(200);
    expect((await get(support, '/admin/dsar')).statusCode).toBe(403);
    const open = (await get(dpo, '/admin/dsar')).json() as AdminDsarResponse;
    expect(open.requests.find((r) => r.user_id === p.user.id)).toMatchObject({
      kind: 'erasure',
      status: 'received',
      source: 'console',
      started_by: 'Tunde Support',
      username: p.username,
    });

    const exported = await post(dpo, `/admin/users/${p.user.id}/export`, { reason: 'Before erasing' });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().profile.id).toBe(p.user.id);

    expect(
      (await post(admin, `/admin/users/${p.user.id}/erase`, { reason: 'Admins may not' })).statusCode,
    ).toBe(403);
    expect(
      (await post(support, `/admin/users/${p.user.id}/erase`, { reason: 'Nor support' })).statusCode,
    ).toBe(403);
    const erased = await post(dpo, `/admin/users/${p.user.id}/erase`, { reason: 'Their email of 28 Oct' });
    expect(erased.json()).toMatchObject({ erased: true, dsar_id: started.json().dsar_id });
    expect((await post(dpo, `/admin/users/${p.user.id}/erase`, { reason: 'Again' })).json().erased).toBe(
      false,
    );

    const done = (await get(dpo, '/admin/dsar?status=done')).json() as AdminDsarResponse;
    expect(done.requests.find((r) => r.id === started.json().dsar_id)).toMatchObject({
      status: 'completed',
      handled_by: 'Amaka DPO',
      username: null,
    });
    const audit = await t.pool.query(
      'SELECT action, reason FROM admin_audit_log WHERE entity_id = $1 AND action = ANY($2) ORDER BY id',
      [p.user.id, ['start_dsar', 'export_user', 'erase_user']],
    );
    expect(audit.rows).toEqual([
      { action: 'start_dsar', reason: 'Email to help@ on 28 Oct' },
      { action: 'export_user', reason: 'Before erasing' },
      { action: 'erase_user', reason: 'Their email of 28 Oct' },
      { action: 'erase_user', reason: 'Again' },
    ]);
  });
});
