import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  CreateDuelResponse,
  DuelAnswerResponse,
  DuelView,
  LifelineResponse,
  ServedQuestion,
  Wallet,
} from '@whosabi/shared-types';
import { withTransaction } from '../src/db';
import { grantCoins } from '../src/economy/ledger';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

interface Player {
  id: string;
  access: string;
}

async function player(coins = 0): Promise<Player> {
  const guest = await signInGuest(t.app, 'android');
  if (coins > 0) {
    await withTransaction(t.pool, (c) =>
      grantCoins(c, guest.user.id, coins, {
        key: `test:${guest.user.id}`,
        reason: 'admin_grant',
        now: t.clock.now(),
      }),
    );
  }
  return { id: guest.user.id, access: guest.access };
}

const req = (p: Player, method: 'GET' | 'POST', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(p.access), ...(payload ? { payload } : {}) });

const wallet = async (p: Player) => ((await req(p, 'GET', '/v1/wallet')).json() as Wallet).coins;
const serve = async (p: Player, id: string, round: number, seq: number) => {
  const res = await req(p, 'POST', `/v1/duels/${id}/rounds/${round}/questions/${seq}/serve`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ServedQuestion;
};
const lifeline = (p: Player, id: string, type: string, round = 1, seq = 1) =>
  req(p, 'POST', `/v1/duels/${id}/lifelines`, { type, round, seq });
const answer = (p: Player, id: string, round: number, seq: number, displayIndex: number, ms = 2800) =>
  req(p, 'POST', `/v1/duels/${id}/rounds/${round}/questions/${seq}/answer`, {
    display_index: displayIndex,
    client_elapsed_ms: ms,
  });

async function rightIndex(q: ServedQuestion): Promise<number> {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [q.qid],
    )
  ).rows[0]!;
  return q.options.indexOf(row.options[row.correct_index]!);
}

/** A friend duel with round 1's category picked, on a category with four-option questions. */
async function duelFor(a: Player): Promise<string> {
  const b = await player();
  await befriend(t.pool, a.id, b.id);
  const res = await req(a, 'POST', '/v1/duels', { opponent: { user_id: b.id } });
  expect(res.statusCode, res.body).toBe(201);
  const duel = (res.json() as CreateDuelResponse).duel;
  const next = duel.next!;
  if (next.action !== 'pick_category') throw new Error('expected a category to pick');
  const picked = await req(a, 'POST', `/v1/duels/${duel.id}/rounds/1/category`, {
    category_id: next.offered[0],
  });
  expect(picked.statusCode, picked.body).toBe(200);
  return duel.id;
}

async function eventsOf(userId: string, event: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid && row.event === event)
    .map((row) => JSON.parse(row.props as string) as Record<string, unknown>);
}

/** The first question of the duel that has four options, served (true/false ones are answered past). */
async function fourOptionQuestion(p: Player, id: string): Promise<{ q: ServedQuestion; seq: number }> {
  for (let seq = 1; seq <= 3; seq++) {
    const q = await serve(p, id, 1, seq);
    if (q.options.length === 4) return { q, seq };
    t.clock.advance(1000);
    await answer(p, id, 1, seq, 0, 900);
  }
  throw new Error('no four-option question in round 1');
}

describe('lifelines in duels (step 2.4b)', () => {
  it('50/50 takes away two wrong options for 60 coins, once a duel, and a retry is free', async () => {
    const a = await player(500);
    const id = await duelFor(a);
    const { q, seq } = await fourOptionQuestion(a, id);
    expect(q.lifelines).toEqual({ used: [], removed: null, ask_naija: null });

    const res = await lifeline(a, id, 'fifty', 1, seq);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as LifelineResponse;
    const right = await rightIndex(q);
    expect(body.coins).toBe(440);
    expect(body.question.qid).toBe(q.qid);
    expect(body.question.lifelines!.used).toEqual(['fifty']);
    expect(body.question.lifelines!.removed).toHaveLength(2);
    expect(body.question.lifelines!.removed).not.toContain(right);

    // The same request again (a retry) shows the same, at no charge; a reload shows it too.
    const again = (await lifeline(a, id, 'fifty', 1, seq)).json() as LifelineResponse;
    expect(again).toEqual(body);
    expect((await serve(a, id, 1, seq)).lifelines).toEqual(body.question.lifelines);
    expect(await wallet(a)).toBe(440);

    // Answering keeps working; the next question can't have a second 50/50.
    t.clock.advance(3000);
    expect((await answer(a, id, 1, seq, right)).json()).toMatchObject({ correct: true });
    if (seq < 3) {
      await serve(a, id, 1, seq + 1);
      const second = await lifeline(a, id, 'fifty', 1, seq + 1);
      expect([second.statusCode, second.json().code]).toEqual([409, 'LIFELINE_USED']);
    }
    expect(await eventsOf(a.id, 'lifeline_used')).toEqual([
      { type: 'fifty', paid_with: 'coins', mode: 'duel' },
    ]);
    expect(await eventsOf(a.id, 'coins_changed')).toEqual([
      { delta: -60, reason: 'lifeline', balance_after: 440 },
    ]);
  });

  it('Ask Naija shows how players answered, adding up to 100, for 80 coins', async () => {
    const a = await player(500);
    const id = await duelFor(a);
    const q = await serve(a, id, 1, 1);
    const body = (await lifeline(a, id, 'ask_naija')).json() as LifelineResponse;
    expect(body.coins).toBe(420);
    const shares = body.question.lifelines!.ask_naija!;
    expect(shares).toHaveLength(q.options.length);
    expect(shares.reduce((x, y) => x + y, 0)).toBe(100);
    expect(body.question.lifelines!.used).toEqual(['ask_naija']);
  });

  it('+10s gives 10 seconds more to answer, but speed points still count against the usual 15', async () => {
    const a = await player(500);
    const id = await duelFor(a);
    const q = await serve(a, id, 1, 1);
    expect(q.time_limit_ms).toBe(15_000);
    t.clock.advance(5000);
    const body = (await lifeline(a, id, 'time')).json() as LifelineResponse;
    expect(body.coins).toBe(460);
    expect(body.question).toMatchObject({ qid: q.qid, time_limit_ms: 25_000, served_at: q.served_at });

    // 20 s in: past the usual limit, still in time, worth the base points only.
    t.clock.advance(15_000);
    const res = await answer(a, id, 1, 1, await rightIndex(q), 20_000);
    expect(res.json()).toMatchObject({ correct: true, timed_out: false, points: 100 });
  });

  it('Skip swaps in another question of the same category, with its own clock', async () => {
    const a = await player(500);
    const id = await duelFor(a);
    const q = await serve(a, id, 1, 1);
    t.clock.advance(8000);
    const body = (await lifeline(a, id, 'skip')).json() as LifelineResponse;
    expect(body.coins).toBe(400);
    const swapped = body.question;
    expect(swapped.qid).not.toBe(q.qid);
    expect(swapped.category_id).toBe(q.category_id);
    expect(swapped.time_limit_ms).toBe(15_000);
    expect(Date.parse(swapped.served_at)).toBe(t.clock.now());
    // Reloading shows the new question; it is the one answered, and the round review shows it.
    expect((await serve(a, id, 1, 1)).qid).toBe(swapped.qid);
    t.clock.advance(3000);
    const res = await answer(a, id, 1, 1, await rightIndex(swapped));
    expect((res.json() as DuelAnswerResponse).correct).toBe(true);
    for (const seq of [2, 3]) {
      await serve(a, id, 1, seq);
      t.clock.advance(2000);
      await answer(a, id, 1, seq, 0, 1900);
    }
    const view = (await req(a, 'GET', `/v1/duels/${id}`)).json() as DuelView;
    expect(view.rounds[0]!.questions![0]).toMatchObject({ qid: swapped.qid, opponent_correct: null });
  });

  it('costs coins the player has, and only works on an open question in their own turn', async () => {
    const poor = await player(50);
    const id = await duelFor(poor);
    await serve(poor, id, 1, 1);
    const short = await lifeline(poor, id, 'skip');
    expect([short.statusCode, short.json().code]).toEqual([409, 'NOT_ENOUGH_COINS']);
    // Nothing happened: no lifeline used, no coins gone.
    expect((await serve(poor, id, 1, 1)).lifelines!.used).toEqual([]);
    expect(await wallet(poor)).toBe(50);

    const a = await player(500);
    const duel = await duelFor(a);
    const notShown = await lifeline(a, duel, 'time');
    expect([notShown.statusCode, notShown.json().code]).toEqual([409, 'QUESTION_NOT_SERVED']);
    const q = await serve(a, duel, 1, 1);
    t.clock.advance(15_000);
    const late = await lifeline(a, duel, 'time');
    expect([late.statusCode, late.json().code]).toEqual([409, 'LIFELINE_NOT_ALLOWED']);
    await answer(a, duel, 1, 1, await rightIndex(q), 15_000);
    const answered = await lifeline(a, duel, 'ask_naija');
    expect([answered.statusCode, answered.json().code]).toEqual([409, 'LIFELINE_NOT_ALLOWED']);
    // Not in the tie-break, and not in a round that isn't being played.
    expect((await lifeline(a, duel, 'time', 4, 1)).statusCode).toBe(400);
    const notYours = await lifeline(a, duel, 'time', 3, 1);
    expect([notYours.statusCode, notYours.json().code]).toEqual([409, 'TURN_NOT_YOURS']);
    expect(await wallet(a)).toBe(500);
  });

  it("charges the price on the player's platform (step 2.7t)", async () => {
    await t.pool.query(
      `INSERT INTO app_config (key, value) VALUES ('econ.lifeline_fifty@android', '10')
       ON CONFLICT (key) DO UPDATE SET value = '10'`,
    );
    try {
      t.clock.advance(11_000); // past the 10 s the API keeps the values
      const a = await player(500);
      const id = await duelFor(a);
      const { seq } = await fourOptionQuestion(a, id);
      const res = await lifeline(a, id, 'fifty', 1, seq);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as LifelineResponse).coins).toBe(490);
    } finally {
      await t.pool.query("DELETE FROM app_config WHERE key = 'econ.lifeline_fifty@android'");
      t.clock.advance(11_000);
    }
  });
});
