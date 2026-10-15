import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import { displayOrder, optionPermutation, shuffleSeed } from '@whosabi/game-rules';
import type { AnswerResponse, ServedQuestion, StartRoundResponse } from '@whosabi/shared-types';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function startTasteTest(access: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/rounds',
    headers: bearer(access),
    payload: { mode: 'taste_test' },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as StartRoundResponse;
}

async function serve(access: string, roundId: string, seq: number) {
  return t.app.inject({
    method: 'POST',
    url: `/v1/rounds/${roundId}/questions/${seq}/serve`,
    headers: bearer(access),
  });
}

async function answer(
  access: string,
  roundId: string,
  seq: number,
  displayIndex: number | null,
  elapsed: number,
) {
  return t.app.inject({
    method: 'POST',
    url: `/v1/rounds/${roundId}/questions/${seq}/answer`,
    headers: { ...bearer(access), 'x-session-id': 's_test_session' },
    payload: { display_index: displayIndex, client_elapsed_ms: elapsed },
  });
}

async function correctOption(qid: string) {
  const row = (
    await t.pool.query<{ options: string[]; correct_index: number }>(
      'SELECT options, correct_index FROM questions WHERE id = $1',
      [qid],
    )
  ).rows[0]!;
  return row.options[row.correct_index]!;
}

describe('taste test', () => {
  it('plays three questions with server timing and scoring, one at a time', async () => {
    const guest = await signInGuest(t.app);
    const round = await startTasteTest(guest.access);
    expect(round).toMatchObject({ mode: 'taste_test', total: 3, categories: ['slang', 'food', 'music'] });

    expect((await serve(guest.access, round.round_id, 2)).json().code).toBe('QUESTION_OUT_OF_ORDER');
    expect((await answer(guest.access, round.round_id, 1, 0, 1000)).json().code).toBe('QUESTION_NOT_SERVED');

    // Q1: answered correctly in 4,210 ms (server saw 4,500 ms): the API doc's 172-point example.
    const q1 = (await serve(guest.access, round.round_id, 1)).json() as ServedQuestion;
    expect(q1).toMatchObject({ seq: 1, total: 3, category_id: 'slang', media: null, time_limit_ms: 15_000 });
    expect(q1.served_at).toBe(new Date(t.clock.now()).toISOString());
    expect(Object.keys(q1)).not.toContain('correct_index');
    const right = q1.options.indexOf(await correctOption(q1.qid));
    t.clock.advance(4500);
    const a1 = (await answer(guest.access, round.round_id, 1, right, 4210)).json() as AnswerResponse;
    expect(a1).toMatchObject({
      correct: true,
      timed_out: false,
      correct_display_index: right,
      points: 172,
      breakdown: { base: 100, speed: 72, streak: 0 },
      running_score: 172,
      streak: 1,
    });
    expect(typeof a1.fact).toBe('string');

    // Retrying (or a double tap) returns the first result, even with another choice.
    const retry = (await answer(guest.access, round.round_id, 1, (right + 1) % 4, 900)).json();
    expect(retry).toEqual(a1);

    // Q2: wrong answer ends the streak.
    const q2 = (await serve(guest.access, round.round_id, 2)).json() as ServedQuestion;
    const wrong = (q2.options.indexOf(await correctOption(q2.qid)) + 1) % q2.options.length;
    t.clock.advance(2000);
    const a2 = (await answer(guest.access, round.round_id, 2, wrong, 1900)).json() as AnswerResponse;
    expect(a2).toMatchObject({ correct: false, points: 0, streak: 0, running_score: 172 });

    // Q3: the right answer, but too late (limit 15 s + RTT 0.4 s + grace 2 s).
    const q3 = (await serve(guest.access, round.round_id, 3)).json() as ServedQuestion;
    t.clock.advance(18_000);
    const late = q3.options.indexOf(await correctOption(q3.qid));
    const a3 = (await answer(guest.access, round.round_id, 3, late, 14_000)).json() as AnswerResponse;
    expect(a3).toMatchObject({ correct: false, timed_out: true, points: 0, running_score: 172 });

    const result = await t.app.inject({
      method: 'GET',
      url: `/v1/rounds/${round.round_id}`,
      headers: bearer(guest.access),
    });
    expect(result.json()).toMatchObject({
      total: 3,
      answered: 3,
      correct_count: 1,
      score: 172,
      complete: true,
    });
  });

  it('shows each player the options in their own order, computed from the round, player and question', async () => {
    const guest = await signInGuest(t.app);
    const round = await startTasteTest(guest.access);
    const q1 = (await serve(guest.access, round.round_id, 1)).json() as ServedQuestion;
    const canonical = (
      await t.pool.query<{ options: string[] }>('SELECT options FROM questions WHERE id = $1', [q1.qid])
    ).rows[0]!.options;
    const perm = optionPermutation(canonical.length, shuffleSeed(round.round_id, guest.user.id, q1.qid));
    expect(q1.options).toEqual(displayOrder(canonical, perm));
  });

  it('keeps the original timer when a question is served again', async () => {
    const guest = await signInGuest(t.app);
    const round = await startTasteTest(guest.access);
    const first = (await serve(guest.access, round.round_id, 1)).json() as ServedQuestion;
    t.clock.advance(5000);
    const again = (await serve(guest.access, round.round_id, 1)).json() as ServedQuestion;
    expect(again.served_at).toBe(first.served_at);
  });

  it("hides one player's round from everyone else", async () => {
    const owner = await signInGuest(t.app);
    const other = await signInGuest(t.app);
    const round = await startTasteTest(owner.access);
    expect((await serve(other.access, round.round_id, 1)).statusCode).toBe(404);
    const peek = await t.app.inject({
      method: 'GET',
      url: `/v1/rounds/${round.round_id}`,
      headers: bearer(other.access),
    });
    expect(peek.statusCode).toBe(404);
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/rounds', payload: { mode: 'taste_test' } })).statusCode,
    ).toBe(401);
  });

  it('records server events with pseudonymous player ids only', async () => {
    const guest = await signInGuest(t.app);
    const round = await startTasteTest(guest.access);
    const q1 = (await serve(guest.access, round.round_id, 1)).json() as ServedQuestion;
    t.clock.advance(3000);
    await answer(guest.access, round.round_id, 1, 0, 2800);

    const pid = pseudonymousId(guest.user.id, t.config.analyticsKey);
    const entries = (await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>;
    const rows = entries
      .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
      .filter((row) => row.user_pid === pid);
    expect(rows.map((r) => r.event)).toEqual(['question_served', 'question_answered']);
    expect(rows[1]).toMatchObject({ source: 'server', platform: 'android', session_id: 's_test_session' });
    expect(JSON.parse(rows[1]!.props as string)).toMatchObject({
      qid: q1.qid,
      mode: 'taste_test',
      category: 'slang',
    });
    expect(JSON.stringify(entries)).not.toContain(guest.user.id);
  });
});

describe('content', () => {
  it('lists the five launch categories', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/categories' });
    expect(res.json().categories.map((c: { id: string }) => c.id)).toEqual([
      'slang',
      'nollywood',
      'music',
      'food',
      'mixed',
    ]);
  });

  it('reports healthy when Postgres and Redis respond', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
  });
});
