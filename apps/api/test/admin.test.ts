import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  AdminAuditResponse,
  AdminRole,
  AdminSessionResponse,
  AdminStaffMember,
  AdminTimelineResponse,
  AdminUserSearchResponse,
  AdminUserSummary,
  SignInResponse,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  // The per-IP code limit is shared with the other test files in this run.
  t = await createTestApp({ OTP_SENDS_PER_IP_PER_HOUR: '10000' });
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(() => t.close());

/** A staff member straight in the database, like the admin:add command. */
async function addStaff(roles: AdminRole[], email = `staff${randomInt(1e9)}@whosabi.ng`) {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [id, email, 'Staff']);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return { id, email };
}

async function devSignIn(email: string) {
  const res = await t.app.inject({ method: 'POST', url: '/admin/auth/dev', payload: { email } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AdminSessionResponse;
}

async function staffSession(roles: AdminRole[]) {
  const staff = await addStaff(roles);
  return { ...staff, token: (await devSignIn(staff.email)).token };
}

const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (token: string, url: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(token), payload });

function newPhone() {
  const rest = String(randomInt(0, 10_000_000)).padStart(7, '0');
  return { typed: `0803 ${rest.slice(0, 3)} ${rest.slice(3)}`, e164: `+234803${rest}` };
}

async function phoneSignIn(phone: ReturnType<typeof newPhone>, access?: string) {
  const sent = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/send',
    headers: access ? bearer(access) : {},
    payload: { phone: phone.typed, platform: 'android' },
  });
  expect(sent.statusCode, sent.body).toBe(200);
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    headers: access ? bearer(access) : {},
    payload: { request_id: sent.json().request_id, code: t.sms.codeFor(phone.e164) },
  });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json() as SignInResponse;
}

async function auditActions(actor: string) {
  const rows = await t.pool.query<{ action: string; entity_id: string | null; reason: string | null }>(
    'SELECT action, entity_id, reason FROM admin_audit_log WHERE actor = $1 ORDER BY id',
    [actor],
  );
  return rows.rows;
}

describe('staff sign-in (doc 18 §16)', () => {
  it('lets listed staff in with Google and keeps everyone else out', async () => {
    const staff = await addStaff(['support']);
    const token = await t.signAdminGoogle({ sub: 'g-staff', email: staff.email, email_verified: true });
    const res = await t.app.inject({
      method: 'POST',
      url: '/admin/auth/google',
      payload: { id_token: token },
    });
    expect(res.statusCode, res.body).toBe(200);
    const session = res.json() as AdminSessionResponse;
    expect(session.admin).toMatchObject({ id: staff.id, roles: ['support'] });
    expect(session.admin.permissions).toContain('players.search');
    expect(Date.parse(session.expires_at) - t.clock.now()).toBe(12 * 3600 * 1000);
    expect((await get(session.token, '/admin/me')).json()).toMatchObject({ email: staff.email });

    const stranger = await t.signAdminGoogle({
      sub: 'g-x',
      email: 'someone@gmail.com',
      email_verified: true,
    });
    const refused = await t.app.inject({
      method: 'POST',
      url: '/admin/auth/google',
      payload: { id_token: stranger },
    });
    expect(refused.statusCode).toBe(403);
    const unverified = await t.signAdminGoogle({ sub: 'g-y', email: staff.email, email_verified: false });
    expect(
      (await t.app.inject({ method: 'POST', url: '/admin/auth/google', payload: { id_token: unverified } }))
        .statusCode,
    ).toBe(401);
    // A players' Google token is for another client id.
    const player = await t.signGoogle({ sub: 'g-p', email: staff.email, email_verified: true });
    expect(
      (await t.app.inject({ method: 'POST', url: '/admin/auth/google', payload: { id_token: player } }))
        .statusCode,
    ).toBe(401);
  });

  it('needs a Workspace account on the domain when one is set', async () => {
    const app = await createTestApp({ ADMIN_GOOGLE_DOMAIN: 'whosabi.ng' });
    try {
      const staff = await addStaff(['support']);
      const personal = await app.signAdminGoogle({ sub: 'g1', email: staff.email, email_verified: true });
      const workspace = await app.signAdminGoogle({
        sub: 'g1',
        email: staff.email,
        email_verified: true,
        hd: 'whosabi.ng',
      });
      const signIn = (idToken: string) =>
        app.app.inject({ method: 'POST', url: '/admin/auth/google', payload: { id_token: idToken } });
      expect((await signIn(personal)).statusCode).toBe(403);
      expect((await signIn(workspace)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('keeps staff and player sessions apart, and ends a session on sign-out', async () => {
    const support = await staffSession(['support']);
    const guest = await signInGuest(t.app);
    expect((await get(guest.access, '/admin/me')).statusCode).toBe(401);
    expect((await get(support.token, '/v1/me')).statusCode).toBe(401);

    expect((await post(support.token, '/admin/auth/logout')).statusCode).toBe(204);
    expect((await get(support.token, '/admin/me')).statusCode).toBe(401);
    expect((await auditActions(support.id)).map((a) => a.action)).toEqual(['sign_in', 'sign_out']);
  });

  it('takes a removed role away at once, and the dev sign-in does not exist in production', async () => {
    const staff = await staffSession(['support']);
    await t.pool.query('DELETE FROM admin_role_grants WHERE admin_id = $1', [staff.id]);
    expect((await get(staff.token, '/admin/users?q=ab')).statusCode).toBe(403);

    const prod = await createTestApp({
      NODE_ENV: 'production',
      JWT_PRIVATE_KEY: 'x',
      JWT_PUBLIC_KEY: 'x',
      ANALYTICS_KEY: 'k'.repeat(32),
    });
    try {
      const res = await prod.app.inject({
        method: 'POST',
        url: '/admin/auth/dev',
        payload: { email: staff.email },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});

describe('players: search and User 360 (doc 18 §7)', () => {
  it('finds players by username, id, phone and device, and logs the search without the number', async () => {
    const phone = newPhone();
    const account = await phoneSignIn(phone);
    const username = `ada_${randomInt(1e6)}`;
    await t.pool.query('UPDATE users SET username = $2, status = $3 WHERE id = $1', [
      account.user.id,
      username,
      'active',
    ]);
    const guest = await signInGuest(t.app);
    const support = await staffSession(['support']);

    const search = async (q: string) =>
      (await get(support.token, `/admin/users?q=${encodeURIComponent(q)}`)).json() as AdminUserSearchResponse;
    expect((await search(username.slice(0, 6))).users.map((u) => u.id)).toContain(account.user.id);
    expect((await search(account.user.id)).users).toMatchObject([
      { id: account.user.id, matched: 'user_id' },
    ]);
    expect((await search(phone.typed)).users).toMatchObject([{ id: account.user.id, matched: 'phone' }]);
    expect((await search(guest.deviceId)).users).toMatchObject([{ id: guest.user.id, matched: 'device_id' }]);

    const logged = await t.pool.query<{ after: { q: string } }>(
      "SELECT after FROM admin_audit_log WHERE actor = $1 AND action = 'search_users' ORDER BY id",
      [support.id],
    );
    expect(logged.rows[2]!.after.q).toBe(`+234 80• ••• ${phone.e164.slice(-4)}`);
    expect(JSON.stringify(logged.rows)).not.toContain(phone.e164);
  });

  it('only lets the right roles search by phone, see players and read the audit log', async () => {
    const moderator = await staffSession(['moderator']);
    const viewer = await staffSession(['viewer']);
    expect(
      (await get(moderator.token, `/admin/users?q=${encodeURIComponent('0803 123 4567')}`)).statusCode,
    ).toBe(403);
    expect((await get(moderator.token, '/admin/users?q=ada')).statusCode).toBe(200);
    expect((await get(moderator.token, '/admin/audit')).statusCode).toBe(403);
    expect((await get(viewer.token, '/admin/users?q=ada')).statusCode).toBe(403);
  });

  it('shows one person across a merged guest: masked sign-ins, consents and one timeline (AD-3)', async () => {
    const phone = newPhone();
    const account = await phoneSignIn(phone);
    // Later, on another device, a guest signs in to the same account and is merged into it.
    const guest = await signInGuest(t.app, 'web');
    t.clock.t += 60_000; // past the 30 s wait before a second code to the same number
    const merged = await phoneSignIn(phone, guest.access);
    expect(merged).toMatchObject({ merged_guest: true, user: { id: account.user.id } });
    await t.app.inject({
      method: 'POST',
      url: '/v1/me/consents',
      headers: bearer(merged.access),
      payload: {
        source: 'web_banner',
        consents: [{ purpose: 'analytics', granted: true, policy_version: '2026-10' }],
      },
    });

    const event = (userId: string, event: string, ts: string) =>
      t.pool.query(
        `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, session_id, platform)
         VALUES ($1, $2, 'client', $3, $4, 's1', 'web')`,
        [newId('req'), event, ts, pseudonymousId(userId, t.config.analyticsKey)],
      );
    await event(guest.user.id, 'session_started', '2026-11-01T08:00:00Z');
    await event(account.user.id, 'screen_viewed', '2026-11-01T09:00:00Z');
    await event(account.user.id, 'app_backgrounded', '2026-11-01T09:05:00Z');

    const support = await staffSession(['support']);
    const summary = (await get(support.token, `/admin/users/${account.user.id}`)).json() as AdminUserSummary;
    expect(summary.sign_in_methods.map((m) => m.masked)).toContain(`+234 80• ••• ${phone.e164.slice(-4)}`);
    expect(JSON.stringify(summary)).not.toContain(phone.e164);
    expect(summary.merged_guests).toEqual([guest.user.id]);
    expect(summary.consents).toMatchObject([{ purpose: 'analytics', granted: true, source: 'web_banner' }]);

    const page1 = (
      await get(support.token, `/admin/users/${account.user.id}/timeline?limit=2`)
    ).json() as AdminTimelineResponse;
    expect(page1.events.map((e) => e.event)).toEqual(['app_backgrounded', 'screen_viewed']);
    const page2 = (
      await get(
        support.token,
        `/admin/users/${account.user.id}/timeline?limit=2&before=${encodeURIComponent(page1.next_before!)}`,
      )
    ).json() as AdminTimelineResponse;
    expect(page2.events.map((e) => e.event)).toEqual(['session_started']);
    expect(page2.next_before).toBeNull();

    expect((await auditActions(support.id)).map((a) => [a.action, a.entity_id])).toEqual([
      ['sign_in', support.id],
      ['view_user', account.user.id],
      ['view_timeline', account.user.id],
      ['view_timeline', account.user.id],
    ]);
  });

  it('reveals a phone number only with the role and a reason, logged first (AD-5)', async () => {
    const phone = newPhone();
    const account = await phoneSignIn(phone);
    const support = await staffSession(['support']);
    const moderator = await staffSession(['moderator']);
    const url = `/admin/users/${account.user.id}/reveal`;

    expect((await post(support.token, url, { field: 'phone', reason: 'no' })).statusCode).toBe(400);
    expect((await post(moderator.token, url, { field: 'phone', reason: 'ticket 1234' })).statusCode).toBe(
      403,
    );
    const res = await post(support.token, url, { field: 'phone', reason: 'ticket 1234: wrong number' });
    expect(res.json()).toEqual({ field: 'phone', value: phone.e164 });

    const dpo = await staffSession(['dpo']);
    const history = (
      await get(dpo.token, `/admin/users/${account.user.id}/audit`)
    ).json() as AdminAuditResponse;
    expect(history.entries[0]).toMatchObject({
      actor: support.id,
      action: 'reveal_pii',
      reason: 'ticket 1234: wrong number',
    });
  });
});

describe('staff and roles (doc 18 §3)', () => {
  it('needs a second owner for privileged roles, and keeps the last owner', async () => {
    const first = await staffSession(['owner']);
    const added = await post(first.token, '/admin/staff', {
      email: `new${randomInt(1e9)}@whosabi.ng`,
      name: 'Ngozi',
    });
    expect(added.statusCode).toBe(201);
    const ngozi = added.json() as AdminStaffMember;
    const roles = `/admin/staff/${ngozi.id}/roles`;

    // Support works straight away; admin waits for a second owner.
    let member = (
      await post(first.token, roles, { role: 'support', reason: 'new support hire' })
    ).json() as AdminStaffMember;
    expect(member.grants).toMatchObject([{ role: 'support', active: true }]);
    member = (
      await post(first.token, roles, { role: 'admin', reason: 'team lead' })
    ).json() as AdminStaffMember;
    expect(member.grants.find((g) => g.role === 'admin')).toMatchObject({ active: false, approved_by: null });

    const approve = `/admin/staff/${ngozi.id}/roles/admin/approve`;
    expect((await post(first.token, approve)).statusCode).toBe(409);
    const second = await staffSession(['owner']);
    member = (await post(second.token, approve)).json() as AdminStaffMember;
    expect(member.grants.find((g) => g.role === 'admin')).toMatchObject({
      active: true,
      approved_by: second.id,
    });

    // Only owners manage staff; admins can't.
    const ngoziToken = (await devSignIn(ngozi.email)).token;
    expect((await get(ngoziToken, '/admin/staff')).statusCode).toBe(403);

    // Owners can step down while another owner remains.
    const remove = (token: string, id: string) =>
      t.app.inject({ method: 'DELETE', url: `/admin/staff/${id}/roles/owner`, headers: bearer(token) });
    await t.pool.query("DELETE FROM admin_role_grants WHERE role = 'owner' AND admin_id NOT IN ($1, $2)", [
      first.id,
      second.id,
    ]);
    expect((await remove(first.token, second.id)).statusCode).toBe(200);
    expect((await remove(first.token, first.id)).statusCode).toBe(409);

    const actions = (await auditActions(first.id)).map((a) => a.action);
    expect(actions).toEqual(['sign_in', 'add_staff', 'grant_role', 'grant_role', 'revoke_role']);
  });
});
