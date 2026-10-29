import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminBannerResponse,
  AdminFlag,
  AdminFlagsResponse,
  AdminRole,
  ClientConfig,
  CreatePartyResponse,
  ShopResponse,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { LiveOpsStore } from '../src/liveops/store';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
let categories: string[];
beforeAll(async () => {
  t = await createTestApp();
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  categories = (await t.pool.query<{ id: string }>('SELECT id FROM categories WHERE active')).rows.map(
    (r) => r.id,
  );
});
afterAll(async () => {
  // Flags and the banner are shared by every test file: leave them as the migration made them.
  await t.pool.query(
    "UPDATE feature_flags SET enabled = true, rules = '[]' WHERE key IN ('ads.enabled', 'shop.enabled', 'party.enabled')",
  );
  await t.pool.query("DELETE FROM app_config WHERE key = 'status_banner'");
  await t.pool.query("DELETE FROM staff_alerts WHERE url = '/liveops'");
  await t.close();
});

async function staff(roles: AdminRole[], name = roles.join('+')): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `liveops-${randomInt(1e9)}@whosabi.ng`,
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
const config = async (headers: Record<string, string> = {}) =>
  (await t.app.inject({ method: 'GET', url: '/v1/config', headers })).json() as ClientConfig;
const setFlag = (token: string, key: string, enabled: boolean, rules: object[] = [], reason = 'Testing') =>
  post(token, `/admin/flags/${key}`, { enabled, rules, reason });

describe('flags and kill switches (step 2.7c)', () => {
  it('tells every app the kill switches, signed in or not', async () => {
    const anyone = await config();
    expect(anyone).toEqual({
      flags: { 'ads.enabled': true, 'party.enabled': true, 'shop.enabled': true },
      banner: null,
      refresh_s: 45,
    });
  });

  it('switches party rooms off: no new rooms or seats, the change logged and announced', async () => {
    const engineer = await staff(['engineer'], 'Kemi on call');
    const host = await signInGuest(t.app);
    const create = () =>
      t.app.inject({
        method: 'POST',
        url: '/v1/party/rooms',
        headers: bearer(host.access),
        payload: {
          settings: {
            questions: 5,
            timer_s: 10,
            family_safe: false,
            wahala: true,
            host_plays: true,
            categories,
          },
          nickname: 'Tolu',
        },
      });
    const before = await create();
    expect(before.statusCode).toBe(201);
    const { room } = before.json() as CreatePartyResponse;

    expect(
      (await post(engineer, '/admin/flags/party.enabled', { enabled: false, rules: [] })).statusCode,
    ).toBe(400);
    const off = await setFlag(
      engineer,
      'party.enabled',
      false,
      [],
      'Rooms dropping players, looking into it',
    );
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({
      key: 'party.enabled',
      enabled: false,
      kill_switch: true,
      updated_by: 'Kemi on call',
    });

    const refused = await create();
    expect([refused.statusCode, refused.json().code]).toEqual([503, 'FEATURE_OFF']);
    expect(refused.json().detail).toContain('Duels and the Daily still work');
    const join = await t.app.inject({
      method: 'POST',
      url: `/v1/party/rooms/${room.code}/join`,
      payload: { nickname: 'Ada' },
    });
    expect(join.statusCode).toBe(503);
    expect((await config({ authorization: `Bearer ${host.access}` })).flags['party.enabled']).toBe(false);

    const audit = await t.pool.query(
      "SELECT reason, before, after FROM admin_audit_log WHERE action = 'change_flag' AND entity_id = 'party.enabled'",
    );
    expect(audit.rows).toEqual([
      {
        reason: 'Rooms dropping players, looking into it',
        before: { enabled: true, rules: [] },
        after: { enabled: false, rules: [] },
      },
    ]);
    const alert = await t.pool.query("SELECT title, body FROM staff_alerts WHERE url = '/liveops'");
    expect(alert.rows).toEqual([
      {
        title: 'Switched off: Party rooms: starting and joining new ones',
        body: 'Kemi on call: Rooms dropping players, looking into it',
      },
    ]);

    expect((await setFlag(engineer, 'party.enabled', true)).statusCode).toBe(200);
    expect((await create()).statusCode).toBe(201);
  });

  it('reaches other API processes within their 10-second cache', async () => {
    const liveops = await staff(['liveops']);
    const other = new LiveOpsStore(t.pool, t.clock.now);
    expect(await other.isOn('shop.enabled', {})).toBe(true);
    await setFlag(liveops, 'shop.enabled', false);
    expect(await other.isOn('shop.enabled', {})).toBe(true);
    t.clock.t += 10_000;
    expect(await other.isOn('shop.enabled', {})).toBe(false);
    const shop = (await t.app.inject({ method: 'GET', url: '/v1/shop' })).json() as ShopResponse;
    expect(shop.packs).toEqual([]);
    await setFlag(liveops, 'shop.enabled', true);
    expect(
      ((await t.app.inject({ method: 'GET', url: '/v1/shop' })).json() as ShopResponse).packs.length,
    ).toBe(4);
  });

  it('rolls a flag out by platform, app version and share of players', async () => {
    const admin = await staff(['admin']);
    await setFlag(admin, 'ads.enabled', true, [{ platform: 'android', min_app_version: '1.2.0' }]);
    expect((await config({ 'x-platform': 'android', 'x-app-version': '1.2.3' })).flags['ads.enabled']).toBe(
      true,
    );
    expect((await config({ 'x-platform': 'android', 'x-app-version': '1.1.0' })).flags['ads.enabled']).toBe(
      false,
    );
    expect((await config({ 'x-platform': 'web', 'x-app-version': '1.2.3' })).flags['ads.enabled']).toBe(
      false,
    );

    await setFlag(admin, 'ads.enabled', true, [{ percent: 50 }]);
    const players = await Promise.all(Array.from({ length: 12 }, () => signInGuest(t.app)));
    const seen = await Promise.all(
      players.map(async (p) => (await config({ authorization: `Bearer ${p.access}` })).flags['ads.enabled']),
    );
    expect(seen).toContain(true);
    expect(seen).toContain(false);
    // The same player gets the same answer every time.
    expect((await config({ authorization: `Bearer ${players[0]!.access}` })).flags['ads.enabled']).toBe(
      seen[0],
    );
    expect((await setFlag(admin, 'ads.enabled', true, [{ percent: 150 }])).statusCode).toBe(400);
    await setFlag(admin, 'ads.enabled', true);
  });

  it('lists the flags for LiveOps, engineers and admins only', async () => {
    const support = await staff(['support']);
    const moderator = await staff(['moderator']);
    const liveops = await staff(['liveops']);
    expect((await get(support, '/admin/flags')).statusCode).toBe(403);
    expect((await setFlag(moderator, 'party.enabled', false)).statusCode).toBe(403);
    const list = (await get(liveops, '/admin/flags')).json() as AdminFlagsResponse;
    expect(list.flags.map((f: AdminFlag) => [f.key, f.kill_switch])).toEqual([
      ['ads.enabled', true],
      ['party.enabled', true],
      ['shop.enabled', true],
    ]);
    expect((await setFlag(liveops, 'no.such.flag', true)).statusCode).toBe(404);
  });
});

describe('the status banner (step 2.7c)', () => {
  it('goes up and comes down with a reason, with its history kept', async () => {
    const liveops = await staff(['liveops'], 'Bisi LiveOps');
    const banner = {
      level: 'warning',
      text_en: 'Party rooms are having issues. Duels still work.',
      text_pcm: 'Party rooms get small wahala. Duels dey work.',
    };
    expect((await post(liveops, '/admin/banner', { banner, reason: 'x' })).statusCode).toBe(400);
    const up = await post(liveops, '/admin/banner', { banner, reason: 'Incident 12' });
    expect(up.json()).toMatchObject({ banner, updated_by: 'Bisi LiveOps' });
    expect((await config()).banner).toEqual(banner);

    const down = await post(liveops, '/admin/banner', { banner: null, reason: 'Fixed' });
    expect((down.json() as AdminBannerResponse).banner).toBeNull();
    expect((await config()).banner).toBeNull();

    const history = await t.pool.query(
      "SELECT old_value, new_value, reason FROM config_history WHERE key = 'status_banner' ORDER BY id",
    );
    expect(history.rows).toEqual([
      { old_value: null, new_value: banner, reason: 'Incident 12' },
      { old_value: banner, new_value: null, reason: 'Fixed' },
    ]);
    const audit = await t.pool.query(
      "SELECT action FROM admin_audit_log WHERE entity = 'config' AND entity_id = 'status_banner' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['set_banner', 'clear_banner']);
    expect((await get(await staff(['support']), '/admin/banner')).statusCode).toBe(403);
  });
});
