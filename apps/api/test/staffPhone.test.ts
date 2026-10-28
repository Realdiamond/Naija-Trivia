/**
 * Staff on the phone (step 2.9a): the Staff tab shows for owners and admins who play with their
 * staff Google account; a phone signs in for 30 days, is listed in the console and can be signed
 * out there; and the live numbers.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminOverview,
  AdminPhonesResponse,
  AdminRole,
  AdminSessionResponse,
  Me,
} from '@whosabi/shared-types';
import { createPhoneSession } from '../src/admin/phones';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const DAY = 24 * 3_600_000;

let t: Awaited<ReturnType<typeof createTestApp>>;
let consoleSessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp();
  consoleSessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(() => t.close());

interface Staff {
  id: string;
  email: string;
}

async function staff(roles: AdminRole[], name = roles.join('+')): Promise<Staff> {
  const id = newId('adm');
  const email = `phone${randomInt(1e9)}@whosabi.ng`;
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [id, email, name]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return { id, email };
}

/** A phone session made directly: the sign-in has its own tests and a per-IP limit. */
async function phone(s: Staff, label = 'Test phone') {
  return (await createPhoneSession(t.pool, s.id, label, t.clock.now())).token;
}

const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (token: string, url: string) => t.app.inject({ method: 'POST', url, headers: bearer(token) });

/** A player signing in to the app with Google. */
async function playWithGoogle(email: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/google',
    payload: {
      id_token: await t.signGoogle({ sub: `g-${email}`, email, email_verified: true }),
      platform: 'android',
    },
  });
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json() as { access: string; user: { id: string } };
}

async function me(access: string): Promise<Me> {
  return (await get(access, '/v1/me')).json() as Me;
}

describe('the Staff tab', () => {
  it('shows for an owner or admin who plays with their staff Google account, and nobody else', async () => {
    const owner = await staff(['owner']);
    const support = await staff(['support']);
    expect((await me((await playWithGoogle(owner.email)).access)).staff).toBe(true);
    expect((await me((await playWithGoogle(support.email)).access)).staff).toBe(false);
    expect((await me((await playWithGoogle(`player${randomInt(1e9)}@gmail.com`)).access)).staff).toBe(false);
    expect((await me((await signInGuest(t.app)).access)).staff).toBe(false);

    // Losing the role takes the tab away at once.
    const player = await playWithGoogle(owner.email);
    await t.pool.query("DELETE FROM admin_role_grants WHERE admin_id = $1 AND role = 'owner'", [owner.id]);
    expect((await me(player.access)).staff).toBe(false);
  });
});

describe('signing a phone in', () => {
  it('gives an owner a 30-day phone session from the app’s Google sign-in', async () => {
    const owner = await staff(['owner']);
    const res = await t.app.inject({
      method: 'POST',
      url: '/admin/auth/phone',
      payload: {
        id_token: await t.signGoogle({ sub: `g-${owner.email}`, email: owner.email, email_verified: true }),
        label: 'samsung SM-A145F',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const session = res.json() as AdminSessionResponse;
    expect(session.token).toMatch(/^aph_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(session.expires_at) - t.clock.now()).toBe(30 * DAY);
    expect(session.admin).toMatchObject({ id: owner.id, roles: ['owner'] });
    expect((await get(session.token, '/admin/me')).json()).toMatchObject({ id: owner.id });

    const audit = await t.pool.query<{ action: string; after: Record<string, unknown> }>(
      "SELECT action, after FROM admin_audit_log WHERE actor = $1 AND action = 'sign_in'",
      [owner.id],
    );
    expect(audit.rows).toEqual([
      {
        action: 'sign_in',
        after: expect.objectContaining({ method: 'phone_google', phone: 'samsung SM-A145F' }),
      },
    ]);
  });

  it('refuses people who are not owners or admins, and says why', async () => {
    const support = await staff(['support']);
    const dev = (email: string) =>
      t.app.inject({ method: 'POST', url: '/admin/auth/phone/dev', payload: { email, label: 'Phone' } });
    const notStaff = await dev(`nobody${randomInt(1e9)}@gmail.com`);
    expect(notStaff.statusCode).toBe(403);
    expect(notStaff.json().detail).toMatch(/not on the staff list/);
    const notAllowed = await dev(support.email);
    expect(notAllowed.statusCode).toBe(403);
    expect(notAllowed.json().detail).toMatch(/owners and admins/);
    expect((await dev((await staff(['admin'])).email)).statusCode).toBe(200);
  });
});

describe('a phone session', () => {
  it('works for 30 days, and stops at once when signed out, suspended or demoted', async () => {
    const owner = await staff(['owner']);
    const token = await phone(owner);
    expect((await get(token, '/admin/overview')).statusCode).toBe(200);
    t.clock.advance(30 * DAY);
    expect((await get(token, '/admin/overview')).statusCode).toBe(401);

    const second = await phone(owner);
    await t.pool.query("UPDATE admin_users SET status = 'suspended' WHERE id = $1", [owner.id]);
    expect((await get(second, '/admin/overview')).statusCode).toBe(401);
    await t.pool.query("UPDATE admin_users SET status = 'active' WHERE id = $1", [owner.id]);
    expect((await get(second, '/admin/overview')).statusCode).toBe(200);

    // Made an editor only: still on the console, no longer on the phone.
    await t.pool.query("UPDATE admin_role_grants SET role = 'editor' WHERE admin_id = $1", [owner.id]);
    expect((await get(second, '/admin/me')).statusCode).toBe(403);
  });

  it('is listed in the console and signed out from there, or from the phone itself', async () => {
    const owner = await staff(['owner'], 'Owner Ola');
    const admin = await staff(['admin'], 'Admin Ada');
    const editor = await staff(['editor'], 'Editor Edo');
    const ownerPhone = await phone(owner, 'Ola’s Tecno');
    const adminPhone = await phone(admin, 'Ada’s Infinix');
    const ownerConsole = (await consoleSessions.create(owner.id)).token;
    const editorConsole = (await consoleSessions.create(editor.id)).token;

    const listed = (await get(ownerConsole, '/admin/phones')).json() as AdminPhonesResponse;
    const mine = listed.phones.filter((p) => [owner.id, admin.id].includes(p.admin_id));
    expect(mine.map((p) => [p.admin_name, p.label, p.current]).sort()).toEqual([
      ['Admin Ada', 'Ada’s Infinix', false],
      ['Owner Ola', 'Ola’s Tecno', false],
    ]);
    // On the phone itself, its own row is marked.
    const fromPhone = (await get(ownerPhone, '/admin/phones')).json() as AdminPhonesResponse;
    expect(fromPhone.phones.find((p) => p.label === 'Ola’s Tecno')?.current).toBe(true);
    // Anyone else sees only their own phones.
    expect(((await get(editorConsole, '/admin/phones')).json() as AdminPhonesResponse).phones).toEqual([]);

    // The owner signs Ada's phone out from the console.
    const ada = mine.find((p) => p.admin_id === admin.id)!;
    expect((await post(editorConsole, `/admin/phones/${ada.id}/revoke`)).statusCode).toBe(404);
    expect((await post(ownerConsole, `/admin/phones/${ada.id}/revoke`)).statusCode).toBe(204);
    expect((await get(adminPhone, '/admin/me')).statusCode).toBe(401);

    // Signing out on the phone ends its session too.
    expect((await post(ownerPhone, '/admin/auth/logout')).statusCode).toBe(204);
    expect((await get(ownerPhone, '/admin/me')).statusCode).toBe(401);
    const signOuts = await t.pool.query(
      "SELECT 1 FROM admin_audit_log WHERE action = 'sign_out_phone' AND entity_id = $1",
      [admin.id],
    );
    expect(signOuts.rowCount).toBe(1);
  });
});

describe('live numbers', () => {
  it('counts today so far against yesterday at the same time', async () => {
    t.clock.t = Date.UTC(2027, 4, 10, 9, 0); // 10:00 WAT
    const owner = await staff(['owner']);
    const token = await phone(owner);
    const read = async () => (await get(token, '/admin/overview')).json() as AdminOverview;

    const before = await read();
    await signInGuest(t.app);
    await playWithGoogle(`newplayer${randomInt(1e9)}@gmail.com`);
    const after = await read();
    expect(after.new_players.today - before.new_players.today).toBe(2);
    expect(after.signups.today - before.signups.today).toBe(1);
    expect(after.online_now).toBeGreaterThanOrEqual(1);

    // Tomorrow at 10:01 WAT those are yesterday's, counted up to the same time.
    t.clock.t = Date.UTC(2027, 4, 11, 9, 1);
    const tomorrow = await read();
    expect(tomorrow.new_players.yesterday).toBe(after.new_players.today);
    expect(tomorrow.signups.yesterday).toBe(after.signups.today);
    expect(tomorrow.new_players.today).toBe(0);
    expect(tomorrow.waiting).toEqual({
      reported_questions: expect.any(Number),
      in_review: expect.any(Number),
      approved: expect.any(Number),
    });
  });

  it('needs the overview permission', async () => {
    const writer = await staff(['writer']);
    const token = (await consoleSessions.create(writer.id)).token;
    expect((await get(token, '/admin/overview')).statusCode).toBe(403);
  });
});
