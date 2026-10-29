import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  DailyAnswerResponse,
  DailyResult,
  DailyToday,
  LeaderboardResponse,
  ServedQuestion,
} from '@whosabi/shared-types';
import { DailyService } from '../src/daily/service';
import { ServerEvents } from '../src/events';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';

/** 08:00 WAT on a WAT date. */
const morning = (date: string) => Date.parse(`${date}T07:00:00Z`);

let t: Awaited<ReturnType<typeof createTestApp>>;
let jobs: DailyService;
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = morning('2026-11-02'); // a Monday
  jobs = new DailyService({
    config: t.config,
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  });
});
afterAll(() => t.close());

interface Player {
  id: string;
  access: string;
  deviceId: string;
}

async function player(): Promise<Player> {
  const guest = await signInGuest(t.app);
  return { id: guest.user.id, access: guest.access, deviceId: guest.deviceId };
}

/** Access tokens last 15 minutes on the test clock: sign in again after moving it on. */
async function wake(...players: Player[]) {
  for (const p of players) p.access = (await signInGuest(t.app, 'android', p.deviceId)).access;
}

const get = (p: Player, url: string) =>
  t.app.inject({ method: 'GET', url, headers: { ...bearer(p.access), 'x-session-id': 's_daily' } });
const post = (p: Player, url: string, payload?: object) =>
  t.app.inject({
    method: 'POST',
    url,
    headers: { ...bearer(p.access), 'x-session-id': 's_daily' },
    ...(payload ? { payload } : {}),
  });

async function today(p: Player): Promise<DailyToday> {
  const res = await get(p, '/v1/daily/today');
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as DailyToday;
}

/** Where the right answer sits in this player's order. */
async function rightIndex(q: ServedQuestion): Promise<number> {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [q.qid],
    )
  ).rows[0]!;
  return q.options.indexOf(row.options[row.correct_index]!);
}

/** Plays today's Daily, right or wrong per question, every answer after 3 s. */
async function play(p: Player, pattern: string): Promise<DailyAnswerResponse[]> {
  const { id } = await today(p);
  const replies: DailyAnswerResponse[] = [];
  for (let seq = 1; seq <= 7; seq++) {
    const served = await post(p, `/v1/daily/${id}/questions/${seq}/serve`);
    expect(served.statusCode, served.body).toBe(200);
    const q = served.json() as ServedQuestion;
    const right = await rightIndex(q);
    const pick = pattern[seq - 1] === 'G' ? right : (right + 1) % q.options.length;
    const res = await post(p, `/v1/daily/${id}/questions/${seq}/answer`, {
      display_index: pick,
      client_elapsed_ms: 3000,
    });
    expect(res.statusCode, res.body).toBe(200);
    replies.push(res.json() as DailyAnswerResponse);
  }
  return replies;
}

async function result(p: Player, id: number): Promise<DailyResult> {
  const res = await get(p, `/v1/daily/${id}/result`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as DailyResult;
}

async function board(p: Player, url: string): Promise<LeaderboardResponse> {
  const res = await get(p, url);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as LeaderboardResponse;
}

async function eventsOf(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid)
    .map((row) => ({ event: row.event as string, props: JSON.parse(row.props as string) }));
}

const xpOf = async (id: string) =>
  Number((await t.pool.query('SELECT xp FROM users WHERE id = $1', [id])).rows[0].xp);

describe("today's Daily", () => {
  it('is picked once for everyone: 7 live family-safe questions, the hardest last, numbered #1', async () => {
    const players = await Promise.all([player(), player(), player(), player()]);
    const views = await Promise.all(players.map((p) => today(p)));
    expect(new Set(views.map((v) => v.id))).toEqual(new Set([1]));
    expect(views[0]).toMatchObject({
      id: 1,
      date: '2026-11-02',
      total: 7,
      played: false,
      answered: 0,
      streak: { current: 0, best: 0, freezes_left: 1 },
      closes_at: '2026-11-02T23:00:00.000Z',
    });
    expect(views[0]!.categories).toHaveLength(7);

    const rows = await t.pool.query<{ question_ids: string[]; locked: boolean }>(
      "SELECT question_ids, locked FROM daily_challenges WHERE play_date = '2026-11-02'",
    );
    expect(rows.rows).toHaveLength(1);
    const ids = rows.rows[0]!.question_ids;
    const questions = await t.pool.query<{
      id: string;
      difficulty: number;
      family_safe: boolean;
      status: string;
      type: string;
    }>('SELECT id, difficulty, family_safe, status, type FROM questions WHERE id = ANY($1)', [ids]);
    expect(questions.rows).toHaveLength(7);
    for (const q of questions.rows) {
      expect(q).toMatchObject({ family_safe: true, status: 'live' });
      expect(['mcq4', 'true_false']).toContain(q.type);
    }
    const difficulty = new Map(questions.rows.map((q) => [q.id, q.difficulty]));
    expect(difficulty.get(ids[6]!)).toBe(Math.max(...difficulty.values()));
  });

  it('plays once, then records the result, the streak and XP, and shows the result', async () => {
    const p = await player();
    const xpBefore = await xpOf(p.id);
    const replies = await play(p, 'GGGRGGG');
    expect(replies.map((r) => r.finished)).toEqual([false, false, false, false, false, false, true]);
    expect(replies.map((r) => r.correct)).toEqual([true, true, true, false, true, true, true]);

    const r = await result(p, 1);
    expect(r).toMatchObject({
      id: 1,
      date: '2026-11-02',
      total: 7,
      correct_count: 6,
      grid: 'GGGRGGG',
      xp: 112,
      coins: 20,
      score: replies.at(-1)!.running_score,
      streak: { current: 1, best: 1, freezes_left: 1, used_freeze: false },
      share_url: 'https://whosabi.ng/daily/1',
    });
    expect(r.share_text).toMatch(/^Who Sabi\? #1 6\/7 ⏱ \d+s\n🟩🟩🟩🟥🟩🟩🟩\nwhosabi\.ng\/daily\/1$/);
    expect(r.review).toHaveLength(7);
    expect(r.review.map((x) => x.correct)).toEqual([true, true, true, false, true, true, true]);
    expect(r.review[0]!.answer.length).toBeGreaterThan(0);
    expect(await xpOf(p.id)).toBe(xpBefore + 112);
    // Each answer is kept with the result, for re-scoring a corrected question (step 2.6b-2).
    const kept = await t.pool.query<{ answers: Array<{ qid: string; correct: boolean; points: number }> }>(
      'SELECT answers FROM daily_results WHERE daily_id = 1 AND user_id = $1',
      [p.id],
    );
    const ids = (
      await t.pool.query<{ question_ids: string[] }>('SELECT question_ids FROM daily_challenges WHERE id = 1')
    ).rows[0]!.question_ids;
    expect(kept.rows[0]!.answers.map((a) => a.qid)).toEqual(ids);
    expect(kept.rows[0]!.answers.map((a) => a.correct)).toEqual([true, true, true, false, true, true, true]);
    expect(kept.rows[0]!.answers.reduce((sum, a) => sum + a.points, 0)).toBe(r.score);

    // Once a day: no second go, and a retried last answer changes nothing.
    const again = await post(p, '/v1/daily/1/questions/1/serve');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('DAILY_ALREADY_PLAYED');
    const retry = await post(p, '/v1/daily/1/questions/7/answer', { display_index: 0, client_elapsed_ms: 1 });
    expect(retry.json()).toMatchObject({ finished: true, correct: true });
    expect(await xpOf(p.id)).toBe(xpBefore + 112);
    expect(await today(p)).toMatchObject({ played: true, answered: 7, streak: { current: 1 } });
    // The Daily's coins, once (step 2.4a).
    const coins = await t.pool.query<{ reason: string; amount: string; ref_id: string }>(
      `SELECT t.reason, e.amount, t.ref_id FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1`,
      [`user:${p.id}:coins`],
    );
    expect(coins.rows).toEqual([{ reason: 'daily', amount: '20', ref_id: '1' }]);

    const events = (await eventsOf(p.id)).filter((e) => e.event.startsWith('daily_'));
    expect(events).toEqual([
      { event: 'daily_started', props: { daily_id: 1 } },
      { event: 'daily_completed', props: { daily_id: 1, score: r.score, streak: 1 } },
    ]);
  });

  it('keeps the order: no skipping ahead, no result before the end', async () => {
    const p = await player();
    const ahead = await post(p, '/v1/daily/1/questions/2/serve');
    expect(ahead.json().code).toBe('QUESTION_OUT_OF_ORDER');
    const early = await get(p, '/v1/daily/1/result');
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('DAILY_NOT_FINISHED');
    expect((await get(p, '/v1/daily/2/result')).statusCode).toBe(404);
    // Picking up where they stopped.
    await post(p, '/v1/daily/1/questions/1/serve');
    await post(p, '/v1/daily/1/questions/1/answer', { display_index: 0, client_elapsed_ms: 2000 });
    expect(await today(p)).toMatchObject({ played: false, answered: 1 });
  });
});

describe('the result and the boards', () => {
  it('ranks players nationally and by state, names the leading state, and hides 13–17s on public boards', async () => {
    const setState = (p: Player, st: string) =>
      t.pool.query('UPDATE users SET home_state = $2 WHERE id = $1', [p.id, st]);
    const an = [await player(), await player(), await player()];
    const la = [await player(), await player(), await player()];
    for (const p of an) await setState(p, 'AN');
    for (const p of la) await setState(p, 'LA');
    await t.pool.query("UPDATE users SET status = 'active', username = $2 WHERE id = $1", [
      an[0]!.id,
      `Ada${randomInt(1e6)}`,
    ]);
    await t.pool.query("UPDATE users SET status = 'restricted', username = $2 WHERE id = $1", [
      la[0]!.id,
      `Teen${randomInt(1e6)}`,
    ]);
    for (const [p, pattern] of [
      [an[0], 'GGGGGGG'],
      [an[1], 'GGGGGRR'],
      [an[2], 'GGGGGGR'],
      [la[0], 'GGRRRRR'],
      [la[1], 'GGGRRRR'],
      [la[2], 'GRRRRRR'],
    ] as const) {
      await play(p!, pattern);
    }

    const all = (
      await t.pool.query<{ user_id: string; score: number; total_ms: number }>(
        'SELECT user_id, score, total_ms FROM daily_results WHERE daily_id = 1',
      )
    ).rows;
    const r = await result(an[1]!, 1);
    const mine = all.find((x) => x.user_id === an[1]!.id)!;
    const below = all.filter(
      (x) => x.score < mine.score || (x.score === mine.score && x.total_ms > mine.total_ms),
    );
    expect(r.players).toBe(all.length);
    expect(r.percentile).toBe(Math.floor((100 * below.length) / (all.length - 1)));
    expect(r.state).toEqual({ code: 'AN', rank: 3, players: 3 });
    expect(r.leading_state).toBe('AN');

    const global = await board(la[0]!, '/v1/daily/1/leaderboard?scope=global');
    expect(global).toMatchObject({ board: 'daily', period: '1', scope: 'global', players: all.length });
    expect(global.entries.map((e) => e.score)).toEqual([...all.map((x) => x.score)].sort((a, b) => b - a));
    expect(global.entries.map((e) => e.rank)).toEqual(global.entries.map((_, i) => i + 1));
    expect(global.entries[0]).toMatchObject({
      kind: 'player',
      username: expect.stringMatching(/^Ada/),
      you: false,
    });
    const teen = global.entries.find((e) => e.you)!;
    expect(teen).toMatchObject({ kind: 'restricted', username: null, avatar_id: null, home_state: 'LA' });
    expect(global.me).toEqual(teen);
    expect(global.entries.find((e) => e.kind === 'guest')?.username).toBeNull();

    const state = await board(an[2]!, '/v1/daily/1/leaderboard?scope=state');
    expect(state).toMatchObject({ state: 'AN', players: 3 });
    expect(state.entries.map((e) => e.you)).toEqual([false, true, false]);
    const noState = await board(await player(), '/v1/daily/1/leaderboard?scope=state');
    expect(noState).toMatchObject({ state: null, entries: [], me: null });

    // Friends see each other's names, 13–17s included.
    await befriend(t.pool, an[0]!.id, la[0]!.id);
    const friends = await board(an[0]!, '/v1/daily/1/leaderboard?scope=friends');
    expect(friends.entries.map((e) => [e.rank, e.kind, e.you])).toEqual([
      [1, 'player', true],
      [2, 'restricted', false],
    ]);
    expect(friends.entries[1]!.username).toMatch(/^Teen/);
  });

  it('rebuilds a board that is missing from Redis from Postgres', async () => {
    const viewer = await player();
    const before = await board(viewer, '/v1/daily/1/leaderboard?scope=global');
    expect(before.entries.length).toBeGreaterThan(5);
    await t.redis.del(...(await t.redis.keys('lb:*')));
    const after = await board(viewer, '/v1/daily/1/leaderboard?scope=global');
    expect(after.entries).toEqual(before.entries);
  });
});

describe('streaks, days and weeks', () => {
  it('counts consecutive days, lets the weekly freeze cover one missed day, and adds up the week', async () => {
    const p = await player();
    const at = async (date: string) => {
      t.clock.t = morning(date);
      await wake(p);
    };
    await at('2026-11-03');
    expect((await today(p)).id).toBe(2);
    await play(p, 'GGGGGGG');
    expect((await result(p, 2)).streak).toMatchObject({ current: 1 });

    await at('2026-11-04');
    await play(p, 'GRGRGRG');
    expect(await result(p, 3)).toMatchObject({ streak: { current: 2, used_freeze: false }, coins: 25 });
    // Yesterday's Daily is closed.
    const closed = await post(p, '/v1/daily/2/questions/1/serve');
    expect(closed.json().code).toBe('DAILY_CLOSED');

    // Skips Thursday; Friday is #5, and the freeze keeps the streak.
    await at('2026-11-06');
    expect(await today(p)).toMatchObject({ id: 5, streak: { current: 2, freezes_left: 1 } });
    await play(p, 'GGGRRRR');
    expect((await result(p, 5)).streak).toEqual({ current: 3, best: 3, freezes_left: 0, used_freeze: true });
    expect((await result(p, 5)).coins).toBe(30);

    const scores = (
      await t.pool.query<{ score: number }>('SELECT score FROM daily_results WHERE user_id = $1', [p.id])
    ).rows.map((r) => r.score);
    const week = await board(p, '/v1/leaderboards/week?scope=global');
    expect(week).toMatchObject({ board: 'week', period: '2026-W45', resets_at: '2026-11-08T23:00:00.000Z' });
    expect(week.me?.score).toBe(scores.reduce((a, b) => a + b, 0));
    const friendsWeek = await board(p, '/v1/leaderboards/week?scope=friends');
    expect(friendsWeek.entries).toEqual([expect.objectContaining({ you: true, score: week.me!.score })]);

    // Missing Saturday and Sunday is too much, even in a new week.
    await at('2026-11-09');
    expect((await today(p)).streak).toMatchObject({ current: 0, best: 3, freezes_left: 1 });
    await play(p, 'GGGGGGG');
    expect((await result(p, 8)).streak).toMatchObject({ current: 1, best: 3 });

    // No question comes back within the year while the pool has fresh ones.
    const used = (await t.pool.query<{ q: string }>('SELECT unnest(question_ids) AS q FROM daily_challenges'))
      .rows;
    expect(new Set(used.map((u) => u.q)).size).toBe(used.length);
  });

  it("moves a guest's Daily and streak into the account they sign in to", async () => {
    const sub = `g-${randomInt(1e9)}`;
    const google = async (headers: Record<string, string> = {}) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/auth/google',
        headers,
        payload: { id_token: await t.signGoogle({ sub }), platform: 'web' },
      });
    const account = (await google()).json().user.id as string;
    const guest = await player();
    await play(guest, 'GGGGGGG');
    const res = await google(bearer(guest.access));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ merged_guest: true, user: { id: account } });
    const rows = await t.pool.query(
      'SELECT user_id FROM daily_results WHERE daily_id = 8 AND user_id = ANY($1)',
      [[account, guest.id]],
    );
    expect(rows.rows).toEqual([{ user_id: account }]);
    const streak = await t.pool.query('SELECT user_id, current FROM streaks WHERE user_id = ANY($1)', [
      [account, guest.id],
    ]);
    expect(streak.rows).toEqual([{ user_id: account, current: 1 }]);
  });
});

describe('the worker', () => {
  it("picks tomorrow's Daily from 23:00 WAT and saves the final ranks after midnight", async () => {
    t.clock.t = Date.parse('2026-11-09T20:30:00Z'); // 21:30 WAT
    expect(await jobs.schedule()).toBe(0);
    t.clock.t = Date.parse('2026-11-09T22:05:00Z'); // 23:05 WAT
    expect(await jobs.schedule()).toBe(1);
    const tomorrow = await t.pool.query(
      "SELECT id, locked FROM daily_challenges WHERE play_date = '2026-11-10'",
    );
    expect(tomorrow.rows).toEqual([{ id: 9, locked: true }]);
    expect(await jobs.schedule()).toBe(0);

    // Just after midnight the earlier days are saved, but answers sent just before midnight
    // may still arrive for Monday's, so it waits a few minutes.
    const saved = () =>
      t.pool.query<{ play_date: string }>(
        "SELECT to_char(play_date, 'YYYY-MM-DD') AS play_date FROM daily_challenges WHERE snapshot_at IS NOT NULL ORDER BY 1",
      );
    t.clock.t = Date.parse('2026-11-09T23:02:00Z');
    expect(await jobs.snapshot()).toBeGreaterThan(0);
    expect((await saved()).rows.map((r) => r.play_date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-06',
    ]);
    t.clock.t = Date.parse('2026-11-09T23:20:00Z');
    expect(await jobs.snapshot()).toBe(1);
    expect((await saved()).rows.map((r) => r.play_date)).toContain('2026-11-09');

    const ranked = (
      await t.pool.query<{
        rank: number;
        state_rank: number | null;
        home_state: string | null;
        score: number;
        total_ms: number;
      }>(
        'SELECT rank, state_rank, home_state, score, total_ms FROM daily_results WHERE daily_id = 1 ORDER BY rank',
      )
    ).rows;
    expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
    for (let i = 1; i < ranked.length; i++) {
      const [a, b] = [ranked[i - 1]!, ranked[i]!];
      expect(a.score > b.score || (a.score === b.score && a.total_ms <= b.total_ms)).toBe(true);
    }
    expect(ranked.filter((r) => r.home_state === 'AN').map((r) => r.state_rank)).toEqual([1, 2, 3]);
    expect(ranked.filter((r) => r.home_state === null).every((r) => r.state_rank === null)).toBe(true);

    // Last week's standings, written once.
    const week = await t.pool.query<{ user_id: string; score: number; rank: number; dailies: number }>(
      "SELECT user_id, score, rank, dailies FROM weekly_standings WHERE iso_week = '2026-W45' ORDER BY rank",
    );
    expect(week.rows.length).toBeGreaterThan(0);
    expect(week.rows.map((r) => r.rank)).toEqual(week.rows.map((_, i) => i + 1));
    expect(Math.max(...week.rows.map((r) => r.dailies))).toBe(3);
    expect(await jobs.snapshot()).toBe(0);
  });

  it('makes no Daily when there are too few questions', async () => {
    t.clock.t = morning('2026-11-20');
    const p = await player();
    await t.pool.query('UPDATE categories SET active = false');
    try {
      const res = await get(p, '/v1/daily/today');
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('NO_QUESTIONS_AVAILABLE');
    } finally {
      await t.pool.query("UPDATE categories SET active = (id <> 'sport')");
    }
  });
});
