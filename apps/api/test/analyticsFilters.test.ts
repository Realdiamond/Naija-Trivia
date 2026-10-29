/**
 * The dashboards' app version and segment filters (build plan step 2.7q): Engagement, Growth,
 * Retention, Funnels and Tech health narrowed to one version of the app or a saved segment's
 * players; the other dashboards show everyone. Early February 2029, which no other file plays in.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type { EngagementBoard, FunnelsBoard, GrowthBoard, RetentionBoard } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const feb = (day: number, hour: number) => Date.UTC(2029, 1, day, hour - 1);
const RANGE = 'from=2029-02-05&to=2029-02-08';

let t: Awaited<ReturnType<typeof createTestApp>>;
let analyst: string;
let segment: string;
const made = { users: [] as string[], pids: [] as string[] };
/** Katsina: A on 1.2.0 and B on 1.1.0. Ogun: C on 1.2.0. */
let a: string;
let b: string;
let c: string;

async function event(user: string, name: string, at: number, version: string) {
  await t.pool.query(
    `INSERT INTO analytics_events (event_id, event, source, ts, user_pid, session_id, platform, app_version, props)
     VALUES ($1, $2, 'client', $3, $4, $5, 'android', $6, '{}')`,
    [
      `e_${randomUUID()}`,
      name,
      new Date(at),
      pseudonymousId(user, t.config.analyticsKey),
      randomUUID(),
      version,
    ],
  );
}

beforeAll(async () => {
  t = await createTestApp();
  const sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `filters-${randomInt(1e9)}@whosabi.ng`,
    'Analyst',
  ]);
  await t.pool.query(
    "INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, 'analyst', $2)",
    [id, SYSTEM_ADMIN_ID],
  );
  analyst = (await sessions.create(id)).token;

  t.clock.t = feb(5, 10);
  [a, b, c] = [
    (await signInGuest(t.app, 'android')).user.id,
    (await signInGuest(t.app, 'android')).user.id,
    (await signInGuest(t.app, 'android')).user.id,
  ];
  made.users.push(a, b, c);
  await t.pool.query("UPDATE users SET home_state = 'KT' WHERE id = ANY($1)", [[a, b]]);
  await t.pool.query("UPDATE users SET home_state = 'OG' WHERE id = $1", [c]);
  segment = newId('sg');
  await t.pool.query(
    `INSERT INTO segments (id, name, definition, created_by, created_at) VALUES ($1, 'Katsina', $2, $3, $4)`,
    [segment, JSON.stringify({ rules: [{ field: 'home_state', in: ['KT'] }] }), id, new Date(feb(5, 10))],
  );
  // Everyone plays on the 5th; A and C come back the next day on 1.2.0, B doesn't.
  for (const [user, version] of [
    [a, '1.2.0'],
    [b, '1.1.0'],
    [c, '1.2.0'],
  ] as const) {
    await event(user, 'session_started', feb(5, 11), version);
    await event(user, 'daily_started', feb(5, 11), version);
  }
  await event(a, 'session_started', feb(6, 11), '1.2.0');
  await event(c, 'session_started', feb(6, 11), '1.2.0');
  await event(a, 'daily_completed', feb(5, 12), '1.2.0');
  t.clock.t = feb(9, 10);
});

afterAll(async () => {
  await t.pool.query('DELETE FROM segments WHERE id = $1', [segment]);
  await t.pool.query('DELETE FROM analytics_events WHERE user_pid = ANY($1)', [
    made.users.map((u) => pseudonymousId(u, t.config.analyticsKey)),
  ]);
  await t.close();
});

async function board<T>(name: string, extra = ''): Promise<T> {
  const res = await t.app.inject({
    method: 'GET',
    url: `/admin/analytics/${name}?${RANGE}${extra}`,
    headers: bearer(analyst),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
}

describe('dashboard filters (step 2.7q)', () => {
  it('narrows Engagement to an app version or a segment, and says so', async () => {
    const everyone = await board<EngagementBoard>('engagement');
    expect(everyone.days.find((d) => d.day === '2029-02-05')?.dau).toBe(3);
    expect(everyone).toMatchObject({ version: null, segment: null });

    const onNew = await board<EngagementBoard>('engagement', '&version=1.2.0');
    expect(onNew.days.find((d) => d.day === '2029-02-05')?.dau).toBe(2);
    expect(onNew.version).toBe('1.2.0');

    const katsina = await board<EngagementBoard>('engagement', `&segment=${segment}`);
    expect(katsina.days.find((d) => d.day === '2029-02-05')?.dau).toBe(2);
    expect(katsina.days.find((d) => d.day === '2029-02-06')?.dau).toBe(1);
    expect(katsina.segment).toEqual({ id: segment, name: 'Katsina', players: 2 });

    const both = await board<EngagementBoard>('engagement', `&segment=${segment}&version=1.2.0`);
    expect(both.days.find((d) => d.day === '2029-02-05')?.dau).toBe(1);
  });

  it('narrows new players, retention and funnels to the segment', async () => {
    const growth = await board<GrowthBoard>('growth', `&segment=${segment}`);
    expect(growth.summary.new_players).toBe(2);
    const retention = await board<RetentionBoard>('retention', `&segment=${segment}`);
    expect(retention.cohorts.reduce((n, cohort) => n + cohort.players, 0)).toBe(2);
    const funnel = await board<FunnelsBoard>(
      'funnels',
      `&segment=${segment}&funnel=custom&steps=daily_started,daily_completed`,
    );
    expect(funnel.steps.map((s) => s.players)).toEqual([2, 1]);
  });

  it("refuses a segment that doesn't exist, and leaves other dashboards as they are", async () => {
    const missing = await t.app.inject({
      method: 'GET',
      url: `/admin/analytics/engagement?${RANGE}&segment=${newId('sg')}`,
      headers: bearer(analyst),
    });
    expect(missing.statusCode).toBe(404);
    const gameplay = await board<{ version?: unknown; segment?: unknown }>('gameplay', `&segment=${segment}`);
    expect(gameplay.version).toBeUndefined();
    expect(gameplay.segment).toBeUndefined();
    const bad = await t.app.inject({
      method: 'GET',
      url: `/admin/analytics/engagement?${RANGE}&version=${encodeURIComponent("1.0'; DROP")}`,
      headers: bearer(analyst),
    });
    expect(bad.statusCode).toBe(400);
  });
});
