/**
 * Home banners and events (build plan step 2.7h): LiveOps schedules them in the console, apps
 * get the running ones with their config, and Weekend Wahala doubles duel XP.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminLiveEvent,
  AdminLiveEventsResponse,
  AdminRole,
  ClientConfig,
  CreateDuelResponse,
  DuelAnswerResponse,
  DuelView,
  ServedQuestion,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';

const HOUR = 3_600_000;
// A month no other test file plays in: Friday 10 March 2028, 10:00 WAT.
const NOW = Date.UTC(2028, 2, 10, 9, 0);
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = NOW;
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(async () => {
  await t.pool.query("DELETE FROM live_events WHERE starts_at >= '2028-03-01' AND starts_at < '2028-04-01'");
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `events-${randomInt(1e9)}@whosabi.ng`,
    'Bisi LiveOps',
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

const post = (token: string, url: string, payload: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(token), payload });
const config = async (platform: 'android' | 'web') =>
  (
    await t.app.inject({ method: 'GET', url: '/v1/config', headers: { 'x-platform': platform } })
  ).json() as ClientConfig;

describe('Home banners and events (step 2.7h)', () => {
  it('LiveOps schedules them; apps see the running ones for their platform; ending one takes it off', async () => {
    const liveops = await staff(['liveops']);
    const support = await staff(['support']);
    const banner = {
      kind: 'banner',
      title_en: 'Owambe Starter Pack is here',
      title_pcm: 'Owambe Starter Pack don land',
      body_en: 'Play it before Sunday.',
      action: 'random',
      starts_at: at(-1),
      ends_at: at(48),
      reason: 'Flash pack week',
    };
    expect((await post(support, '/admin/events', banner)).statusCode).toBe(403);
    expect((await post(liveops, '/admin/events', { ...banner, ends_at: at(-2) })).statusCode).toBe(400);
    expect((await post(liveops, '/admin/events', { ...banner, category_id: 'music' })).statusCode).toBe(400);
    expect((await post(liveops, '/admin/events', { ...banner, reason: '' })).statusCode).toBe(400);

    const shown = (await post(liveops, '/admin/events', banner)).json() as AdminLiveEvent;
    expect(shown).toMatchObject({
      kind: 'banner',
      state: 'live',
      action: 'random',
      created_by: 'Bisi LiveOps',
    });
    const later = (
      await post(liveops, '/admin/events', {
        kind: 'double_xp',
        title_en: 'Weekend Wahala: double XP on Music',
        category_id: 'music',
        platforms: ['android'],
        starts_at: at(2),
        ends_at: at(50),
        reason: 'Weekend Wahala',
      })
    ).json() as AdminLiveEvent;
    expect(later.state).toBe('scheduled');

    expect((await config('web')).home.map((b) => b.id)).toEqual([shown.id]);
    t.clock.t = NOW + 2 * HOUR + 11_000; // past the start and the 10-second cache
    expect((await config('android')).home.map((b) => b.id)).toEqual([later.id, shown.id]);
    expect((await config('android')).home[0]).toMatchObject({ kind: 'double_xp', category_id: 'music' });
    // Android only.
    expect((await config('web')).home.map((b) => b.id)).toEqual([shown.id]);

    const ended = (await post(liveops, `/admin/events/${shown.id}/end`, { reason: 'Pack pulled' })).json();
    expect(ended).toMatchObject({ state: 'ended' });
    expect((await post(liveops, `/admin/events/${shown.id}/end`, { reason: 'Again' })).statusCode).toBe(409);
    expect((await config('web')).home).toEqual([]);

    const list = (
      await t.app.inject({ method: 'GET', url: '/admin/events', headers: bearer(liveops) })
    ).json() as AdminLiveEventsResponse;
    expect(list.events.find((e) => e.id === later.id)?.state).toBe('live');
    expect(list.events.find((e) => e.id === shown.id)?.state).toBe('ended');
    const audit = await t.pool.query(
      "SELECT action, reason FROM admin_audit_log WHERE entity = 'live_event' AND entity_id = $1 ORDER BY id",
      [String(shown.id)],
    );
    expect(audit.rows).toEqual([
      { action: 'schedule_event', reason: 'Flash pack week' },
      { action: 'end_event', reason: 'Pack pulled' },
    ]);
    await post(liveops, `/admin/events/${later.id}/end`, { reason: 'Done testing' });
    t.clock.t = NOW;
  });

  it('Weekend Wahala doubles the XP for answers in its category', async () => {
    const liveops = await staff(['liveops']);
    t.clock.t = NOW + 100 * HOUR;
    const event = (
      await post(liveops, '/admin/events', {
        kind: 'double_xp',
        title_en: 'Weekend Wahala: double XP on everything',
        starts_at: new Date(t.clock.t - HOUR).toISOString(),
        ends_at: new Date(t.clock.t + 48 * HOUR).toISOString(),
        reason: 'Launch weekend',
      })
    ).json() as AdminLiveEvent;

    const [a, b] = [await signInGuest(t.app, 'android'), await signInGuest(t.app, 'android')];
    const players = [
      { id: a.user.id, access: a.access },
      { id: b.user.id, access: b.access },
    ];
    await befriend(t.pool, players[0]!.id, players[1]!.id);
    const created = await post(players[0]!.access, '/v1/duels', { opponent: { user_id: players[1]!.id } });
    const id = (created.json() as CreateDuelResponse).duel.id;
    for (let turns = 0; turns < 6; turns++) {
      await playTurn(players[0]!.access, id, 'right');
      await playTurn(players[1]!.access, id, 'wrong');
    }
    const view = (
      await t.app.inject({ method: 'GET', url: `/v1/duels/${id}`, headers: bearer(players[0]!.access) })
    ).json() as DuelView;
    expect(view.state).toBe('complete');
    // 9 right answers: (9 × 10) × 2 + 50; 9 wrong ones: (9 × 2) × 2 + 50.
    expect(view.reward).toEqual({ coins: 30, xp: 230 });
    const loser = (
      await t.app.inject({ method: 'GET', url: `/v1/duels/${id}`, headers: bearer(players[1]!.access) })
    ).json() as DuelView;
    expect(loser.reward?.xp).toBe(86);
    await post(liveops, `/admin/events/${event.id}/end`, { reason: 'Done testing' });
    t.clock.t = NOW;
  });
});

async function playTurn(access: string, duelId: string, mode: 'right' | 'wrong'): Promise<void> {
  const get = async () =>
    (
      (
        await t.app.inject({ method: 'GET', url: `/v1/duels/${duelId}`, headers: bearer(access) })
      ).json() as DuelView
    ).next;
  let next = await get();
  while (next && (next.action === 'pick_category' || next.action === 'play')) {
    if (next.action === 'pick_category') {
      const res = await post(access, `/v1/duels/${duelId}/rounds/${next.round}/category`, {
        category_id: next.offered[0],
      });
      next = (res.json() as DuelView).next;
      continue;
    }
    const served = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/duels/${duelId}/rounds/${next.round}/questions/${next.seq}/serve`,
        headers: bearer(access),
      })
    ).json() as ServedQuestion;
    const row = (
      await t.pool.query<{ options: string[]; correct_index: number }>(
        'SELECT options, correct_index FROM questions WHERE id = $1',
        [served.qid],
      )
    ).rows[0]!;
    const right = served.options.indexOf(row.options[row.correct_index]!);
    t.clock.advance(3000);
    const res = await post(access, `/v1/duels/${duelId}/rounds/${next.round}/questions/${next.seq}/answer`, {
      display_index: mode === 'right' ? right : (right + 1) % served.options.length,
      client_elapsed_ms: 2800,
    });
    expect(res.statusCode, res.body).toBe(200);
    next = (res.json() as DuelAnswerResponse).next;
  }
}
