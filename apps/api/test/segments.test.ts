/**
 * Segments (build plan step 2.7o): a group of players from who they are and what they do, its
 * size and trend, and exports of pseudonymous ids that a second person approves.
 * The clock is March 2029, so "joined in the last 2 days" holds only this file's players.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  AdminRole,
  AdminSegmentExport,
  AdminSegmentsResponse,
  SegmentRule,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { countSegments } from '../src/admin/segments';
import { AdminSessions } from '../src/admin/sessions';
import { withTransaction } from '../src/db';
import { grantCoins } from '../src/economy/ledger';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const HOUR = 3_600_000;
/** 2 March 2029 at a WAT hour; the players join on the 1st. */
const march = (day: number, hour: number) => Date.UTC(2029, 2, day, hour - 1);

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
const made = { users: [] as string[], duels: [] as string[], segments: [] as string[] };
let a: string;
let b: string;
let c: string;

beforeAll(async () => {
  t = await createTestApp();
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  // A: Lagos, Android, signed up, level 7, a 4-day streak, 6 duels this week, 500 coins, a purchase.
  // B: Lagos, web, a guest. C: Kano, Android, signed up, 2 duels.
  // Everyone's duel opponent joined long before, so no segment of new players holds them.
  t.clock.t = Date.UTC(2029, 0, 15, 9);
  const opponent = (await signInGuest(t.app, 'android')).user.id;
  t.clock.t = march(1, 10);
  a = (await signInGuest(t.app, 'android')).user.id;
  b = (await signInGuest(t.app, 'web')).user.id;
  c = (await signInGuest(t.app, 'android')).user.id;
  made.users.push(a, b, c, opponent);
  await t.pool.query(
    "UPDATE users SET status = 'active', home_state = 'LA', age_band = '18_plus', level = 7 WHERE id = $1",
    [a],
  );
  await t.pool.query("UPDATE users SET home_state = 'LA', age_band = '18_plus' WHERE id = $1", [b]);
  await t.pool.query(
    "UPDATE users SET status = 'active', home_state = 'KN', age_band = '13_17' WHERE id = $1",
    [c],
  );
  await t.pool.query('INSERT INTO streaks (user_id, current, best) VALUES ($1, 4, 4)', [a]);
  for (const [player, duels] of [
    [a, 6],
    [c, 2],
  ] as const) {
    for (let i = 0; i < duels; i++) {
      const id = newId('d');
      made.duels.push(id);
      await t.pool.query(
        `INSERT INTO duels (id, player_a, player_b, source, state, created_at, completed_at)
         VALUES ($1, $2, $3, 'friend', 'complete', $4, $4)`,
        [id, player, opponent, new Date(march(1, 11))],
      );
    }
  }
  await withTransaction(t.pool, (client) =>
    grantCoins(client, a, 500, { key: `seg-${randomUUID()}`, reason: 'daily', now: march(1, 12) }),
  );
  await t.pool.query(
    `INSERT INTO purchases (id, user_id, store, product_id, store_tx_id, price_micros, currency, status, coins, created_at)
     VALUES ($1, $2, 'play', 'coins_small', $3, 300000000, 'NGN', 'completed', 500, $4)`,
    [newId('pu'), a, `GPA.${randomUUID()}`, new Date(march(1, 12))],
  );
  t.clock.t = march(2, 10);
});
afterAll(async () => {
  await t.pool.query('DELETE FROM segments WHERE id = ANY($1)', [made.segments]);
  await t.pool.query('DELETE FROM duels WHERE id = ANY($1)', [made.duels]);
  await t.pool.query('DELETE FROM purchases WHERE user_id = ANY($1)', [made.users]);
  const txs = (
    await t.pool.query<{ transaction_id: string }>(
      `SELECT DISTINCT e.transaction_id FROM ledger_entries e JOIN ledger_accounts l ON l.id = e.account_id
        WHERE l.owner_user_id = ANY($1)`,
      [made.users],
    )
  ).rows.map((r) => r.transaction_id);
  await t.pool.query('DELETE FROM ledger_entries WHERE transaction_id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_transactions WHERE id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_accounts WHERE owner_user_id = ANY($1)', [made.users]);
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `segments-${randomInt(1e9)}@whosabi.ng`,
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

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

/** Only this file's players: those who joined in the last 2 days of March 2029. */
const NEW: SegmentRule = { field: 'joined_within_days', days: 2 };

describe('segments (step 2.7o)', () => {
  it('counts players by who they are and what they do', async () => {
    const analyst = await staff(['analyst']);
    const count = async (...rules: SegmentRule[]) => {
      const res = await call('POST', '/admin/segments/count', analyst, {
        definition: { rules: [NEW, ...rules] },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { players: number }).players;
    };
    expect(await count()).toBe(3);
    expect(await count({ field: 'home_state', in: ['LA'] })).toBe(2);
    expect(await count({ field: 'home_state', in: ['LA'] }, { field: 'platform', in: ['android'] })).toBe(1);
    expect(await count({ field: 'age_band', in: ['13_17'] })).toBe(1);
    expect(await count({ field: 'account', is: 'guest' })).toBe(1);
    expect(await count({ field: 'account', is: 'signed_up' })).toBe(2);
    expect(await count({ field: 'duels_finished', min: 5, within_days: 7 })).toBe(1);
    expect(await count({ field: 'duels_finished', min: 2, within_days: 7 })).toBe(2);
    expect(await count({ field: 'purchased', ever: true })).toBe(1);
    expect(await count({ field: 'purchased', ever: false })).toBe(2);
    expect(await count({ field: 'coins_at_least', n: 100 })).toBe(1);
    expect(await count({ field: 'level_at_least', n: 5 })).toBe(1);
    expect(await count({ field: 'streak_at_least', n: 3 })).toBe(1);
    expect(await count({ field: 'active_within_days', days: 2 })).toBe(3);
    expect(await count({ field: 'inactive_for_days', days: 2 })).toBe(0);

    // A rule that doesn't exist, or none at all, is refused.
    for (const definition of [{ rules: [] }, { rules: [{ field: 'username', in: ['x'] }] }]) {
      expect((await call('POST', '/admin/segments/count', analyst, { definition })).statusCode).toBe(400);
    }
    expect(
      (
        await call('POST', '/admin/segments/count', await staff(['support']), {
          definition: { rules: [NEW] },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('saves a segment with its size, counts it each day and deletes it, audited', async () => {
    const growth = await staff(['growth']);
    const saved = await call('POST', '/admin/segments', growth, {
      name: 'New in Lagos',
      definition: { rules: [NEW, { field: 'home_state', in: ['LA'] }] },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const { id, players } = saved.json() as { id: string; players: number };
    made.segments.push(id);
    expect(players).toBe(2);

    // The next night (after 02:00 WAT) it is counted again, once.
    t.clock.t = march(3, 3);
    expect(await countSegments({ pool: t.pool, redis: t.redis, clock: t.clock })).toBeGreaterThanOrEqual(1);
    expect(await countSegments({ pool: t.pool, redis: t.redis, clock: t.clock })).toBeNull();
    const listed = (await call('GET', '/admin/segments', growth)).json() as AdminSegmentsResponse;
    const mine = listed.segments.find((s) => s.id === id)!;
    expect(mine).toMatchObject({ name: 'New in Lagos', created_by: 'growth', last_count: 2 });
    // "Joined in the last 2 days" from the 3rd at 03:00 still holds both.
    expect(mine.trend).toEqual([
      { day: '2029-03-02', players: 2 },
      { day: '2029-03-03', players: 2 },
    ]);

    expect((await call('DELETE', `/admin/segments/${id}`, growth)).statusCode).toBe(204);
    expect((await call('DELETE', `/admin/segments/${id}`, growth)).statusCode).toBe(404);
    const audit = await t.pool.query<{ action: string }>(
      "SELECT action FROM admin_audit_log WHERE entity = 'segment' AND entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create_segment', 'delete_segment']);
    t.clock.t = march(2, 10);
  });

  it('exports pseudonymous ids only after someone else approves, for a day, to the one who asked', async () => {
    const analyst = await staff(['analyst']);
    const admin = await staff(['admin']);
    const otherAdmin = await staff(['admin']);
    const { id } = (
      await call('POST', '/admin/segments', analyst, {
        name: 'Lagos players',
        definition: { rules: [NEW, { field: 'home_state', in: ['LA'] }] },
      })
    ).json() as { id: string };
    made.segments.push(id);

    expect(
      (await call('POST', `/admin/segments/${id}/exports`, analyst, { reason: 'short' })).statusCode,
    ).toBe(400);
    const asked = await call('POST', `/admin/segments/${id}/exports`, analyst, {
      reason: 'Survey invitations for Lagos players',
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const pending = asked.json() as AdminSegmentExport;
    expect(pending).toMatchObject({
      status: 'pending',
      segment_name: 'Lagos players',
      expires_at: null,
      yours: true,
    });
    const download = (token: string) => call('GET', `/admin/segment-exports/${pending.id}/download`, token);
    expect((await download(analyst)).statusCode).toBe(403);

    // Analysts can't approve; nobody approves their own.
    const decide = (token: string, approve: boolean) =>
      call('POST', `/admin/segment-exports/${pending.id}/decision`, token, { approve });
    expect((await decide(analyst, true)).statusCode).toBe(403);
    const own = (
      await call('POST', `/admin/segments/${id}/exports`, admin, { reason: 'My own export, to check' })
    ).json() as AdminSegmentExport;
    expect(
      (await call('POST', `/admin/segment-exports/${own.id}/decision`, admin, { approve: true })).statusCode,
    ).toBe(403);
    const turnedDown = await call('POST', `/admin/segment-exports/${own.id}/decision`, otherAdmin, {
      approve: false,
    });
    expect(turnedDown.json()).toMatchObject({ status: 'rejected' });
    expect((await call('GET', `/admin/segment-exports/${own.id}/download`, admin)).statusCode).toBe(403);

    const approved = await decide(admin, true);
    expect(approved.json()).toMatchObject({
      status: 'approved',
      decided_by: 'admin',
      expires_at: new Date(march(2, 10) + 24 * HOUR).toISOString(),
    });
    expect((await decide(otherAdmin, true)).statusCode).toBe(409);
    const listed = (await call('GET', '/admin/segments', admin)).json() as AdminSegmentsResponse;
    expect(listed.exports.map((e) => e.id)).toEqual(expect.arrayContaining([pending.id, own.id]));
    expect(listed.exports.find((e) => e.id === pending.id)?.yours).toBe(false);
    expect(listed.exports.find((e) => e.id === own.id)?.yours).toBe(true);

    // Only the one who asked downloads it: pseudonymous ids, never user ids.
    expect((await download(admin)).statusCode).toBe(403);
    const csv = await download(analyst);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.headers['content-disposition']).toBe(`attachment; filename="whosabi-segment-${id}.csv"`);
    const lines = csv.body.trim().split('\n');
    expect(lines[0]).toBe('player,platform,home_state,age_band');
    expect(lines.slice(1).sort()).toEqual(
      [
        `${pseudonymousId(a, t.config.analyticsKey)},android,LA,18_plus`,
        `${pseudonymousId(b, t.config.analyticsKey)},web,LA,18_plus`,
      ].sort(),
    );
    expect(csv.body).not.toContain(a);
    const audit = await t.pool.query<{ action: string }>(
      "SELECT action FROM admin_audit_log WHERE entity = 'segment' AND entity_id = $1 ORDER BY id",
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'create_segment',
      'request_segment_export',
      'request_segment_export',
      'reject_segment_export',
      'approve_segment_export',
      'download_segment_export',
    ]);

    // A day later it has expired.
    t.clock.advance(25 * HOUR);
    expect((await download(analyst)).statusCode).toBe(403);
    t.clock.t = march(2, 10);
  });
});
