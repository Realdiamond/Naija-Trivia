/**
 * Difficulty calibration and quality flags (step 2.6b, GDD §6.3, content doc §4): every answer
 * moves a question's item rating, and once a night levels follow the ratings and the numbers flag
 * questions that look too hard, too easy or wrongly keyed.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { displayOrder, optionPermutation, shuffleSeed, updateItemRating } from '@whosabi/game-rules';
import type { ServedQuestion, StartRoundResponse } from '@whosabi/shared-types';
import { calibrateQuestions } from '../src/jobs/calibration';
import type { JobDeps } from '../src/jobs/deps';
import { flushQuestionStats } from '../src/jobs/questionStats';
import { reportQueue, resolveReports } from '../src/content/reports';
import { ServerEvents } from '../src/events';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let deps: JobDeps;
const made: string[] = [];
beforeAll(async () => {
  t = await createTestApp();
  deps = {
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  };
  // Questions here sit in a category the game never serves.
  await t.pool.query(
    `INSERT INTO categories (id, name_en, active, sort_order) VALUES ('calibration_test', 'Calibration test', false, 99)
     ON CONFLICT (id) DO NOTHING`,
  );
});
afterAll(async () => {
  await t.pool.query('DELETE FROM questions WHERE id = ANY($1)', [made]);
  await t.pool.query("DELETE FROM categories WHERE id = 'calibration_test'");
  await t.close();
});

const rating = async (qid: string) =>
  (await t.pool.query<{ d_rating: number }>('SELECT d_rating FROM questions WHERE id = $1', [qid])).rows[0]!
    .d_rating;

/** A live question with these numbers already in, straight in the database. */
async function question(stats: {
  d_rating?: number;
  plays: number;
  correct: number;
  option_counts?: number[];
  difficulty?: number;
}): Promise<string> {
  const id = `q_calib_${randomInt(1e9)}`;
  made.push(id);
  await t.pool.query(
    `INSERT INTO questions (id, category_id, type, text, options, correct_index, difficulty, d_rating, status,
                            source_url)
     VALUES ($1, 'calibration_test', 'mcq4', $2, $3::jsonb, 0, $4, $5, 'live', 'https://example.com/fact')`,
    [
      id,
      `Which one is right? (${id})`,
      JSON.stringify(['Right', 'Wrong one', 'Wrong two', 'Wrong three']),
      stats.difficulty ?? 3,
      stats.d_rating ?? 1500,
    ],
  );
  await t.pool.query(
    'INSERT INTO question_stats (question_id, plays, correct, option_counts) VALUES ($1, $2, $3, $4)',
    [
      id,
      stats.plays,
      stats.correct,
      stats.option_counts ?? [stats.correct, stats.plays - stats.correct, 0, 0],
    ],
  );
  return id;
}

/** 03:30 WAT on a night of its own. */
let night = 0;
function nightTime() {
  t.clock.t = Date.UTC(2027, 2, 1 + ++night, 2, 30);
}

describe('every answer moves the item rating', () => {
  it('makes a question easier when a player gets it right, through the taste test', async () => {
    await flushQuestionStats(deps); // nothing else waiting
    const guest = await signInGuest(t.app);
    const round = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/rounds',
        headers: bearer(guest.access),
        payload: { mode: 'taste_test' },
      })
    ).json() as StartRoundResponse;
    const served = (
      await t.app.inject({
        method: 'POST',
        url: `/v1/rounds/${round.round_id}/questions/1/serve`,
        headers: bearer(guest.access),
      })
    ).json() as ServedQuestion;
    const row = (
      await t.pool.query<{ options: string[]; correct_index: number; d_rating: number }>(
        'SELECT options, correct_index, d_rating FROM questions WHERE id = $1',
        [served.qid],
      )
    ).rows[0]!;
    const perm = optionPermutation(
      row.options.length,
      shuffleSeed(round.round_id, guest.user.id, served.qid),
    );
    const right = displayOrder(row.options, perm).indexOf(row.options[row.correct_index]!);
    t.clock.advance(3000);
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/rounds/${round.round_id}/questions/1/answer`,
      headers: bearer(guest.access),
      payload: { display_index: right, client_elapsed_ms: 2800 },
    });
    expect(res.json().correct).toBe(true);

    await flushQuestionStats(deps);
    // A guest counts as 1500; a right answer lowers the rating by K × (1 − expected).
    expect(await rating(served.qid)).toBeCloseTo(updateItemRating(row.d_rating, 1500, true), 3);
    expect(await rating(served.qid)).toBeLessThan(row.d_rating);
  });
});

describe('the nightly check', () => {
  it('sets levels from the ratings of questions with 200 plays, once a night', async () => {
    const ids: Array<{ id: string; d: number }> = [];
    for (let i = 0; i < 60; i++) {
      const d = 900 + i * 20;
      ids.push({ id: await question({ d_rating: d, plays: 250, correct: 125, difficulty: 3 }), d });
    }
    // Too few plays: its level stays as written.
    const young = await question({ d_rating: 2100, plays: 150, correct: 75, difficulty: 2 });

    t.clock.t = Date.UTC(2027, 2, 1, 1, 30); // 02:30 WAT: not yet
    expect(await calibrateQuestions(deps)).toBeNull();
    nightTime();
    const result = await calibrateQuestions(deps);
    expect(result!.relevelled).toBeGreaterThan(0);
    expect(await calibrateQuestions(deps)).toBeNull(); // once a night

    const levels = (
      await t.pool.query<{ id: string; difficulty: number }>(
        'SELECT id, difficulty FROM questions WHERE id = ANY($1)',
        [[...ids.map((q) => q.id), young]],
      )
    ).rows;
    const level = (id: string) => levels.find((l) => l.id === id)!.difficulty;
    expect(level(ids[0]!.id)).toBe(1);
    expect(level(ids.at(-1)!.id)).toBe(5);
    for (let i = 1; i < ids.length; i++)
      expect(level(ids[i]!.id)).toBeGreaterThanOrEqual(level(ids[i - 1]!.id));
    expect(level(young)).toBe(2);

    const history = await t.pool.query('SELECT action, note FROM question_history WHERE question_id = $1', [
      ids[0]!.id,
    ]);
    expect(history.rows).toEqual([{ action: 'recalibrated', note: 'Level 3 → 1 from 250 plays' }]);
  });

  it('flags questions that look too hard, too easy or wrongly keyed, each once', async () => {
    const hard = await question({ plays: 320, correct: 10, option_counts: [10, 110, 100, 100] });
    const easy = await question({ plays: 320, correct: 315 });
    const wrongKey = await question({ plays: 320, correct: 40, option_counts: [40, 250, 20, 10] });
    const fine = await question({ plays: 320, correct: 200 });

    nightTime();
    await calibrateQuestions(deps);
    const reports = await t.pool.query<{ question_id: string; reason: string; note: string }>(
      'SELECT question_id, reason, note FROM question_reports WHERE question_id = ANY($1) AND by_numbers',
      [[hard, easy, wrongKey, fine]],
    );
    const reasonOf = (id: string) => reports.rows.filter((r) => r.question_id === id).map((r) => r.reason);
    expect(reasonOf(hard)).toEqual(['too_hard']);
    expect(reasonOf(easy)).toEqual(['too_easy']);
    expect(reasonOf(wrongKey)).toEqual(['wrong_answer']);
    expect(reasonOf(fine)).toEqual([]);
    expect(reports.rows.find((r) => r.question_id === wrongKey)!.note).toBe(
      'From the numbers: 78% of players pick “Wrong one”, not the answer “Right”. Check the answer.',
    );

    // Too hard and too easy stay in the game; a likely wrong answer comes out of it at once.
    const status = async (id: string) =>
      (await t.pool.query<{ status: string }>('SELECT status FROM questions WHERE id = $1', [id])).rows[0]!
        .status;
    expect(await status(hard)).toBe('live');
    expect(await status(easy)).toBe('live');
    expect(await status(wrongKey)).toBe('suspended');
    const alert = await t.pool.query('SELECT title FROM staff_alerts WHERE body LIKE $1', [
      `%(${wrongKey})%`,
    ]);
    expect(alert.rows).toEqual([{ title: 'Question taken out: most players pick another answer' }]);
    const queued = (await reportQueue(t.pool)).groups.find((g) => g.question.id === wrongKey);
    expect(queued).toMatchObject({ auto_suspended: true, reasons: { wrong_answer: 1 } });

    // An editor keeps it as it is: back in the game, and not flagged again.
    await resolveReports(t.pool, {
      questionId: wrongKey,
      resolution: 'rejected',
      note: 'The answer is right: a common mix-up.',
      actor: 'system',
      ip: null,
      now: t.clock.now(),
    });
    expect(await status(wrongKey)).toBe('live');
    nightTime();
    await calibrateQuestions(deps);
    const again = await t.pool.query(
      'SELECT count(*)::int AS n FROM question_reports WHERE question_id = ANY($1) AND by_numbers',
      [[hard, easy, wrongKey]],
    );
    expect(again.rows[0].n).toBe(3);
    expect(await status(wrongKey)).toBe('live');
  });
});
