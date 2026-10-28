/**
 * Random opponents and the Sabi Bot (build plan step 2.3, TRD FR-DUEL-6): a random duel waits
 * for a stranger near the challenger's rating, the window widening every 10 seconds; after a
 * minute the Sabi Bot takes the seat, plays its turns a little later, and the duel is unrated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  CreateDuelResponse,
  DuelAnswerResponse,
  DuelView,
  ServedQuestion,
  TiebreakAnswerResponse,
} from '@whosabi/shared-types';
import { SABI_BOT_ID } from '../src/duels/repo';
import { DuelService } from '../src/duels/service';
import { ServerEvents } from '../src/events';
import { bearer, createTestApp, signInGuest } from './helpers';

const SECOND = 1_000;

let t: Awaited<ReturnType<typeof createTestApp>>;
/** The workers' side, with a bot that misses every question (0.99 beats any chance of a right answer here). */
let workers: DuelService;
beforeAll(async () => {
  t = await createTestApp();
  workers = new DuelService(
    {
      config: t.config,
      pool: t.pool,
      redis: t.redis,
      clock: t.clock,
      events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
      log: t.app.log,
    },
    () => 0.99,
  );
});
afterAll(() => t.close());
// Every test starts with an empty pool: whatever an earlier one left waiting gets the bot.
beforeEach(async () => {
  t.clock.advance(61 * SECOND);
  await workers.seatBots(1000);
});

interface Player {
  id: string;
  access: string;
}

async function player(rating?: number): Promise<Player> {
  const guest = await signInGuest(t.app);
  if (rating !== undefined) {
    await t.pool.query("INSERT INTO ratings (user_id, scope, rating) VALUES ($1, 'overall', $2)", [
      guest.user.id,
      rating,
    ]);
  }
  return { id: guest.user.id, access: guest.access };
}

const req = (p: Player, method: 'GET' | 'POST', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(p.access), ...(payload ? { payload } : {}) });

async function random(p: Player): Promise<DuelView> {
  const res = await req(p, 'POST', '/v1/duels', { opponent: { random: true } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as CreateDuelResponse).duel;
}

const view = async (p: Player, id: string) => (await req(p, 'GET', `/v1/duels/${id}`)).json() as DuelView;

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

/** Everything the player can do now, until the turn passes. */
async function playTurn(p: Player, id: string, mode: 'right' | 'wrong'): Promise<void> {
  let next = (await view(p, id)).next;
  while (next && (next.action === 'pick_category' || next.action === 'play')) {
    if (next.action === 'pick_category') {
      const res = await req(p, 'POST', `/v1/duels/${id}/rounds/${next.round}/category`, {
        category_id: next.offered[0],
      });
      expect(res.statusCode, res.body).toBe(200);
      next = (res.json() as DuelView).next;
      continue;
    }
    const url = `/v1/duels/${id}/rounds/${next.round}/questions/${next.seq}`;
    const served = (await req(p, 'POST', `${url}/serve`)).json() as ServedQuestion;
    const right = await rightIndex(served);
    t.clock.advance(3 * SECOND);
    const res = await req(p, 'POST', `${url}/answer`, {
      display_index: mode === 'right' ? right : (right + 1) % served.options.length,
      client_elapsed_ms: 2800,
    });
    expect(res.statusCode, res.body).toBe(200);
    next = (res.json() as DuelAnswerResponse).next;
  }
}

const state = async (id: string) =>
  (await t.pool.query<{ state: string }>('SELECT state FROM duels WHERE id = $1', [id])).rows[0]!.state;

describe('random opponents', () => {
  it('pairs two players near in rating; the second plays at once once the first has played', async () => {
    const a = await player();
    const b = await player();
    const started = await random(a);
    expect(started).toMatchObject({ source: 'random', you: 'a', opponent: null, invite_url: null });
    expect(started.next).toMatchObject({ action: 'pick_category', round: 1 });
    await playTurn(a, started.id, 'right');
    expect((await view(a, started.id)).next).toEqual({ action: 'wait' });

    t.clock.advance(5 * SECOND);
    const joined = await random(b);
    expect(joined).toMatchObject({ id: started.id, source: 'random', you: 'b' });
    expect(joined.opponent?.id).toBe(a.id);
    expect(joined.next).toEqual({ action: 'play', round: 1, seq: 1 });
    // Their 48 hours start now.
    expect(Date.parse(joined.turn_deadline!)).toBe(t.clock.now() + 48 * 3_600_000);
    await playTurn(b, started.id, 'right');
    expect(await state(started.id)).toBe('wait_a_r2r3');
  });

  it('widens the rating window every 10 seconds', async () => {
    const a = await player(1500);
    const c = await player(1750);
    const waiting = await random(a);
    // 250 apart: too far at first, so c starts a duel of their own.
    t.clock.advance(5 * SECOND);
    const own = await random(c);
    expect(own.id).not.toBe(waiting.id);
    expect(own.opponent).toBeNull();
    // 12 seconds in, the window is ±300.
    t.clock.advance(7 * SECOND);
    const joined = await random(c);
    expect(joined).toMatchObject({ id: waiting.id, you: 'b' });
    // a hasn't played round 1 yet: c waits for them.
    expect(joined.next).toEqual({ action: 'wait' });
  });

  it('never pairs players who blocked each other, or who are playing each other already', async () => {
    const a = await player();
    const b = await player();
    const d = await player();
    const waiting = await random(a);
    await t.pool.query(
      `INSERT INTO friendships (user_a, user_b, status, requested_by, source, created_at, updated_at)
       VALUES (LEAST($1::text, $2::text), GREATEST($1::text, $2::text), 'blocked', $2, 'username', now(), now())`,
      [a.id, b.id],
    );
    t.clock.advance(SECOND);
    expect((await random(b)).id).not.toBe(waiting.id);

    // d joins a, the longest waiting; a second random duel by a then looks for someone else.
    expect((await random(d)).id).toBe(waiting.id);
    const again = await random(a);
    expect((await random(d)).id).not.toBe(again.id);
  });
});

describe('the Sabi Bot', () => {
  it('takes the seat after a minute, plays its turns a little later, and leaves ratings alone', async () => {
    const e = await player();
    const duel = await random(e);
    await playTurn(e, duel.id, 'right');

    t.clock.advance(30 * SECOND);
    await workers.seatBots();
    expect((await view(e, duel.id)).opponent).toBeNull();
    t.clock.advance(31 * SECOND);
    expect(await workers.seatBots()).toBeGreaterThanOrEqual(1);
    const seated = await view(e, duel.id);
    expect(seated).toMatchObject({ source: 'bot', opponent: { id: SABI_BOT_ID, username: 'Sabi Bot' } });

    // Its turn waits a little, then it plays rounds 1 and 2 and picks round 2's category.
    expect(await workers.playBotTurns()).toBe(0);
    t.clock.advance(21 * SECOND);
    expect(await workers.playBotTurns()).toBeGreaterThanOrEqual(1);
    const back = await view(e, duel.id);
    expect(back.next).toMatchObject({ action: 'play', round: 2, seq: 1 });
    expect(back.rounds[0]!.opponent).toEqual({ answered: 3, correct: 0, points: 0 });
    expect(back.rounds[1]!.picked_by).toBe('opponent');
    const pushes = await t.pool.query<{ user_id: string; type: string; params: { opponent: string } }>(
      "SELECT user_id, type, params FROM push_outbox WHERE params->>'duel_id' = $1",
      [duel.id],
    );
    expect(pushes.rows).toEqual([
      expect.objectContaining({
        user_id: e.id,
        type: 'your_turn',
        params: expect.objectContaining({ opponent: 'Sabi Bot' }),
      }),
    ]);

    await playTurn(e, duel.id, 'right');
    t.clock.advance(21 * SECOND);
    expect(await workers.playBotTurns()).toBeGreaterThanOrEqual(1);
    const done = await view(e, duel.id);
    expect(done).toMatchObject({ state: 'complete', result: 'win', rating_delta: null });
    expect(done.score.opponent).toBe(0);

    // Unrated, and the bot gets no pushes, no events and no seen questions.
    const ratings = await t.pool.query('SELECT user_id FROM ratings WHERE user_id = ANY($1)', [
      [e.id, SABI_BOT_ID],
    ]);
    expect(ratings.rows).toEqual([]);
    const botRows = await Promise.all([
      t.pool.query('SELECT 1 FROM push_outbox WHERE user_id = $1', [SABI_BOT_ID]),
      t.pool.query('SELECT 1 FROM user_question_seen WHERE user_id = $1', [SABI_BOT_ID]),
    ]);
    expect(botRows.map((r) => r.rows.length)).toEqual([0, 0]);
    const pid = pseudonymousId(SABI_BOT_ID, t.config.analyticsKey);
    const stream = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
    expect(stream.some(([, fields]) => fields[1]!.includes(pid))).toBe(false);
    expect(
      stream.some(([, fields]) => fields[1]!.includes(pseudonymousId(e.id, t.config.analyticsKey))),
    ).toBe(true);
  });

  it('guesses close in a tie-break, and the closer guess wins', async () => {
    const e = await player();
    const duel = await random(e);
    // Both miss everything: 0–0 after three rounds.
    await playTurn(e, duel.id, 'wrong');
    t.clock.advance(61 * SECOND);
    await workers.seatBots();
    t.clock.advance(21 * SECOND);
    await workers.playBotTurns();
    await playTurn(e, duel.id, 'wrong');
    t.clock.advance(21 * SECOND);
    await workers.playBotTurns();
    expect((await view(e, duel.id)).next).toEqual({ action: 'tiebreak' });

    // The bot answers first; the player then guesses it exactly.
    t.clock.advance(21 * SECOND);
    expect(await workers.playBotTurns()).toBeGreaterThanOrEqual(1);
    const bot = (
      await t.pool.query<{ guess: string; question_id: string }>(
        'SELECT guess, question_id FROM duel_answers WHERE duel_id = $1 AND round_no = 4 AND user_id = $2',
        [duel.id, SABI_BOT_ID],
      )
    ).rows[0]!;
    const answer = Number(
      (await t.pool.query('SELECT numeric_answer FROM questions WHERE id = $1', [bot.question_id])).rows[0]
        .numeric_answer,
    );
    expect(Number(bot.guess)).not.toBe(answer);
    await req(e, 'POST', `/v1/duels/${duel.id}/rounds/4/questions/1/serve`);
    t.clock.advance(4 * SECOND);
    const res = await req(e, 'POST', `/v1/duels/${duel.id}/rounds/4/questions/1/answer`, {
      guess: answer,
      client_elapsed_ms: 3800,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json() as TiebreakAnswerResponse).toMatchObject({ decided: true, result: 'win' });
    expect(await workers.playBotTurns()).toBe(0);
  });

  it("can't be challenged directly, and doesn't play rematches", async () => {
    const e = await player();
    const direct = await req(e, 'POST', '/v1/duels', { opponent: { user_id: SABI_BOT_ID } });
    expect([direct.statusCode, direct.json().code]).toEqual([409, 'OPPONENT_UNAVAILABLE']);

    const duel = await random(e);
    await playTurn(e, duel.id, 'right');
    t.clock.advance(61 * SECOND);
    await workers.seatBots();
    t.clock.advance(21 * SECOND);
    await workers.playBotTurns();
    await playTurn(e, duel.id, 'right');
    t.clock.advance(21 * SECOND);
    await workers.playBotTurns();
    expect(await state(duel.id)).toBe('complete');
    const rematch = await req(e, 'POST', `/v1/duels/${duel.id}/rematch`);
    expect([rematch.statusCode, rematch.json().title]).toEqual([409, 'The Sabi Bot does not play rematches']);
  });
});
