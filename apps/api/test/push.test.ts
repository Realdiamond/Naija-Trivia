/**
 * Push notifications (step 2.5b, TRD §4.8): phones registering, what each move queues, and the
 * push job: quiet hours, the daily cap, collapsing, expiry, dead tokens, retries, language.
 */
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  CreateDuelResponse,
  DailyToday,
  DuelAnswerResponse,
  DuelView,
  ServedQuestion,
} from '@whosabi/shared-types';
import { ServerEvents } from '../src/events';
import { DuelService } from '../src/duels/service';
import { queueDailyReminders } from '../src/jobs/dailyReminder';
import { expireDueDuels } from '../src/jobs/expiry';
import type { JobDeps } from '../src/jobs/deps';
import { renderPush } from '../src/push/messages';
import { sendDuePushes } from '../src/push/dispatch';
import { nextSendTime, queuePush } from '../src/push/queue';
import { FcmTransport, INVALID_TOKEN, PushRejected, type OutgoingPush } from '../src/push/transport';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';
import { givePhone, newPushToken, TestTransport } from './pushHelpers';

const HOUR = 3_600_000;

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
});
afterAll(() => t.close());

/** Each test starts on its own day at this WAT hour, after anything earlier in the file. */
let day = 1;
function startDayAt(watHour: number, minute = 0) {
  t.clock.t = Date.UTC(2027, 0, ++day, watHour - 1, minute, 0);
}

interface Player {
  id: string;
  access: string;
}

async function player(): Promise<Player> {
  const guest = await signInGuest(t.app);
  return { id: guest.user.id, access: guest.access };
}

/** A signed-up player (friends need accounts), with a username. */
async function account(username: string): Promise<Player> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/google',
    payload: { id_token: await t.signGoogle({ sub: `push-${username}` }), platform: 'android' },
  });
  expect(res.statusCode, res.body).toBeLessThan(300);
  const body = res.json() as { access: string; user: { id: string } };
  await t.pool.query('UPDATE users SET username = $2 WHERE id = $1', [body.user.id, username]);
  return { id: body.user.id, access: body.access };
}

async function named(p: Player, username: string, language: 'en' | 'pcm' = 'en') {
  await t.pool.query("UPDATE users SET username = $2, language = $3, status = 'active' WHERE id = $1", [
    p.id,
    username,
    language,
  ]);
}

const req = (p: Player, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(p.access), ...(payload ? { payload } : {}) });

async function waiting(userId: string) {
  return (
    await t.pool.query<{ type: string; params: Record<string, unknown>; collapse_key: string | null }>(
      'SELECT type, params, collapse_key FROM push_outbox WHERE user_id = $1 AND sent_at IS NULL ORDER BY id',
      [userId],
    )
  ).rows;
}

async function outcomes(userId: string) {
  return (
    await t.pool.query<{ type: string; outcome: string | null }>(
      'SELECT type, outcome FROM push_outbox WHERE user_id = $1 ORDER BY id',
      [userId],
    )
  ).rows;
}

async function rightIndex(q: ServedQuestion): Promise<number> {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [q.qid],
    )
  ).rows[0]!;
  return q.options.indexOf(row.options[row.correct_index]!);
}

/** Plays everything the player can do now; returns the duel afterwards. */
async function playTurn(p: Player, duelId: string, mode: 'right' | 'wrong' = 'right'): Promise<void> {
  let next = ((await req(p, 'GET', `/v1/duels/${duelId}`)).json() as DuelView).next;
  while (next && (next.action === 'pick_category' || next.action === 'play')) {
    if (next.action === 'pick_category') {
      const res = await req(p, 'POST', `/v1/duels/${duelId}/rounds/${next.round}/category`, {
        category_id: next.offered[0],
      });
      next = (res.json() as DuelView).next;
      continue;
    }
    const base = `/v1/duels/${duelId}/rounds/${next.round}/questions/${next.seq}`;
    const served = (await req(p, 'POST', `${base}/serve`)).json() as ServedQuestion;
    const right = await rightIndex(served);
    t.clock.advance(3000);
    const res = await req(p, 'POST', `${base}/answer`, {
      display_index: mode === 'right' ? right : (right + 1) % served.options.length,
      client_elapsed_ms: 2800,
    });
    expect(res.statusCode, res.body).toBe(200);
    next = (res.json() as DuelAnswerResponse).next;
  }
}

async function eventsOf(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid)
    .map((row) => ({ event: row.event as string, props: JSON.parse(row.props as string) }));
}

describe('phones', () => {
  it('registers a phone, moves its token to whoever signs in on it, and forgets it', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const token = newPushToken();
    const register = (p: Player) =>
      req(p, 'POST', '/v1/me/devices', { platform: 'android', push_token: token, app_version: '0.1.0' });
    expect((await register(a)).statusCode).toBe(204);
    expect((await register(a)).statusCode).toBe(204); // every start sends it again
    const owner = () =>
      t.pool.query<{ user_id: string }>('SELECT user_id FROM devices WHERE push_token = $1', [token]);
    expect((await owner()).rows).toEqual([{ user_id: a.id }]);

    expect((await register(b)).statusCode).toBe(204);
    expect((await owner()).rows).toEqual([{ user_id: b.id }]);

    // Only the player the token belongs to can forget it.
    expect((await req(a, 'DELETE', '/v1/me/devices', { push_token: token })).statusCode).toBe(204);
    expect((await owner()).rows).toHaveLength(1);
    expect((await req(b, 'DELETE', '/v1/me/devices', { push_token: token })).statusCode).toBe(204);
    expect((await owner()).rows).toHaveLength(0);
  });

  it('keeps a player to their ten newest phones and refuses what is not a token', async () => {
    const p = await player();
    for (let i = 0; i < 12; i++) {
      t.clock.advance(1000);
      expect(
        (await req(p, 'POST', '/v1/me/devices', { platform: 'android', push_token: newPushToken() }))
          .statusCode,
      ).toBe(204);
    }
    const count = await t.pool.query('SELECT 1 FROM devices WHERE user_id = $1 AND push_token IS NOT NULL', [
      p.id,
    ]);
    expect(count.rowCount).toBe(10);

    for (const body of [
      { platform: 'android', push_token: 'short' },
      { platform: 'android', push_token: `bad token ${'x'.repeat(40)}` },
      { platform: 'web', push_token: newPushToken() },
      { platform: 'android', push_token: newPushToken(), extra: 1 },
    ]) {
      expect((await req(p, 'POST', '/v1/me/devices', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await t.app.inject({ method: 'POST', url: '/v1/me/devices', payload: {} })).statusCode).toBe(401);
  });
});

describe('what a duel sends', () => {
  it('tells each player when it is their turn, and the result to whoever did not end it', async () => {
    startDayAt(10);
    const [a, b] = await Promise.all([player(), player()]);
    await named(a, 'tolu_push');
    await named(b, 'ada_push', 'pcm');
    const [phoneA, phoneB] = [await givePhone(t.pool, a.id), await givePhone(t.pool, b.id)];
    await befriend(t.pool, a.id, b.id);
    const { duel } = (
      await req(a, 'POST', '/v1/duels', { opponent: { user_id: b.id } })
    ).json() as CreateDuelResponse;
    expect(await waiting(b.id)).toEqual([]); // nothing until tolu has played

    const transport = new TestTransport();
    await playTurn(a, duel.id, 'right');
    expect(await waiting(b.id)).toEqual([
      {
        type: 'your_turn',
        params: { duel_id: duel.id, kind: 'challenge', opponent: 'tolu_push' },
        collapse_key: `duel:${duel.id}`,
      },
    ]);
    await sendDuePushes(deps, transport);
    expect(transport.to(phoneB)).toEqual([
      expect.objectContaining({
        type: 'your_turn',
        title: 'Tolu_push don challenge you! 🔥',
        url: `/duel/${duel.id}`,
        channel: 'duels',
        collapseKey: `duel:${duel.id}`,
      }),
    ]);
    expect(transport.to(phoneB)[0]!.ttlSeconds).toBeGreaterThan(47 * 3600);

    await playTurn(b, duel.id, 'wrong');
    await sendDuePushes(deps, transport);
    expect(transport.to(phoneA).map((p) => p.title)).toEqual(['Your turn vs ada_push']);

    await playTurn(a, duel.id, 'right');
    await sendDuePushes(deps, transport);
    expect(transport.to(phoneB).map((p) => p.title)).toEqual([
      'Tolu_push don challenge you! 🔥',
      'Tolu_push don play, na your turn! 🔥',
    ]);

    // b plays the last turn: a hears the result, b is already looking at it.
    await playTurn(b, duel.id, 'wrong');
    await sendDuePushes(deps, transport);
    expect(transport.to(phoneA).at(-1)).toMatchObject({
      type: 'duel_result',
      title: 'You beat ada_push! 👑',
      url: `/duel/${duel.id}`,
    });
    expect(transport.to(phoneB)).toHaveLength(2);
    expect((await eventsOf(a.id)).filter((e) => e.event === 'push_sent').map((e) => e.props.type)).toEqual([
      'your_turn',
      'duel_result',
    ]);
  });

  it('sends the tie-break to the player who did not just play', async () => {
    startDayAt(10);
    const [a, b] = await Promise.all([player(), player()]);
    await befriend(t.pool, a.id, b.id);
    const { duel } = (
      await req(a, 'POST', '/v1/duels', { opponent: { user_id: b.id } })
    ).json() as CreateDuelResponse;
    for (const p of [a, b, a, b]) await playTurn(p, duel.id, 'wrong');
    const state = (await t.pool.query('SELECT state FROM duels WHERE id = $1', [duel.id])).rows[0];
    expect(state).toEqual({ state: 'tiebreak' });
    expect((await waiting(a.id)).map((p) => p.params.kind)).toEqual(['tiebreak']);
    expect(await waiting(b.id)).toEqual([]);
  });

  it('tells both players when the time runs out', async () => {
    startDayAt(10);
    const [a, b] = await Promise.all([player(), player()]);
    await befriend(t.pool, a.id, b.id);
    const { duel } = (
      await req(a, 'POST', '/v1/duels', { opponent: { user_id: b.id } })
    ).json() as CreateDuelResponse;
    await playTurn(a, duel.id, 'right');
    t.clock.advance(49 * HOUR); // b never plays
    await expireDueDuels(new DuelService({ ...deps, config: t.config }));
    const results = await t.pool.query<{ user_id: string; params: Record<string, unknown> }>(
      "SELECT user_id, params FROM push_outbox WHERE type = 'duel_result' AND params->>'duel_id' = $1",
      [duel.id],
    );
    expect(results.rows.map((r) => [r.user_id, r.params.result, r.params.forfeit]).sort()).toEqual(
      [
        [a.id, 'win', true],
        [b.id, 'loss', true],
      ].sort(),
    );
    // b's waiting "your turn" was replaced by the result: one message per duel.
    expect((await waiting(b.id)).map((p) => p.type)).toEqual(['duel_result']);
  });
});

describe('what friends send', () => {
  it('tells a player about a friend request, and the asker when it is accepted', async () => {
    const [a, b] = [await account('asker_push'), await account('asked_push')];
    expect((await req(a, 'POST', '/v1/friends/requests', { username: 'asked_push' })).statusCode).toBe(201);
    expect(await waiting(b.id)).toEqual([
      {
        type: 'friend_joined',
        params: { kind: 'request', user_id: a.id, name: 'asker_push' },
        collapse_key: `friend:${a.id}`,
      },
    ]);
    expect((await req(b, 'POST', `/v1/friends/requests/${a.id}/accept`)).statusCode).toBe(200);
    expect((await waiting(a.id)).map((p) => p.params)).toEqual([
      { kind: 'accepted', user_id: b.id, name: 'asked_push' },
    ]);
  });
});

describe('the push job', () => {
  const push = (userId: string, n: number, collapseKey: string | null = `friend:${n}`) =>
    queuePush(t.pool, {
      userId,
      params: { type: 'friend_joined', kind: 'request', user_id: `u_${n}`, name: `friend${n}` },
      collapseKey,
      expiresAt: t.clock.now() + 24 * HOUR,
      now: t.clock.now(),
    });

  it('holds pushes through quiet hours and sends them at 07:00 WAT', async () => {
    startDayAt(23, 30);
    expect(new Date(nextSendTime(t.clock.now())).toISOString()).toBe(
      new Date(Date.UTC(2027, 0, day + 1, 6, 0)).toISOString(),
    );
    const p = await player();
    const phone = await givePhone(t.pool, p.id);
    await push(p.id, 1);
    const transport = new TestTransport();
    await sendDuePushes(deps, transport);
    expect(transport.to(phone)).toEqual([]);
    t.clock.advance(7.5 * HOUR); // 07:00
    await sendDuePushes(deps, transport);
    expect(transport.to(phone)).toHaveLength(1);
  });

  it('sends at most four pushes a day that are not about a turn', async () => {
    startDayAt(9);
    const p = await player();
    const phone = await givePhone(t.pool, p.id);
    for (let n = 0; n < 6; n++) await push(p.id, n);
    await queuePush(t.pool, {
      userId: p.id,
      params: { type: 'your_turn', duel_id: 'd_cap', kind: 'turn', opponent: null },
      collapseKey: 'duel:d_cap',
      expiresAt: t.clock.now() + HOUR,
      now: t.clock.now(),
    });
    const transport = new TestTransport();
    await sendDuePushes(deps, transport);
    expect(transport.to(phone).map((m) => m.type)).toEqual([
      'friend_joined',
      'friend_joined',
      'friend_joined',
      'friend_joined',
      'your_turn',
    ]);
    expect((await outcomes(p.id)).filter((o) => o.outcome === 'capped')).toHaveLength(2);

    // A new day, a new four.
    t.clock.advance(24 * HOUR);
    await push(p.id, 99);
    await sendDuePushes(deps, transport);
    expect(transport.to(phone)).toHaveLength(6);
  });

  it('drops a push past its time, and one for a player with no phone', async () => {
    startDayAt(9);
    const [p, q] = await Promise.all([player(), player()]);
    await givePhone(t.pool, p.id);
    await queuePush(t.pool, {
      userId: p.id,
      params: { type: 'your_turn', duel_id: 'd_late', kind: 'turn', opponent: null },
      collapseKey: 'duel:d_late',
      expiresAt: t.clock.now() + 1000,
      now: t.clock.now(),
    });
    await push(q.id, 1);
    t.clock.advance(2000);
    await sendDuePushes(deps, new TestTransport());
    expect(await outcomes(p.id)).toEqual([{ type: 'your_turn', outcome: 'expired' }]);
    expect(await outcomes(q.id)).toEqual([{ type: 'friend_joined', outcome: 'no_device' }]);
  });

  it('forgets dead tokens, gives up on refused messages, and retries the rest', async () => {
    startDayAt(9);
    const p = await player();
    const [dead, live] = [await givePhone(t.pool, p.id), await givePhone(t.pool, p.id)];
    const transport = new TestTransport();
    transport.failNext(dead, 'invalid');
    await push(p.id, 1);
    await sendDuePushes(deps, transport);
    expect(transport.to(live)).toHaveLength(1);
    const tokens = await t.pool.query(
      'SELECT push_token FROM devices WHERE user_id = $1 AND push_token IS NOT NULL',
      [p.id],
    );
    expect(tokens.rows).toEqual([{ push_token: live }]);

    transport.failNext(live, 'refused');
    await push(p.id, 2);
    await sendDuePushes(deps, transport);
    expect((await outcomes(p.id)).at(-1)).toEqual({ type: 'friend_joined', outcome: 'failed' });

    transport.failNext(live, 'transient');
    await push(p.id, 3);
    await sendDuePushes(deps, transport);
    expect((await outcomes(p.id)).at(-1)).toEqual({ type: 'friend_joined', outcome: null });
    t.clock.advance(30_000); // not yet: the first retry waits a minute
    await sendDuePushes(deps, transport);
    expect(transport.to(live)).toHaveLength(1);
    t.clock.advance(31_000);
    await sendDuePushes(deps, transport);
    expect(transport.to(live)).toHaveLength(2);
  });

  it('skips the kinds a player switched off in the app, on every phone', async () => {
    startDayAt(9);
    const p = await player();
    const phone = await givePhone(t.pool, p.id);
    const off = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: bearer(p.access),
      payload: { push_off: ['friends', 'friends'] },
    });
    expect(off.json().push_off).toEqual(['friends']);
    await push(p.id, 1);
    await queuePush(t.pool, {
      userId: p.id,
      params: { type: 'your_turn', duel_id: 'd_muted', kind: 'turn', opponent: null },
      collapseKey: 'duel:d_muted',
      expiresAt: t.clock.now() + HOUR,
      now: t.clock.now(),
    });
    const transport = new TestTransport();
    await sendDuePushes(deps, transport);
    expect(transport.to(phone).map((m) => m.type)).toEqual(['your_turn']);
    expect(await outcomes(p.id)).toEqual([
      { type: 'friend_joined', outcome: 'muted' },
      { type: 'your_turn', outcome: 'sent' },
    ]);
    const bad = await t.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: bearer(p.access),
      payload: { push_off: ['staff'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('keeps one waiting message per key: the newest', async () => {
    startDayAt(9);
    const p = await player();
    await push(p.id, 1, 'friend:same');
    await push(p.id, 2, 'friend:same');
    expect((await waiting(p.id)).map((w) => w.params.name)).toEqual(['friend2']);
  });

  it('moves waiting pushes along when a guest signs in to their account', async () => {
    startDayAt(9);
    const guest = await signInGuest(t.app);
    await push(guest.user.id, 1);
    const { user } = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/auth/google',
        headers: bearer(guest.access),
        payload: {
          id_token: await t.signGoogle({ sub: `push-merge-${day}` }),
          platform: 'android',
          merge_guest: true,
        },
      })
    ).json() as { user: { id: string } };
    // A new account takes over the guest itself; sign in again elsewhere to merge into an older one.
    const second = await signInGuest(t.app);
    await push(second.user.id, 2);
    const merged = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: bearer(second.access),
      payload: {
        id_token: await t.signGoogle({ sub: `push-merge-${day}` }),
        platform: 'android',
        merge_guest: true,
      },
    });
    expect(merged.statusCode, merged.body).toBe(200);
    expect((await waiting(user.id)).map((w) => w.params.name).sort()).toEqual(['friend1', 'friend2']);
    expect(await waiting(second.user.id)).toEqual([]);
  });
});

describe('the Daily reminder', () => {
  it('goes once at 09:00 WAT to recent players who have not played today', async () => {
    // The Daily tests' first day, so the Daily numbers they expect stay as they are.
    t.clock.t = Date.UTC(2026, 10, 2, 7, 59); // 08:59 WAT
    const [regular, lapsed, done, silent] = await Promise.all([player(), player(), player(), player()]);
    for (const p of [regular, lapsed, done]) await givePhone(t.pool, p.id);
    const { id } = (await req(regular, 'GET', '/v1/daily/today')).json() as DailyToday;
    const lastPlayed = (p: Player, date: string, current: number) =>
      t.pool.query('INSERT INTO streaks (user_id, current, best, last_play_date) VALUES ($1, $2, $2, $3)', [
        p.id,
        current,
        date,
      ]);
    await lastPlayed(regular, '2026-11-01', 3);
    await lastPlayed(lapsed, '2026-10-20', 9); // over a week ago
    await lastPlayed(done, '2026-11-02', 4); // already played today
    await lastPlayed(silent, '2026-11-01', 2); // no phone

    expect(await queueDailyReminders(deps)).toBe(0); // 08:59
    t.clock.advance(60_000);
    expect(await queueDailyReminders(deps)).toBe(1);
    expect(await queueDailyReminders(deps)).toBe(0); // once a day
    expect(await waiting(regular.id)).toEqual([
      { type: 'daily_live', params: { daily_id: id, streak: 3 }, collapse_key: `daily:${id}` },
    ]);
    for (const p of [lapsed, done, silent]) expect(await waiting(p.id)).toEqual([]);
  });
});

describe('the wording', () => {
  it('speaks Pidgin to Pidgin players and stands in for a missing name', () => {
    const turn = { type: 'your_turn', duel_id: 'd_1', kind: 'turn', opponent: null } as const;
    expect(renderPush(turn, 'en')).toMatchObject({ title: 'Your turn vs your opponent', url: '/duel/d_1' });
    expect(renderPush(turn, 'pcm').title).toBe('Your person don play, na your turn! 🔥');
    const result = {
      type: 'duel_result',
      duel_id: 'd_1',
      opponent: 'ada',
      result: 'loss',
      forfeit: false,
      you: 1200,
      them: 1450,
    } as const;
    expect(renderPush(result, 'en')).toMatchObject({
      title: 'Ada won this one',
      body: '1,200 to 1,450. Rematch?',
    });
    expect(renderPush({ ...result, result: 'draw', them: 1200 }, 'pcm').title).toBe('Una draw! 🤝');
    expect(renderPush({ type: 'daily_live', daily_id: 42, streak: 0 }, 'en')).toMatchObject({
      title: 'Daily #42 is live',
      body: '7 questions. How far can you go?',
      url: '/daily/play',
      channel: 'daily',
    });
  });
});

describe('Firebase Cloud Messaging', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    project_id: 'who-sabi-test',
    client_email: 'push@who-sabi-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.googleapis.com/token',
  };
  const push: OutgoingPush = {
    type: 'your_turn',
    title: 'Your turn vs ada',
    body: 'Ada has played. Your move.',
    url: '/duel/d_1',
    channel: 'duels',
    data: { duel_id: 'd_1' },
    collapseKey: 'duel:d_1',
    ttlSeconds: 3600.4,
  };
  const device = { id: 'dev_1', platform: 'android' as const, token: 'fcm-token-1' };

  function fakeGoogle(answer: (body: Record<string, unknown>) => Response) {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let now = 1_800_000_000_000;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      if (url === account.token_uri) {
        return Response.json({ access_token: `access-${calls.length}`, expires_in: 3600 });
      }
      return answer(JSON.parse(String(init.body)));
    }) as unknown as typeof fetch;
    return {
      calls,
      fcm: new FcmTransport(account, fetchImpl, () => now),
      advance: (ms: number) => (now += ms),
    };
  }

  it('signs in with the service account once and sends the v1 message', async () => {
    const google = fakeGoogle(() => Response.json({ name: 'projects/who-sabi-test/messages/1' }));
    expect(await google.fcm.send(device, push)).toBe('delivered');
    expect(await google.fcm.send(device, push)).toBe('delivered');
    expect(google.calls.map((c) => c.url)).toEqual([
      account.token_uri,
      'https://fcm.googleapis.com/v1/projects/who-sabi-test/messages:send',
      'https://fcm.googleapis.com/v1/projects/who-sabi-test/messages:send',
    ]);
    const assertion = new URLSearchParams(google.calls[0]!.body).get('assertion')!;
    expect(decodeJwt(assertion)).toMatchObject({
      iss: account.client_email,
      aud: account.token_uri,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });
    expect(google.calls[1]!.headers.authorization).toBe('Bearer access-1');
    expect(JSON.parse(google.calls[1]!.body)).toEqual({
      message: {
        token: 'fcm-token-1',
        notification: { title: 'Your turn vs ada', body: 'Ada has played. Your move.' },
        data: { duel_id: 'd_1', type: 'your_turn', url: '/duel/d_1' },
        android: {
          priority: 'HIGH',
          ttl: '3600s',
          collapse_key: 'duel:d_1',
          notification: { channel_id: 'duels', color: '#008751', tag: 'duel:d_1' },
        },
      },
    });

    // Close to the hour, it signs in again before the token runs out.
    google.advance(56 * 60_000);
    await google.fcm.send(device, push);
    expect(google.calls.filter((c) => c.url === account.token_uri)).toHaveLength(2);
  });

  it('tells dead tokens, refusals and failures worth retrying apart', async () => {
    const error = (status: number, code: string) =>
      Response.json({ error: { status: code, message: code, details: [{ errorCode: code }] } }, { status });
    expect(await fakeGoogle(() => error(404, 'UNREGISTERED')).fcm.send(device, push)).toBe(INVALID_TOKEN);
    await expect(
      fakeGoogle(() => error(400, 'INVALID_ARGUMENT')).fcm.send(device, push),
    ).rejects.toBeInstanceOf(PushRejected);
    const busy = fakeGoogle(() => error(503, 'UNAVAILABLE')).fcm.send(device, push);
    await expect(busy).rejects.toThrow(/FCM 503 UNAVAILABLE/);
    await expect(busy).rejects.not.toBeInstanceOf(PushRejected);
  });
});
