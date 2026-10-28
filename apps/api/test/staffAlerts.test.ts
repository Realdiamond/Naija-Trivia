/**
 * Staff alerts (step 2.9b): what raises one, how they reach staff phones (at once, grouped when
 * many come together, never to someone who switched that kind off), and the list and settings in
 * the Staff tab.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminRole, StaffAlertSettingsResponse, StaffAlertsResponse } from '@whosabi/shared-types';
import { raiseStaffAlert, sendStaffAlerts } from '../src/admin/alerts';
import { createPhoneSession } from '../src/admin/phones';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { reportQuestion } from '../src/content/reports';
import { DailyService } from '../src/daily/service';
import { ServerEvents } from '../src/events';
import { newId } from '../src/ids';
import type { JobDeps } from '../src/jobs/deps';
import { bearer, createTestApp, signInGuest } from './helpers';
import { newPushToken, TestTransport } from './pushHelpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let deps: JobDeps;
beforeAll(async () => {
  t = await createTestApp();
  deps = {
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  };
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(() => t.close());

interface StaffPhone {
  id: string;
  token: string;
  pushToken: string;
}

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `alerts${randomInt(1e9)}@whosabi.ng`,
    roles.join('+'),
  ]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return id;
}

/** A staff phone signed in and with pushes on, through the API like the app does. */
async function phone(adminId: string): Promise<StaffPhone> {
  const { token } = await createPhoneSession(t.pool, adminId, 'Test phone', t.clock.now());
  const pushToken = newPushToken();
  const res = await t.app.inject({
    method: 'POST',
    url: '/admin/phones/push',
    headers: bearer(token),
    payload: { push_token: pushToken },
  });
  expect(res.statusCode, res.body).toBe(204);
  return { id: adminId, token, pushToken };
}

/** Only this file's alerts reach these phones: start each test with nothing waiting. */
async function clear() {
  await t.pool.query('UPDATE staff_alerts SET delivered_at = now() WHERE delivered_at IS NULL');
}

const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });

describe('staff alerts on the phone', () => {
  it('pushes every sign-up to owners and admins at once, with the player to open', async () => {
    await clear();
    const owner = await phone(await staff(['owner']));
    const admin = await phone(await staff(['admin']));
    const transport = new TestTransport();

    const signed = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      payload: { id_token: await t.signGoogle({ sub: `alert-${randomInt(1e9)}` }), platform: 'android' },
    });
    const userId = (signed.json() as { user: { id: string } }).user.id;
    expect(await sendStaffAlerts(deps, transport)).toBe(1);
    for (const p of [owner, admin]) {
      expect(transport.to(p.pushToken)).toEqual([
        expect.objectContaining({
          type: 'staff_alert',
          title: 'New sign-up 🎉',
          body: 'Signed up with Google on Android.',
          url: `/staff/player/${userId}`,
          channel: 'staff',
        }),
      ]);
    }
    // Sent once.
    expect(await sendStaffAlerts(deps, transport)).toBe(0);
    // A guest starting to play is not a sign-up.
    await signInGuest(t.app);
    expect(await sendStaffAlerts(deps, transport)).toBe(0);
  });

  it('groups a burst of one kind into one push', async () => {
    await clear();
    const owner = await phone(await staff(['owner']));
    for (let i = 0; i < 5; i++) {
      await raiseStaffAlert(t.pool, {
        kind: 'signup',
        title: 'New sign-up 🎉',
        body: `n${i}`,
        now: t.clock.now(),
      });
    }
    await raiseStaffAlert(t.pool, {
      kind: 'problem',
      title: 'Something broke',
      body: 'b',
      now: t.clock.now(),
    });
    const transport = new TestTransport();
    expect(await sendStaffAlerts(deps, transport)).toBe(6);
    expect(
      transport
        .to(owner.pushToken)
        .map((p) => p.title)
        .sort(),
    ).toEqual(['5 new sign-ups 🎉', 'Something broke']);
  });

  it('skips a kind someone switched off, and phones that are signed out or not allowed', async () => {
    await clear();
    const owner = await phone(await staff(['owner']));
    const admin = await phone(await staff(['admin']));
    const gone = await phone(await staff(['owner']));
    await t.app.inject({ method: 'POST', url: '/admin/auth/logout', headers: bearer(gone.token) });
    const demoted = await phone(await staff(['admin']));
    await t.pool.query("UPDATE admin_role_grants SET role = 'editor' WHERE admin_id = $1", [demoted.id]);

    const off = await t.app.inject({
      method: 'PUT',
      url: '/admin/alerts/settings',
      headers: bearer(admin.token),
      payload: { kind: 'signup', enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect(
      (off.json() as StaffAlertSettingsResponse).settings.find((s) => s.kind === 'signup')?.enabled,
    ).toBe(false);

    await raiseStaffAlert(t.pool, { kind: 'signup', title: 'New sign-up 🎉', body: 'x', now: t.clock.now() });
    const transport = new TestTransport();
    await sendStaffAlerts(deps, transport);
    expect(transport.to(owner.pushToken)).toHaveLength(1);
    for (const p of [admin, gone, demoted]) expect(transport.to(p.pushToken), p.id).toEqual([]);
  });

  it('forgets dead tokens and tries again when the push service is busy', async () => {
    await clear();
    const dead = await phone(await staff(['owner']));
    const busy = await phone(await staff(['owner']));
    const transport = new TestTransport();
    transport.failNext(dead.pushToken, 'invalid');
    transport.failNext(busy.pushToken, 'transient');
    await raiseStaffAlert(t.pool, { kind: 'problem', title: 'Problem', body: 'p', now: t.clock.now() });
    expect(await sendStaffAlerts(deps, transport)).toBe(0);
    const token = await t.pool.query('SELECT push_token FROM admin_phone_sessions WHERE admin_id = $1', [
      dead.id,
    ]);
    expect(token.rows).toEqual([{ push_token: null }]);

    t.clock.advance(31_000);
    expect(await sendStaffAlerts(deps, transport)).toBe(1);
    expect(transport.to(busy.pushToken)).toHaveLength(1);
  });
});

describe('what raises a problem', () => {
  it('a question taken out by player reports', async () => {
    await clear();
    const question = (
      await t.pool.query<{ id: string; text: string }>(
        "SELECT id, text FROM questions WHERE status = 'live' ORDER BY id DESC LIMIT 1",
      )
    ).rows[0]!;
    try {
      for (let i = 0; i < 5; i++) {
        const guest = await signInGuest(t.app);
        await reportQuestion(t.pool, {
          questionId: question.id,
          userId: guest.user.id,
          reason: 'wrong_answer',
          note: null,
          now: t.clock.now(),
        });
      }
      const alerts = await t.pool.query<{ title: string; body: string }>(
        "SELECT title, body FROM staff_alerts WHERE kind = 'problem' AND delivered_at IS NULL",
      );
      expect(alerts.rows).toEqual([
        { title: 'Question taken out by player reports', body: expect.stringContaining(question.text) },
      ]);
    } finally {
      await t.pool.query("UPDATE questions SET status = 'live' WHERE id = $1", [question.id]);
      await t.pool.query('DELETE FROM question_reports WHERE question_id = $1', [question.id]);
    }
  });

  it('no Daily for tomorrow, once per date', async () => {
    await clear();
    // 23:30 WAT on a day no test plays a Daily, with every category off: nothing can be picked.
    t.clock.t = Date.UTC(2027, 7, 14, 22, 30);
    const daily = new DailyService({ ...deps, config: t.config });
    await t.pool.query('UPDATE categories SET active = false');
    try {
      await daily.schedule();
      await daily.schedule();
    } finally {
      await t.pool.query("UPDATE categories SET active = (id <> 'sport')");
    }
    const alerts = await t.pool.query<{ title: string }>(
      "SELECT title FROM staff_alerts WHERE dedupe_key LIKE 'daily_missing:2027-08-1%' ORDER BY title",
    );
    expect(alerts.rows.map((r) => r.title)).toEqual(['No Daily for today', 'No Daily for tomorrow']);
  });
});

describe('the alerts list and settings', () => {
  it('lists alerts newest first with what is unread, until marked seen', async () => {
    const ownerId = await staff(['owner']);
    const owner = await phone(ownerId);
    const before = (await get(owner.token, '/admin/alerts')).json() as StaffAlertsResponse;
    await raiseStaffAlert(t.pool, { kind: 'signup', title: 'Newest', body: 'n', now: t.clock.now() });

    const list = (await get(owner.token, '/admin/alerts')).json() as StaffAlertsResponse;
    expect(list.unread).toBe(before.unread + 1);
    expect(list.alerts[0]).toMatchObject({ kind: 'signup', title: 'Newest', unread: true });

    const seen = await t.app.inject({
      method: 'POST',
      url: '/admin/alerts/seen',
      headers: bearer(owner.token),
      payload: { up_to: Number(list.alerts[0]!.id) },
    });
    expect(seen.statusCode).toBe(204);
    const after = (await get(owner.token, '/admin/alerts')).json() as StaffAlertsResponse;
    expect(after.unread).toBe(0);
    expect(after.alerts[0]!.unread).toBe(false);

    // Every kind starts on.
    const settings = (await get(owner.token, '/admin/alerts/settings')).json() as StaffAlertSettingsResponse;
    expect(settings.settings.map((s) => [s.kind, s.enabled])).toEqual([
      ['problem', true],
      ['signup', true],
      ['payment_opened', true],
      ['payment_started', true],
      ['payment_paid', true],
    ]);
  });

  it('is for owners and admins, and push tokens come only from staff phones', async () => {
    const editor = (await new AdminSessions(t.redis, t.clock.now).create(await staff(['editor']))).token;
    expect((await get(editor, '/admin/alerts')).statusCode).toBe(403);
    const ownerConsole = (await new AdminSessions(t.redis, t.clock.now).create(await staff(['owner']))).token;
    expect((await get(ownerConsole, '/admin/alerts')).statusCode).toBe(200);
    const res = await t.app.inject({
      method: 'POST',
      url: '/admin/phones/push',
      headers: bearer(ownerConsole),
      payload: { push_token: newPushToken() },
    });
    expect(res.statusCode).toBe(403);
  });
});
