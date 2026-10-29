/**
 * Support (build plan step 2.7p): a player writes from the app's Help screen, the message is
 * kept and emailed to the helpdesk's inbox, support answers it in the console, and the player
 * reads the answer in the app. A month no other test file plays in: November 2028.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminRole,
  AdminSupportQueue,
  AdminSupportTicket,
  MySupportTickets,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const INBOX = 'help@whosabi.test';

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
const users: string[] = [];

beforeAll(async () => {
  t = await createTestApp({ SUPPORT_INBOX: INBOX, ADMIN_WEB_URL: 'https://admin.whosabi.test/' });
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  t.clock.t = Date.UTC(2028, 10, 14, 9);
});

afterAll(async () => {
  await t.pool.query('DELETE FROM support_tickets WHERE user_id = ANY($1)', [users]);
  await t.close();
});

async function player() {
  const p = await signInGuest(t.app, 'android');
  users.push(p.user.id);
  return p;
}

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `support-${randomInt(1e9)}@whosabi.ng`,
    `Agent ${roles.join('+')}`,
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

const write = (access: string, payload: object, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/support/tickets',
    headers: { ...bearer(access), ...headers },
    payload,
  });

describe('writing to support (step 2.7p)', () => {
  it('keeps the message with the app it came from and emails it to the helpdesk', async () => {
    const p = await player();
    const sent = t.email.outbox.length;
    const res = await write(
      p.access,
      {
        topic: 'purchase',
        message: 'I bought the big coin pack but the coins never came.',
        email: 'chidi.okeke@example.com',
        device: 'Tecno Spark 10',
      },
      { 'x-app-version': '1.2.0' },
    );
    expect(res.statusCode, res.body).toBe(201);
    const ticket = res.json();
    expect(ticket).toMatchObject({ topic: 'purchase', status: 'open', answer: null });
    expect(ticket.id).toMatch(/^st_/);

    const email = t.email.outbox.at(-1)!;
    expect(t.email.outbox.length).toBe(sent + 1);
    expect(email).toMatchObject({ to: INBOX, replyTo: 'chidi.okeke@example.com' });
    expect(email.subject).toBe(`Coins or a purchase: a guest (${ticket.id})`);
    expect(email.text).toContain('I bought the big coin pack but the coins never came.');
    expect(email.text).toContain('App: android 1.2.0, Tecno Spark 10');
    expect(email.text).toContain(`https://admin.whosabi.test/players/${p.user.id}?tab=support`);

    const row = await t.pool.query(
      'SELECT platform, app_version, device, emailed_at FROM support_tickets WHERE id = $1',
      [ticket.id],
    );
    expect(row.rows[0]).toMatchObject({
      platform: 'android',
      app_version: '1.2.0',
      device: 'Tecno Spark 10',
    });
    expect(row.rows[0].emailed_at).not.toBeNull();
  });

  it('keeps a message the helpdesk could not take, refuses short ones, and limits how many', async () => {
    const p = await player();
    t.email.down = true;
    const kept = await write(p.access, { topic: 'other', message: 'Is there a dark mode coming?' });
    t.email.down = false;
    expect(kept.statusCode).toBe(201);
    const row = await t.pool.query('SELECT emailed_at FROM support_tickets WHERE id = $1', [kept.json().id]);
    expect(row.rows[0].emailed_at).toBeNull();

    expect((await write(p.access, { topic: 'other', message: 'Help' })).statusCode).toBe(400);
    expect(
      (await write(p.access, { topic: 'nonsense', message: 'Something is wrong here' })).statusCode,
    ).toBe(400);
    for (let i = 0; i < 4; i++) {
      expect(
        (await write(p.access, { topic: 'other', message: `Another question, number ${i}` })).statusCode,
      ).toBe(201);
    }
    const sixth = await write(p.access, { topic: 'other', message: 'One more question for you' });
    expect(sixth.statusCode).toBe(429);
    t.clock.advance(3_600_000 + 1);
    // A new hour; the old session's token has run out, so sign in again on the same device.
    const again = await signInGuest(t.app, 'android', p.deviceId);
    expect(
      (await write(again.access, { topic: 'other', message: 'One more question for you' })).statusCode,
    ).toBe(201);
  });
});

describe('support in the console', () => {
  it('shows the queue to support, who answer in words the player reads in the app', async () => {
    const p = await player();
    const other = await player();
    const ticket = (
      await write(p.access, {
        topic: 'streak',
        message: 'My 40-day streak went back to zero yesterday.',
        email: 'ada@example.com',
      })
    ).json();
    await write(other.access, { topic: 'other', message: 'Can I play with my cousins abroad?' });

    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/admin/support',
          headers: bearer(await staff(['moderator'])),
        })
      ).statusCode,
    ).toBe(403);
    const agent = await staff(['support']);
    const queue = (
      await t.app.inject({ method: 'GET', url: '/admin/support', headers: bearer(agent) })
    ).json() as AdminSupportQueue;
    expect(queue.inbox).toBe(true);
    expect(queue.open).toBeGreaterThanOrEqual(2);
    expect(queue.tickets.find((x) => x.id === ticket.id)).toMatchObject({
      user_id: p.user.id,
      player: null,
      email: 'a•••@example.com',
      platform: 'android',
      emailed: true,
      status: 'open',
    });

    const answered = await t.app.inject({
      method: 'POST',
      url: `/admin/support/${ticket.id}`,
      headers: bearer(agent),
      payload: { status: 'answered', answer: "We've restored your streak. Keep going!" },
    });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json() as AdminSupportTicket).toMatchObject({
      status: 'answered',
      answer: "We've restored your streak. Keep going!",
      answered_by: 'Agent support',
    });

    // The player sees it in the app, and only their own messages.
    const mine = (
      await t.app.inject({ method: 'GET', url: '/v1/support/tickets', headers: bearer(p.access) })
    ).json() as MySupportTickets;
    expect(mine.tickets).toHaveLength(1);
    expect(mine.tickets[0]).toMatchObject({
      id: ticket.id,
      status: 'answered',
      answer: "We've restored your streak. Keep going!",
    });

    // On User 360, with the answered ones too; opening it again clears the answer.
    const viewer = await staff(['moderator']);
    const onPage = (
      await t.app.inject({ method: 'GET', url: `/admin/users/${p.user.id}/tickets`, headers: bearer(viewer) })
    ).json() as { tickets: AdminSupportTicket[] };
    expect(onPage.tickets.map((x) => x.id)).toEqual([ticket.id]);
    const reopened = await t.app.inject({
      method: 'POST',
      url: `/admin/support/${ticket.id}`,
      headers: bearer(agent),
      payload: { status: 'open' },
    });
    expect(reopened.json()).toMatchObject({ status: 'open', answer: null, answered_by: null });

    const audit = await t.pool.query(
      `SELECT action FROM admin_audit_log WHERE entity = 'user' AND entity_id = $1 ORDER BY id`,
      [p.user.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['answer_ticket', 'reopen_ticket']);
  });

  it("puts the messages in the player's data download, and deletes them with the account", async () => {
    const p = await player();
    await write(p.access, { topic: 'account', message: 'Please change my username to something else.' });
    const data = (
      await t.app.inject({ method: 'GET', url: '/v1/me/export', headers: bearer(p.access) })
    ).json();
    expect(data.messages_to_support).toEqual([
      expect.objectContaining({ topic: 'account', message: 'Please change my username to something else.' }),
    ]);
    const deleted = await t.app.inject({
      method: 'POST',
      url: '/v1/me/delete',
      headers: bearer(p.access),
      payload: { confirm: true },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const left = await t.pool.query('SELECT 1 FROM support_tickets WHERE user_id = $1', [p.user.id]);
    expect(left.rowCount).toBe(0);
  });
});
