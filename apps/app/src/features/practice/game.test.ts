import { describe, expect, it } from 'vitest';
import type { PracticeQuestion } from '@whosabi/shared-types';
import { keepForRetry, localGame } from './game';

const question = (n: number): PracticeQuestion => ({
  qid: `q${n}`,
  category_id: 'food',
  type: 'mcq4',
  text: `Question ${n}?`,
  options: ['Egusi', 'Ogbono', 'Afang', 'Banga'],
  correct_index: n % 4,
  fact: `Fact ${n}.`,
  difficulty: 2,
});

const make = () =>
  localGame(
    {
      id: '6b0f7a64-0d5e-4b5f-9f5b-0c2c6c0f8a11',
      packId: 'pk_core_food',
      week: '2026-W44',
      questions: [question(1), question(2), question(3)],
      timeLimitMs: 15_000,
      userId: 'u_1',
    },
    () => Date.UTC(2026, 9, 29, 12),
  );

describe('a practice game on the device (step 2.8g)', () => {
  it('shuffles the options per player and game, and checks the tap against the right answer', () => {
    const game = make();
    const served = game.serve(1);
    expect(served).toMatchObject({ qid: 'q1', seq: 1, total: 3, time_limit_ms: 15_000, media: null });
    expect([...served.options].sort()).toEqual(['Afang', 'Banga', 'Egusi', 'Ogbono']);
    // The same game serves the same order again.
    expect(make().serve(1).options).toEqual(served.options);

    const right = served.options.indexOf('Ogbono');
    const reply = game.answer(1, { display_index: right, client_elapsed_ms: 3000 });
    expect(reply).toMatchObject({
      correct: true,
      timed_out: false,
      correct_display_index: right,
      fact: 'Fact 1.',
    });
    expect(reply.points).toBe(100 + 80);
    expect(reply.running_score).toBe(180);
  });

  it('builds the result in the canonical order, and counts a timeout as wrong', () => {
    const game = make();
    const two = game.serve(2);
    game.answer(1, { display_index: game.serve(1).options.indexOf('Ogbono'), client_elapsed_ms: 2000 });
    const wrong = two.options.indexOf('Egusi');
    expect(game.answer(2, { display_index: wrong, client_elapsed_ms: 5000 }).correct).toBe(false);
    expect(game.answer(3, { display_index: null, client_elapsed_ms: null })).toMatchObject({
      correct: false,
      timed_out: true,
      streak: 0,
    });
    // A retried answer is kept once.
    game.answer(3, { display_index: null, client_elapsed_ms: null });
    const result = game.result(Date.UTC(2026, 9, 29, 12, 5));
    expect(result).toEqual({
      id: '6b0f7a64-0d5e-4b5f-9f5b-0c2c6c0f8a11',
      pack_id: 'pk_core_food',
      week: '2026-W44',
      played_at: '2026-10-29T12:05:00.000Z',
      answers: [
        { qid: 'q1', picked: 1, elapsed_ms: 2000 },
        { qid: 'q2', picked: 0, elapsed_ms: 5000 },
        { qid: 'q3', picked: null, elapsed_ms: 15_000 },
      ],
      complete: true,
    });
    expect(game.correctCount()).toBe(1);
  });

  it('keeps a result for another try only when sending it could still work', () => {
    expect(keepForRetry(new TypeError('Network request failed'))).toBe(true);
    expect(keepForRetry({ status: 503 })).toBe(true);
    expect(keepForRetry({ status: 429 })).toBe(true);
    expect(keepForRetry({ status: 404 })).toBe(false);
    expect(keepForRetry({ status: 400 })).toBe(false);
  });
});
