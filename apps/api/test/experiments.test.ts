/**
 * Experiments (build plan step 2.7s): LiveOps writes one down, starts it, players in it get their
 * variant with the config (the same one every time), exposures are counted per variant, and it
 * stops. Variants can't change once it has run.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { AdminExperimentsResponse, ClientConfig } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
const key = `test.timer${randomInt(1e6)}`;
const pids: string[] = [];

beforeAll(async () => {
  t = await createTestApp();
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});

afterAll(async () => {
  await t.pool.query('DELETE FROM experiments WHERE key = $1', [key]);
  await t.pool.query('DELETE FROM analytics_events WHERE user_pid = ANY($1)', [pids]);
  await t.close();
});

async function staff(role: string): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `exp-${randomInt(1e9)}@whosabi.ng`,
    `LiveOps ${role}`,
  ]);
  await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
    id,
    role,
    SYSTEM_ADMIN_ID,
  ]);
  return (await sessions.create(id)).token;
}

const draft = {
  key,
  description: 'Duel timer 15 s or 12 s',
  hypothesis: 'A shorter timer makes duels feel faster without hurting completion',
  variants: [
    { key: 'control', weight: 50 },
    { key: 'twelve', weight: 50 },
  ],
  audience: { platforms: ['android'], percent: 100 },
  primary_metric: 'duel_completed',
  guardrails: ['question_reported'],
};

describe('experiments (step 2.7s)', () => {
  it('runs from a draft to stopped, giving players a stable variant and counting exposures', async () => {
    const liveops = await staff('liveops');
    const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
      t.app.inject({ method, url, headers: bearer(liveops), ...(payload ? { payload } : {}) });
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/admin/experiments',
          headers: bearer(await staff('viewer')),
        })
      ).statusCode,
    ).toBe(403);

    const saved = await call('POST', '/admin/experiments', draft);
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json()).toMatchObject({ key, status: 'draft', created_by: 'LiveOps liveops' });
    // A draft can still change.
    expect(
      (await call('POST', '/admin/experiments', { ...draft, description: 'Duel timer: 15 s or 12 s' }))
        .statusCode,
    ).toBe(201);
    // A bad one: one variant, or the same twice.
    expect(
      (await call('POST', '/admin/experiments', { ...draft, variants: [{ key: 'a', weight: 1 }] }))
        .statusCode,
    ).toBe(400);

    const phone = await signInGuest(t.app, 'android');
    const web = await signInGuest(t.app, 'web');
    const configOf = async (access: string) =>
      (
        (
          await t.app.inject({ method: 'GET', url: '/v1/config', headers: bearer(access) })
        ).json() as ClientConfig
      ).experiments;
    expect((await configOf(phone.access))[key]).toBeUndefined();

    const started = await call('POST', `/admin/experiments/${key}`, { action: 'start', reason: 'Two weeks' });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toMatchObject({ status: 'running' });
    const variant = (await configOf(phone.access))[key];
    expect(['control', 'twelve']).toContain(variant);
    expect((await configOf(phone.access))[key]).toBe(variant);
    // Web players aren't in it.
    expect((await configOf(web.access))[key]).toBeUndefined();
    // Running: no changes, and it can't start twice.
    expect((await call('POST', '/admin/experiments', draft)).statusCode).toBe(409);
    expect(
      (await call('POST', `/admin/experiments/${key}`, { action: 'start', reason: 'again' })).statusCode,
    ).toBe(409);

    // The app logs that the variant changed what the player saw.
    const pid = pseudonymousId(phone.user.id, t.config.analyticsKey);
    pids.push(pid);
    for (let i = 0; i < 2; i++) {
      await t.pool.query(
        `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, platform, props)
         VALUES ($1, 'experiment_exposed', 'client', $2, $3, 'android', $4)`,
        [
          `e_${randomUUID()}`,
          new Date(t.clock.now() + 1000),
          pid,
          JSON.stringify({ experiment: key, variant }),
        ],
      );
    }
    const list = (await call('GET', '/admin/experiments')).json() as AdminExperimentsResponse;
    expect(list.experiments.find((e) => e.key === key)?.exposed).toEqual({ [variant!]: 1 });

    const stopped = await call('POST', `/admin/experiments/${key}`, {
      action: 'stop',
      reason: 'Enough data',
    });
    expect(stopped.json()).toMatchObject({ status: 'stopped' });
    expect((await configOf(phone.access))[key]).toBeUndefined();

    const audit = await t.pool.query(
      `SELECT action, reason FROM admin_audit_log WHERE entity = 'experiment' AND entity_id = $1 ORDER BY id`,
      [key],
    );
    expect(audit.rows).toEqual([
      { action: 'save_experiment', reason: null },
      { action: 'save_experiment', reason: null },
      { action: 'start_experiment', reason: 'Two weeks' },
      { action: 'stop_experiment', reason: 'Enough data' },
    ]);
  });
});
