/**
 * Threshold alerts (build plan step 2.7m): rules made in the console, checked by the worker every
 * minute, alerting staff once when crossed and once when back to normal.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminAlertRule,
  AdminAlertRulesResponse,
  AdminRole,
  AlertRuleInput,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { DevEmail } from '../src/auth/email';
import { ServerEvents } from '../src/events';
import { newId } from '../src/ids';
import { checkAlertRules, type AlertOutlets } from '../src/jobs/alertRules';
import { bearer, createTestApp } from './helpers';

const MINUTE = 60_000;
const WEEK = 7 * 24 * 60 * MINUTE;
// A month no other test file plays in: Monday 4 September 2028, 10:00 WAT.
const NOW = Date.UTC(2028, 8, 4, 9, 0);

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
let owner: string;
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = NOW;
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  owner = await staff(['owner']);
});
afterAll(async () => {
  await t.pool.query("DELETE FROM analytics_events WHERE ts >= '2028-08-20' AND ts < '2028-09-10'");
  await t.pool.query("DELETE FROM staff_alerts WHERE dedupe_key LIKE 'alert_rule:%'");
  await t.pool.query('DELETE FROM alert_rules');
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `alerts-${randomInt(1e9)}@whosabi.ng`,
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

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token = owner, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

async function rule(
  input: Partial<AlertRuleInput> & Pick<AlertRuleInput, 'metric' | 'comparison' | 'threshold'>,
) {
  const res = await call('POST', '/admin/alert-rules', owner, {
    window_minutes: 15,
    channels: ['phone'],
    ...input,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as AdminAlertRule;
}

async function event(name: string, at: number, who = `p_${randomUUID()}`) {
  await t.pool.query(
    `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, platform, props)
     VALUES ($1, $2, 'server', $3, $4, 'android', '{}')`,
    [`e_${randomUUID()}`, name, new Date(at), who],
  );
}

const slack: Array<{ url: string; body: { text: string } }> = [];
const email = new DevEmail();
const outlets: AlertOutlets = {
  email,
  emailTo: ['ops@whosabi.ng', 'owner@whosabi.ng'],
  slackWebhookUrl: 'https://hooks.slack.test/services/x',
  fetch: (async (url: string, init: RequestInit) => {
    slack.push({ url, body: JSON.parse(String(init.body)) as { text: string } });
    return new Response('ok', { status: 200 });
  }) as typeof fetch,
};
const check = () =>
  checkAlertRules(
    {
      pool: t.pool,
      redis: t.redis,
      clock: t.clock,
      events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
      log: t.app.log,
    },
    outlets,
  );
const alertsFor = async (id: string) =>
  (
    await t.pool.query<{ title: string; body: string; kind: string }>(
      'SELECT title, body, kind FROM staff_alerts WHERE dedupe_key LIKE $1 ORDER BY id',
      [`alert_rule:${id}:%`],
    )
  ).rows;

describe('threshold alerts (step 2.7m)', () => {
  it('lets owners and admins make, change and delete rules, all audited', async () => {
    expect((await call('GET', '/admin/alert-rules', await staff(['support']))).statusCode).toBe(403);
    expect((await call('GET', '/admin/alert-rules', await staff(['analyst']))).statusCode).toBe(403);
    const admin = await staff(['admin']);
    const listed = (await call('GET', '/admin/alert-rules', admin)).json() as AdminAlertRulesResponse;
    // No Resend key, ALERT_EMAILS or Slack webhook in tests: only phones.
    expect(listed.channels).toEqual({ phone: true, email: false, slack: false });

    const bad = await call('POST', '/admin/alert-rules', admin, {
      metric: 'signups',
      comparison: 'above',
      threshold: 5,
      window_minutes: 2,
      channels: ['phone'],
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await call('POST', '/admin/alert-rules', admin, {
          metric: 'nothing',
          comparison: 'above',
          threshold: 5,
          window_minutes: 15,
          channels: ['phone'],
        })
      ).statusCode,
    ).toBe(400);

    const made = await rule({
      name: 'Sign-ups flood',
      metric: 'signups',
      comparison: 'above',
      threshold: 500,
    });
    expect(made).toMatchObject({
      name: 'Sign-ups flood',
      enabled: true,
      firing_since: null,
      last_value: null,
      channels: ['phone'],
    });
    const off = await call('POST', `/admin/alert-rules/${made.id}`, admin, {
      enabled: false,
      threshold: 800,
    });
    // What isn't sent stays as it was: the name too.
    expect(off.json()).toMatchObject({ name: 'Sign-ups flood', enabled: false, threshold: 800 });
    expect((await call('DELETE', `/admin/alert-rules/${made.id}`, admin)).statusCode).toBe(204);
    expect((await call('DELETE', `/admin/alert-rules/${made.id}`, admin)).statusCode).toBe(404);
    const audit = await t.pool.query<{ action: string }>(
      'SELECT action FROM admin_audit_log WHERE entity = $1 AND entity_id = $2 ORDER BY id',
      ['alert_rule', made.id],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      'create_alert_rule',
      'update_alert_rule',
      'delete_alert_rule',
    ]);
  });

  it('alerts once when a rule is crossed, on its channels, and once when it is back to normal', async () => {
    const codes = await rule({
      metric: 'otp_success',
      comparison: 'below',
      threshold: 85,
      channels: ['phone', 'email', 'slack'],
    });
    const players = await rule({
      metric: 'active_players',
      comparison: 'drop_pct_vs_last_week',
      threshold: 20,
      window_minutes: 60,
    });
    const quiet = await rule({ metric: 'signups', comparison: 'above', threshold: 100, window_minutes: 60 });
    const off = await rule({ metric: 'reports', comparison: 'above', threshold: 0 });
    await call('POST', `/admin/alert-rules/${off.id}`, owner, { enabled: false });
    // Three pushes sent at night say nothing about how pushes do: too few to judge.
    const pushes = await rule({
      metric: 'push_opened',
      comparison: 'below',
      threshold: 50,
      window_minutes: 5,
    });

    // Half the codes sent in the last 15 minutes were verified.
    for (let i = 0; i < 10; i++) await event('otp_sent', NOW - 10 * MINUTE);
    for (let i = 0; i < 5; i++) await event('otp_verified', NOW - 9 * MINUTE);
    // 40 players at this time last week; now 18 (the 15 above and 3 below).
    for (let i = 0; i < 40; i++) await event('session_started', NOW - WEEK - 30 * MINUTE);
    for (let i = 0; i < 3; i++) await event('push_sent', NOW - 2 * MINUTE);

    expect(await check()).toEqual({ checked: 4, fired: 2, resolved: 0 });
    expect(await alertsFor(codes.id)).toEqual([
      {
        kind: 'problem',
        title: 'Sign-in codes verified: 50%, below 85%',
        body: '50% over the last 15 minutes (alert below 85%).',
      },
    ]);
    const [drop] = await alertsFor(players.id);
    expect(drop!.title).toBe('Players active: down 55% on last week');
    expect(drop!.body).toBe(
      '18 players over the last 60 minutes, against 40 players at the same time last week (alert at 20% down).',
    );
    expect(await alertsFor(quiet.id)).toEqual([]);
    expect(await alertsFor(pushes.id)).toEqual([]);
    // The codes rule also goes to Slack and to each email address; the players rule only to phones.
    expect(slack).toEqual([
      {
        url: 'https://hooks.slack.test/services/x',
        body: {
          text: '*Sign-in codes verified: 50%, below 85%*\n50% over the last 15 minutes (alert below 85%).',
        },
      },
    ]);
    expect(email.outbox.map((m) => [m.to, m.subject])).toEqual([
      ['ops@whosabi.ng', 'Who Sabi? alert: Sign-in codes verified: 50%, below 85%'],
      ['owner@whosabi.ng', 'Who Sabi? alert: Sign-in codes verified: 50%, below 85%'],
    ]);

    // The same minute again: nothing is checked twice. A minute on: checked, but no new alert.
    expect(await check()).toEqual({ checked: 0, fired: 0, resolved: 0 });
    t.clock.advance(MINUTE);
    expect(await check()).toEqual({ checked: 4, fired: 0, resolved: 0 });
    const listed = (await call('GET', '/admin/alert-rules')).json() as AdminAlertRulesResponse;
    const state = (id: string) => listed.rules.find((r) => r.id === id)!;
    expect(state(codes.id)).toMatchObject({ firing_since: new Date(NOW).toISOString(), last_value: 50 });
    expect(state(pushes.id)).toMatchObject({ firing_since: null, last_value: null });
    expect(state(off.id).last_checked_at).toBeNull();

    // The codes come right: one "back to normal", on the same channels.
    for (let i = 0; i < 5; i++) await event('otp_verified', t.clock.now() - MINUTE);
    t.clock.advance(MINUTE);
    expect(await check()).toMatchObject({ resolved: 1 });
    expect((await alertsFor(codes.id)).at(-1)).toEqual({
      kind: 'problem',
      title: 'Back to normal: Sign-in codes verified',
      body: 'Now 100% over the last 15 minutes.',
    });
    expect(slack).toHaveLength(2);
    expect(email.outbox).toHaveLength(4);

    // Changing a rule judges it afresh.
    const changed = await call('POST', `/admin/alert-rules/${players.id}`, owner, { threshold: 70 });
    expect(changed.json()).toMatchObject({ threshold: 70, firing_since: null, last_value: null });
  });
});
