import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TUNABLE } from '@whosabi/game-rules';
import type { AdminConfigHistory, AdminConfigResponse, AdminRole, ClientConfig } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { LiveOpsStore } from '../src/liveops/store';
import { bearer, createTestApp, signInGuest } from './helpers';

const KEYS = TUNABLE.map((t) => t.key);

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
afterAll(async () => {
  // Values are shared by every test file: leave the defaults in force.
  await t.pool.query('DELETE FROM app_config WHERE key = ANY($1)', [KEYS]);
  await t.pool.query('DELETE FROM config_history WHERE key = ANY($1)', [KEYS]);
  await t.close();
});

async function staff(roles: AdminRole[], name = roles.join('+')): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `config-${randomInt(1e9)}@whosabi.ng`,
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
const valueOf = (res: AdminConfigResponse, key: string) => res.values.find((v) => v.key === key)!;

describe('game and economy values (step 2.7g)', () => {
  it('lists the values staff may change, all at their defaults, for LiveOps, admins and owners', async () => {
    const liveops = await staff(['liveops']);
    const engineer = await staff(['engineer']);
    expect((await get(engineer, '/admin/config')).statusCode).toBe(403);
    const list = (await get(liveops, '/admin/config')).json() as AdminConfigResponse;
    expect(list.values.map((v) => v.key)).toEqual(KEYS);
    for (const v of list.values) expect(v).toMatchObject({ value: v.default, changed_by: null });
    expect(valueOf(list, 'econ.win_coins')).toMatchObject({ label: 'Coins for winning a duel', default: 30 });
  });

  it('changes a value with a reason: the game pays it at once and apps get it, with its history', async () => {
    const liveops = await staff(['liveops'], 'Bisi LiveOps');
    const player = await signInGuest(t.app);
    const rewarded = async () =>
      (await t.app.inject({ method: 'GET', url: '/v1/ads/rewarded', headers: bearer(player.access) })).json();
    expect(await rewarded()).toEqual({ coins: 25, left_today: 10 });

    const url = '/admin/config/econ.rewarded_ad_coins';
    expect((await post(liveops, url, { value: 40 })).statusCode).toBe(400);
    expect((await post(liveops, url, { value: 999, reason: 'Too much' })).statusCode).toBe(400);
    expect(
      (await post(liveops, '/admin/config/score.speed_max', { value: 50, reason: 'Not tunable' })).statusCode,
    ).toBe(404);
    expect((await post(liveops, url, { value: 25, reason: 'Same' })).statusCode).toBe(409);

    const changed = (
      await post(liveops, url, { value: 40, reason: 'Weekend promo' })
    ).json() as AdminConfigResponse;
    expect(valueOf(changed, 'econ.rewarded_ad_coins')).toMatchObject({
      value: 40,
      changed_by: 'Bisi LiveOps',
    });
    await post(liveops, '/admin/config/ads.rewarded_daily_cap', { value: 3, reason: 'Fewer paid ads' });
    expect(await rewarded()).toEqual({ coins: 40, left_today: 3 });
    const forApps = (await t.app.inject({ method: 'GET', url: '/v1/config' })).json() as ClientConfig;
    expect(forApps.values['econ.rewarded_ad_coins']).toBe(40);
    expect(forApps.values['ads.rewarded_daily_cap']).toBeUndefined(); // the server's business only

    // Another API process (or the worker) catches up within its 10-second cache.
    const other = new LiveOpsStore(t.pool, t.clock.now);
    expect((await other.values())['econ.rewarded_ad_coins']).toBe(40);
    await post(liveops, url, { value: 50, reason: 'More promo' });
    expect((await other.values())['econ.rewarded_ad_coins']).toBe(40);
    t.clock.t += 10_000;
    expect((await other.values())['econ.rewarded_ad_coins']).toBe(50);

    // One click back to the value before the latest change.
    const back = (
      await post(liveops, `${url}/rollback`, { reason: 'Promo over' })
    ).json() as AdminConfigResponse;
    expect(valueOf(back, 'econ.rewarded_ad_coins').value).toBe(40);
    const history = (await get(liveops, `${url}/history`)).json() as AdminConfigHistory;
    expect(history.entries.map((e) => [e.old_value, e.new_value, e.reason])).toEqual([
      [50, 40, 'Promo over'],
      [40, 50, 'More promo'],
      [null, 40, 'Weekend promo'],
    ]);
    const audit = await t.pool.query(
      "SELECT action FROM admin_audit_log WHERE entity = 'config' AND entity_id = 'econ.rewarded_ad_coins' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['change_config', 'change_config', 'rollback_config']);
    expect(
      (await post(liveops, '/admin/config/econ.win_coins/rollback', { reason: 'Never changed' })).statusCode,
    ).toBe(409);
  });

  it('ignores a stored value out of bounds and keeps the default', async () => {
    await t.pool.query(
      `INSERT INTO app_config (key, value) VALUES ('econ.level_up_coins', '99999')
       ON CONFLICT (key) DO UPDATE SET value = '99999'`,
    );
    const store = new LiveOpsStore(t.pool, t.clock.now);
    expect((await store.values())['econ.level_up_coins']).toBe(DEFAULT_CONFIG['econ.level_up_coins']);
  });
});
