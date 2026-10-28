import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  CreateDuelResponse,
  DuelAnswerResponse,
  DuelView,
  InvitePreview,
  ListDuelsResponse,
  Platform,
  ServedQuestion,
  TiebreakAnswerResponse,
} from '@whosabi/shared-types';
import { DuelService } from '../src/duels/service';
import { ServerEvents } from '../src/events';
import { befriend, bearer, createTestApp, signInGuest } from './helpers';

const HOUR = 3_600_000;
const TURN = 48 * HOUR;

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

interface Player {
  id: string;
  access: string;
  deviceId: string;
  platform: Platform;
}

async function player(platform: Platform = 'android'): Promise<Player> {
  const guest = await signInGuest(t.app, platform);
  return { id: guest.user.id, access: guest.access, deviceId: guest.deviceId, platform };
}

/** Access tokens last 15 minutes on the same clock: sign in again after jumping ahead, as the app would. */
async function wake(...players: Player[]): Promise<void> {
  for (const p of players) p.access = (await signInGuest(t.app, p.platform, p.deviceId)).access;
}

function req(
  p: Player | null,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) {
  return t.app.inject({
    method,
    url,
    headers: { ...(p ? bearer(p.access) : {}), 'x-session-id': 's_duel_test', ...headers },
    ...(payload ? { payload } : {}),
  });
}

async function createDuel(p: Player, opponent: object, headers: Record<string, string> = {}) {
  // Direct challenges go to friends and past opponents; these tests are about the duel itself.
  if ('user_id' in opponent) await befriend(t.pool, p.id, opponent.user_id as string);
  const res = await req(p, 'POST', '/v1/duels', { opponent }, headers);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as CreateDuelResponse;
}

const getDuel = async (p: Player, id: string) => (await req(p, 'GET', `/v1/duels/${id}`)).json() as DuelView;
const pick = (p: Player, id: string, round: number, category: string) =>
  req(p, 'POST', `/v1/duels/${id}/rounds/${round}/category`, { category_id: category });
const serve = (p: Player, id: string, round: number, seq: number) =>
  req(p, 'POST', `/v1/duels/${id}/rounds/${round}/questions/${seq}/serve`);
const answer = (
  p: Player,
  id: string,
  round: number,
  seq: number,
  body: object,
  headers: Record<string, string> = {},
) => req(p, 'POST', `/v1/duels/${id}/rounds/${round}/questions/${seq}/answer`, body, headers);

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

async function numericAnswer(qid: string): Promise<number> {
  const row = (await t.pool.query('SELECT numeric_answer FROM questions WHERE id = $1', [qid])).rows[0];
  return Number(row.numeric_answer);
}

/** Do everything the player can do now (pick categories, answer questions) until the turn passes. */
async function playTurn(p: Player, duelId: string, mode: 'right' | 'wrong' = 'right'): Promise<number> {
  let next = (await getDuel(p, duelId)).next;
  let answered = 0;
  while (next && (next.action === 'pick_category' || next.action === 'play')) {
    if (next.action === 'pick_category') {
      const res = await pick(p, duelId, next.round, next.offered[0]!);
      expect(res.statusCode, res.body).toBe(200);
      next = (res.json() as DuelView).next;
      continue;
    }
    const served = (await serve(p, duelId, next.round, next.seq)).json() as ServedQuestion;
    const right = await rightIndex(served);
    t.clock.advance(3000);
    const choice = mode === 'right' ? right : (right + 1) % served.options.length;
    const res = await answer(p, duelId, next.round, next.seq, {
      display_index: choice,
      client_elapsed_ms: 2800,
    });
    expect(res.statusCode, res.body).toBe(200);
    next = (res.json() as DuelAnswerResponse).next;
    answered++;
  }
  return answered;
}

/** A duel played to a 0–0 tie, so it goes to the tie-break. */
async function tiedDuel() {
  const a = await player();
  const b = await player();
  const { duel } = await createDuel(a, { user_id: b.id });
  for (const p of [a, b, a, b]) await playTurn(p, duel.id, 'wrong');
  return { a, b, id: duel.id };
}

async function eventsOf(userId: string) {
  const pid = pseudonymousId(userId, t.config.analyticsKey);
  const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
  return entries
    .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
    .filter((row) => row.user_pid === pid)
    .map((row) => ({ event: row.event as string, props: JSON.parse(row.props as string) }));
}

describe('a friend duel', () => {
  it('plays A R1 → B R1+R2 → A R2+R3 → B R3, then settles the result and ratings', async () => {
    const a = await player();
    const b = await player('web');
    const { duel, invite_url } = await createDuel(a, { user_id: b.id });
    expect(invite_url).toBeNull();
    expect(duel).toMatchObject({
      state: 'created',
      source: 'friend',
      you: 'a',
      opponent: { id: b.id },
      your_turn: true,
      score: { you: 0, opponent: 0 },
      result: null,
      next: { action: 'pick_category', round: 1 },
    });
    expect(duel.next?.action === 'pick_category' && duel.next.offered).toHaveLength(3);
    expect(await getDuel(b, duel.id)).toMatchObject({ you: 'b', your_turn: false, next: { action: 'wait' } });

    expect(await playTurn(a, duel.id)).toBe(3);
    let seenByB = await getDuel(b, duel.id);
    expect(seenByB).toMatchObject({
      state: 'wait_b_r1r2',
      your_turn: true,
      next: { action: 'play', round: 1 },
    });
    // B sees A's round only after playing it.
    expect(seenByB.rounds[0]).toMatchObject({ opponent: null, questions: null });
    expect(seenByB.score.opponent).toBe(0);

    expect(await playTurn(b, duel.id, 'wrong')).toBe(6);
    seenByB = await getDuel(b, duel.id);
    expect(seenByB.state).toBe('wait_a_r2r3');
    expect(seenByB.rounds[0]!.opponent).toMatchObject({ answered: 3, correct: 3 });
    expect(seenByB.rounds[0]!.questions).toHaveLength(3);

    expect(await playTurn(a, duel.id)).toBe(6);
    expect(await playTurn(b, duel.id, 'wrong')).toBe(3);

    const endA = await getDuel(a, duel.id);
    const endB = await getDuel(b, duel.id);
    expect(endA).toMatchObject({ state: 'complete', result: 'win', your_turn: false, next: null });
    expect(endB).toMatchObject({ state: 'complete', result: 'loss', score: { you: 0 } });
    expect(endA.score.you).toBeGreaterThan(0);
    expect(endB.score.opponent).toBe(endA.score.you);
    expect(endA.rating_delta).toBeGreaterThan(0);
    expect(endB.rating_delta).toBeLessThan(0);
    expect(endA.rounds.map((r) => r.picked_by)).toEqual(['you', 'opponent', 'you']);

    // Both played the same 9 different questions, each in their own option order.
    const qidsA = endA.rounds.map((r) => r.questions!.map((q) => q.qid));
    expect(endB.rounds.map((r) => r.questions!.map((q) => q.qid))).toEqual(qidsA);
    expect(new Set(qidsA.flat()).size).toBe(9);

    const ratings = await t.pool.query<{ user_id: string; rating: number; games: number }>(
      "SELECT user_id, rating, games FROM ratings WHERE scope = 'overall' AND user_id = ANY($1)",
      [[a.id, b.id]],
    );
    const byId = new Map(ratings.rows.map((r) => [r.user_id, r]));
    expect(byId.get(a.id)).toMatchObject({ games: 1 });
    expect(byId.get(a.id)!.rating).toBeGreaterThan(1500);
    expect(byId.get(b.id)!.rating).toBeLessThan(1500);

    // Server events, under pseudonymous ids only.
    const eventsA = await eventsOf(a.id);
    expect(eventsA.map((e) => e.event).filter((e) => e.startsWith('duel_'))).toEqual([
      'duel_created',
      'duel_round_played',
      'duel_round_played',
      'duel_round_played',
      'duel_completed',
    ]);
    expect(eventsA.find((e) => e.event === 'duel_completed')!.props).toMatchObject({
      result: 'win',
      score_self: endA.score.you,
      score_opp: 0,
    });
    expect(eventsA.find((e) => e.event === 'question_answered')!.props).toMatchObject({ mode: 'duel' });
    expect((await eventsOf(b.id)).find((e) => e.event === 'duel_completed')!.props).toMatchObject({
      result: 'loss',
    });
  });

  it('keeps turns, category picks and question order in line', async () => {
    const a = await player();
    const b = await player();
    const { duel } = await createDuel(a, { user_id: b.id });
    const offered = duel.next?.action === 'pick_category' ? duel.next.offered : [];

    expect((await pick(b, duel.id, 1, offered[0]!)).json().code).toBe('TURN_NOT_YOURS');
    expect((await serve(b, duel.id, 1, 1)).json().code).toBe('TURN_NOT_YOURS');
    expect((await serve(a, duel.id, 1, 1)).json().code).toBe('CATEGORY_NOT_PICKED');
    const notOffered = ['slang', 'nollywood', 'music', 'food', 'mixed'].find((c) => !offered.includes(c))!;
    expect((await pick(a, duel.id, 1, notOffered)).json().code).toBe('CATEGORY_NOT_OFFERED');
    expect((await pick(a, duel.id, 1, offered[0]!)).statusCode).toBe(200);
    expect((await pick(a, duel.id, 1, offered[0]!)).statusCode).toBe(200);
    expect((await pick(a, duel.id, 1, offered[1]!)).json().code).toBe('CONFLICT');
    expect((await serve(a, duel.id, 2, 1)).json().code).toBe('TURN_NOT_YOURS');
    expect((await serve(a, duel.id, 1, 2)).json().code).toBe('QUESTION_OUT_OF_ORDER');
    expect((await answer(a, duel.id, 1, 1, { display_index: 0, client_elapsed_ms: 900 })).json().code).toBe(
      'QUESTION_NOT_SERVED',
    );

    // The answer never travels with the question, and serving again keeps the timer.
    const q = (await serve(a, duel.id, 1, 1)).json() as ServedQuestion;
    expect(q).toMatchObject({
      seq: 1,
      total: 3,
      category_id: offered[0],
      time_limit_ms: 15_000,
      media: null,
    });
    expect(JSON.stringify(q)).not.toContain('correct');
    t.clock.advance(5000);
    expect(((await serve(a, duel.id, 1, 1)).json() as ServedQuestion).served_at).toBe(q.served_at);
    const seen = await t.pool.query(
      'SELECT 1 FROM user_question_seen WHERE user_id = $1 AND question_id = $2',
      [a.id, q.qid],
    );
    expect(seen.rowCount).toBe(1);

    // Nobody else can see or touch the duel.
    const outsider = await player();
    expect((await req(outsider, 'GET', `/v1/duels/${duel.id}`)).statusCode).toBe(404);
    expect((await serve(outsider, duel.id, 1, 1)).statusCode).toBe(404);
    expect((await req(null, 'GET', `/v1/duels/${duel.id}`)).statusCode).toBe(401);
    expect((await createDuel(a, { link: true })).duel.id).not.toBe(duel.id);
    expect((await req(a, 'POST', '/v1/duels', { opponent: { user_id: a.id } })).statusCode).toBe(400);
  });

  it('keeps the first answer: retries replay it, another Idempotency-Key is refused (doc 14 §4.2)', async () => {
    const a = await player();
    const b = await player();
    const { duel } = await createDuel(a, { user_id: b.id });
    await pick(a, duel.id, 1, duel.next?.action === 'pick_category' ? duel.next.offered[0]! : '');

    // The API doc's example: right in 4,210 ms (the server saw 4,500 ms) scores 172.
    const q1 = (await serve(a, duel.id, 1, 1)).json() as ServedQuestion;
    const right = await rightIndex(q1);
    t.clock.advance(4500);
    const key = randomUUID();
    const first = await answer(
      a,
      duel.id,
      1,
      1,
      { display_index: right, client_elapsed_ms: 4210 },
      {
        'idempotency-key': key,
      },
    );
    expect(first.json()).toMatchObject({
      correct: true,
      timed_out: false,
      correct_display_index: right,
      points: 172,
      breakdown: { base: 100, speed: 72, streak: 0 },
      running_score: 172,
      streak: 1,
      next: { action: 'play', round: 1, seq: 2 },
    });
    const wrong = (right + 1) % q1.options.length;
    const sameKey = await answer(
      a,
      duel.id,
      1,
      1,
      { display_index: wrong, client_elapsed_ms: 900 },
      {
        'idempotency-key': key,
      },
    );
    expect(sameKey.json()).toEqual(first.json());
    expect((await answer(a, duel.id, 1, 1, { display_index: wrong, client_elapsed_ms: 900 })).json()).toEqual(
      first.json(),
    );
    const otherKey = await answer(
      a,
      duel.id,
      1,
      1,
      { display_index: wrong, client_elapsed_ms: 900 },
      {
        'idempotency-key': randomUUID(),
      },
    );
    expect([otherKey.statusCode, otherKey.json().code]).toEqual([409, 'ALREADY_ANSWERED']);

    // Two taps landing together: one answer counts and both get it.
    const q2 = (await serve(a, duel.id, 1, 2)).json() as ServedQuestion;
    t.clock.advance(2000);
    const [x, y] = await Promise.all([
      answer(a, duel.id, 1, 2, { display_index: 0, client_elapsed_ms: 1800 }),
      answer(a, duel.id, 1, 2, { display_index: 1, client_elapsed_ms: 1800 }),
    ]);
    expect(x.json()).toEqual(y.json());
    expect((x.json() as DuelAnswerResponse).running_score).toBeGreaterThanOrEqual(172);
    expect(q2.seq).toBe(2);
  });

  it('counts an answer re-sent within limit + 10 s after a network drop, without a speed bonus (FR-DUEL-5)', async () => {
    const a = await player();
    const b = await player();
    const { duel } = await createDuel(a, { user_id: b.id });
    await pick(a, duel.id, 1, duel.next?.action === 'pick_category' ? duel.next.offered[0]! : '');

    const q1 = (await serve(a, duel.id, 1, 1)).json() as ServedQuestion;
    t.clock.advance(15_000 + 9000);
    const resent = await answer(a, duel.id, 1, 1, {
      display_index: await rightIndex(q1),
      client_elapsed_ms: 9000,
    });
    expect(resent.json()).toMatchObject({
      correct: true,
      timed_out: false,
      points: 100,
      breakdown: { speed: 0 },
    });

    const q2 = (await serve(a, duel.id, 1, 2)).json() as ServedQuestion;
    t.clock.advance(15_000 + 10_001);
    const tooLate = await answer(a, duel.id, 1, 2, {
      display_index: await rightIndex(q2),
      client_elapsed_ms: 9000,
    });
    expect(tooLate.json()).toMatchObject({ correct: false, timed_out: true, points: 0 });
  });
});

describe('invite links', () => {
  it('shares a link, previews it publicly and lets one friend take the challenge', async () => {
    const a = await player();
    const { duel, invite_url } = await createDuel(a, { link: true });
    expect(invite_url).toMatch(/^https:\/\/whosabi\.ng\/d\/[A-Za-z0-9_-]{22}$/);
    expect(duel).toMatchObject({ source: 'link', opponent: null, invite_url });
    const token = invite_url!.split('/d/')[1]!;
    const preview = (await req(null, 'GET', `/v1/invites/${token}`)).json() as InvitePreview;
    expect(preview).toMatchObject({ challenger: { id: a.id }, status: 'open' });

    await playTurn(a, duel.id);
    expect(await getDuel(a, duel.id)).toMatchObject({ state: 'wait_b_r1r2', your_turn: false, invite_url });
    expect((await req(a, 'POST', `/v1/invites/${token}/accept`)).json().code).toBe('CONFLICT');

    // A friend opens it 40 hours later: their 48 hours start when they accept.
    t.clock.advance(40 * HOUR);
    const b = await player('web');
    const accepted = await req(b, 'POST', `/v1/invites/${token}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const asB = accepted.json() as DuelView;
    expect(asB).toMatchObject({ you: 'b', your_turn: true, opponent: { id: a.id }, invite_url: null });
    expect(new Date(asB.turn_deadline!).getTime()).toBe(t.clock.now() + TURN);
    expect((await req(b, 'POST', `/v1/invites/${token}/accept`)).statusCode).toBe(200);

    const late = await player();
    expect((await req(late, 'POST', `/v1/invites/${token}/accept`)).json().code).toBe('INVITE_TAKEN');
    expect(((await req(null, 'GET', `/v1/invites/${token}`)).json() as InvitePreview).status).toBe('taken');
    expect((await req(null, 'GET', `/v1/invites/${'x'.repeat(22)}`)).statusCode).toBe(404);
  });
});

describe('expiry', () => {
  it('gives the win to the waiting player when a turn runs out', async () => {
    const a = await player();
    const b = await player();
    const { duel } = await createDuel(a, { user_id: b.id });
    await playTurn(a, duel.id);
    t.clock.advance(TURN + 1000);
    await wake(a, b);

    expect((await serve(b, duel.id, 1, 1)).json().code).toBe('DUEL_FINISHED');
    expect(await getDuel(a, duel.id)).toMatchObject({ state: 'forfeit', result: 'win', next: null });
    expect(await getDuel(b, duel.id)).toMatchObject({ state: 'forfeit', result: 'loss' });
    expect((await eventsOf(b.id)).find((e) => e.event === 'duel_completed')!.props).toMatchObject({
      result: 'forfeit',
    });
  });

  it('cancels a duel nobody played, through the sweep the workers run', async () => {
    const a = await player();
    const { duel } = await createDuel(a, { link: true });
    const sweeper = new DuelService({
      config: t.config,
      pool: t.pool,
      redis: t.redis,
      clock: t.clock,
      events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
      log: t.app.log,
    });
    t.clock.advance(TURN + 1000);
    expect(await sweeper.expireDue(1000)).toBeGreaterThanOrEqual(1);
    const row = (await t.pool.query('SELECT state, completed_at FROM duels WHERE id = $1', [duel.id]))
      .rows[0];
    expect(row.state).toBe('cancelled');
    expect(row.completed_at.getTime()).toBe(t.clock.now());
    expect(await sweeper.expireDue(1000)).toBe(0);
  });
});

describe('the tie-break', () => {
  it('goes to the closest guess', async () => {
    const { a, b, id } = await tiedDuel();
    const asA = await getDuel(a, id);
    expect(asA).toMatchObject({
      state: 'tiebreak',
      next: { action: 'tiebreak' },
      tiebreak: { answered: false, opponent_answered: false, answer: null },
    });

    const q = (await serve(a, id, 4, 1)).json() as ServedQuestion;
    expect(q).toMatchObject({ type: 'closest_number', options: [], total: 1 });
    const right = await numericAnswer(q.qid);
    t.clock.advance(5000);
    const byA = (await answer(a, id, 4, 1, { guess: right + 1, client_elapsed_ms: 4800 })).json();
    expect(byA as TiebreakAnswerResponse).toMatchObject({ guess: right + 1, answer: right, decided: false });

    // B still can't see the answer, or A's guess.
    expect((await getDuel(b, id)).tiebreak).toMatchObject({
      answered: false,
      opponent_answered: true,
      answer: null,
      opponent_guess: null,
    });
    await serve(b, id, 4, 1);
    t.clock.advance(3000);
    const byB = (await answer(b, id, 4, 1, { guess: right + 5, client_elapsed_ms: 2800 })).json();
    expect(byB as TiebreakAnswerResponse).toMatchObject({ decided: true, result: 'loss' });
    expect(await getDuel(a, id)).toMatchObject({
      state: 'complete',
      result: 'win',
      tiebreak: { answer: right, your_guess: right + 1, opponent_guess: right + 5 },
    });
  });

  it('settles once when both answer at the same moment: equally close, so the faster one wins', async () => {
    const { a, b, id } = await tiedDuel();
    const q = (await serve(a, id, 4, 1)).json() as ServedQuestion;
    t.clock.advance(2000);
    await serve(b, id, 4, 1);
    t.clock.advance(3000);
    const right = await numericAnswer(q.qid);
    const [byA, byB] = await Promise.all([
      answer(a, id, 4, 1, { guess: right - 2, client_elapsed_ms: 4800 }),
      answer(b, id, 4, 1, { guess: right + 2, client_elapsed_ms: 2800 }),
    ]);
    expect([byA.statusCode, byB.statusCode]).toEqual([200, 200]);
    expect(await getDuel(b, id)).toMatchObject({ state: 'complete', result: 'win' });
    expect(await getDuel(a, id)).toMatchObject({ state: 'complete', result: 'loss' });
  });

  it('goes to whoever answered when time runs out, and is a draw if nobody did', async () => {
    const first = await tiedDuel();
    await serve(first.a, first.id, 4, 1);
    t.clock.advance(4000);
    await answer(first.a, first.id, 4, 1, { guess: 1, client_elapsed_ms: 3800 });
    const second = await tiedDuel();
    t.clock.advance(TURN + 1000);
    await wake(first.a, first.b, second.a);
    expect(await getDuel(first.b, first.id)).toMatchObject({ state: 'forfeit', result: 'loss' });
    expect(await getDuel(first.a, first.id)).toMatchObject({ state: 'forfeit', result: 'win' });
    expect(await getDuel(second.a, second.id)).toMatchObject({ state: 'complete', result: 'draw' });
  });
});

describe('declining, cancelling and rematches', () => {
  it('lets the challenged player decline, but only before they start', async () => {
    const a = await player();
    const b = await player();
    const first = (await createDuel(a, { user_id: b.id })).duel;
    await playTurn(a, first.id);
    expect((await req(a, 'POST', `/v1/duels/${first.id}/decline`)).json().code).toBe('CONFLICT');
    const declined = await req(b, 'POST', `/v1/duels/${first.id}/decline`);
    expect(declined.json()).toMatchObject({ state: 'declined', result: null, next: null });
    expect((await req(b, 'POST', `/v1/duels/${first.id}/decline`)).statusCode).toBe(200);

    const second = (await createDuel(a, { user_id: b.id })).duel;
    await playTurn(a, second.id);
    await serve(b, second.id, 1, 1);
    expect((await req(b, 'POST', `/v1/duels/${second.id}/decline`)).json().code).toBe('DUEL_ALREADY_STARTED');
    expect((await req(a, 'POST', `/v1/duels/${second.id}/cancel`)).json().code).toBe('DUEL_ALREADY_STARTED');

    const third = (await createDuel(a, { link: true })).duel;
    expect((await req(a, 'POST', `/v1/duels/${third.id}/cancel`)).json()).toMatchObject({
      state: 'cancelled',
    });
  });

  it('starts exactly one rematch when both players ask at once', async () => {
    const a = await player();
    const b = await player();
    const { duel } = await createDuel(a, { user_id: b.id });
    for (const [p, mode] of [
      [a, 'right'],
      [b, 'wrong'],
      [a, 'right'],
      [b, 'wrong'],
    ] as const) {
      await playTurn(p, duel.id, mode);
    }
    expect((await getDuel(a, duel.id)).state).toBe('complete');

    const [byA, byB] = await Promise.all([
      req(a, 'POST', `/v1/duels/${duel.id}/rematch`),
      req(b, 'POST', `/v1/duels/${duel.id}/rematch`),
    ]);
    expect([byA.statusCode, byB.statusCode].sort()).toEqual([200, 201]);
    const [ra, rb] = [byA.json() as DuelView, byB.json() as DuelView];
    expect(ra.id).toBe(rb.id);
    expect(ra).toMatchObject({ source: 'rematch', state: 'created', opponent: { id: b.id } });
    const outsider = await player();
    expect((await req(outsider, 'POST', `/v1/duels/${duel.id}/rematch`)).statusCode).toBe(404);
  });
});

describe('limits and lists', () => {
  it('caps a player at 20 duels going at once (PRD US-3 AC4)', async () => {
    const a = await player();
    for (let i = 0; i < 20; i++) await createDuel(a, { link: true });
    const over = await req(a, 'POST', '/v1/duels', { opponent: { link: true } });
    expect([over.statusCode, over.json().code]).toEqual([409, 'DUEL_LIMIT_REACHED']);
    const friend = await player();
    await befriend(t.pool, friend.id, a.id);
    const toFull = await req(friend, 'POST', '/v1/duels', { opponent: { user_id: a.id } });
    expect([toFull.statusCode, toFull.json().title]).toEqual([409, 'Your opponent has too many duels going']);
  });

  it('starts one duel for a repeated Idempotency-Key', async () => {
    const a = await player();
    const key = randomUUID();
    const one = await createDuel(a, { link: true }, { 'idempotency-key': key });
    const again = await createDuel(a, { link: true }, { 'idempotency-key': key });
    expect(again.duel.id).toBe(one.duel.id);
    const count = await t.pool.query('SELECT count(*)::int AS n FROM duels WHERE player_a = $1', [a.id]);
    expect(count.rows[0].n).toBe(1);
    expect(
      (await req(a, 'POST', '/v1/duels', { opponent: { link: true } }, { 'idempotency-key': 'no' }))
        .statusCode,
    ).toBe(400);
  });

  it('lists your turn first, and pages finished duels', async () => {
    const a = await player();
    const b = await player();
    const theirTurn = (await createDuel(b, { user_id: a.id })).duel;
    const myTurn = (await createDuel(a, { user_id: b.id })).duel;
    const active = (await req(a, 'GET', '/v1/duels')).json() as ListDuelsResponse;
    expect(active.duels.map((d) => [d.id, d.your_turn])).toEqual([
      [myTurn.id, true],
      [theirTurn.id, false],
    ]);

    for (let i = 0; i < 3; i++) {
      const { duel } = await createDuel(a, { link: true });
      t.clock.advance(1000);
      await req(a, 'POST', `/v1/duels/${duel.id}/cancel`);
    }
    const page1 = (await req(a, 'GET', '/v1/duels?state=done&limit=2')).json() as ListDuelsResponse;
    expect(page1.duels).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();
    const page2 = (
      await req(a, 'GET', `/v1/duels?state=done&limit=2&cursor=${page1.next_cursor}`)
    ).json() as ListDuelsResponse;
    expect(page2).toMatchObject({ next_cursor: null });
    expect(page2.duels).toHaveLength(1);
    expect(new Set([...page1.duels, ...page2.duels].map((d) => d.id)).size).toBe(3);
    expect((await req(a, 'GET', '/v1/duels?state=done&cursor=bad')).statusCode).toBe(400);
  });
});
