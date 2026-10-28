/**
 * Re-scoring a corrected question (step 2.6b-2, FR-CON-7, the owner's rule): those who picked the
 * new answer in the last 14 days get its points, nobody loses any, a duel's result changes only
 * if the totals flip, and the players are told.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, dailyBoardScore, isoWeek, scoreAnswer } from '@whosabi/game-rules';
import type { AdminQuestion } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { processCorrections } from '../src/content/rescore';
import { ServerEvents } from '../src/events';
import { newId } from '../src/ids';
import type { JobDeps } from '../src/jobs/deps';
import { renderPush, type PushParams } from '../src/push/messages';
import { bearer, createTestApp, signInGuest } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIMIT = DEFAULT_CONFIG['duel.timer_text_s'] * 1000;
const pointsAt = (ms: number) =>
  scoreAnswer({ correct: true, elapsedMs: ms, timeLimitMs: LIMIT, streakBefore: 0 }).points;

let t: Awaited<ReturnType<typeof createTestApp>>;
let deps: JobDeps;
let editor: string;
const DAILY_ID = 990_000 + randomInt(9_000);
const PLAY_DATE = '2027-05-10';
const qid = `q_rescore_${randomInt(1e9)}`;

beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = Date.UTC(2027, 4, 12, 9); // two days after the Daily
  deps = {
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  };
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  const adminId = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    adminId,
    `rescore${randomInt(1e9)}@whosabi.ng`,
    'Editor',
  ]);
  await t.pool.query("INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, 'editor', $2)", [
    adminId,
    SYSTEM_ADMIN_ID,
  ]);
  editor = (await new AdminSessions(t.redis, t.clock.now).create(adminId)).token;
  // Corrections other test files left waiting are done first.
  while ((await processCorrections(deps)) > 0);
  await t.pool.query(
    `INSERT INTO questions (id, category_id, type, text, options, correct_index, difficulty, status, source_url, fact)
     VALUES ($1, 'sport', 'mcq4', $2, $3::jsonb, 0, 3, 'live', 'https://example.com/fact', 'A fact.')`,
    [qid, `Which one is right? (${qid})`, JSON.stringify(['Right', 'Wrong one', 'Wrong two', 'Wrong three'])],
  );
});
afterAll(async () => {
  await t.pool.query('DELETE FROM weekly_standings WHERE iso_week = $1', [isoWeek(PLAY_DATE)]);
  await t.pool.query('DELETE FROM daily_results WHERE daily_id = $1', [DAILY_ID]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = $1', [DAILY_ID]);
  await t.pool.query(
    'DELETE FROM duels WHERE id IN (SELECT duel_id FROM duel_answers WHERE question_id = $1)',
    [qid],
  );
  await t.pool.query('DELETE FROM questions WHERE id = $1', [qid]);
  await t.close();
});

async function named(name: string): Promise<string> {
  const id = (await signInGuest(t.app)).user.id;
  await t.pool.query('UPDATE users SET username = $2 WHERE id = $1', [id, `${name}${randomInt(1e6)}`]);
  return id;
}

/** A duel straight in the database, with each player's answer to the question. */
async function duel(d: {
  a: string;
  b: string;
  state: string;
  scoreA: number;
  scoreB: number;
  winner: string | null;
  picks: Array<{ user: string; chosen: number; ms: number }>;
  servedAgo?: number;
}): Promise<string> {
  const id = newId('d', t.clock.now());
  const served = new Date(t.clock.now() - (d.servedAgo ?? HOUR));
  await t.pool.query(
    `INSERT INTO duels (id, player_a, player_b, source, state, score_a, score_b, winner_id, created_at)
     VALUES ($1, $2, $3, 'friend', $4, $5, $6, $7, $8)`,
    [id, d.a, d.b, d.state, d.scoreA, d.scoreB, d.winner, served],
  );
  for (const p of d.picks) {
    const correct = p.chosen === 0;
    await t.pool.query(
      `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, accepted_elapsed_ms,
                                 chosen_index, correct, points)
       VALUES ($1, 1, 1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, p.user, qid, served, p.ms, p.chosen, correct, correct ? pointsAt(p.ms) : 0],
    );
  }
  return id;
}

async function correctTo(index: number) {
  const q = (
    await t.app.inject({ method: 'GET', url: `/admin/questions/${qid}`, headers: bearer(editor) })
  ).json<AdminQuestion>();
  const res = await t.app.inject({
    method: 'PUT',
    url: `/admin/questions/${qid}`,
    headers: bearer(editor),
    payload: { ...pickInput(q as unknown as Record<string, unknown>), correct_index: index },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** The editable fields of a question, as the console sends them. */
function pickInput(q: Record<string, unknown>) {
  const keys = [
    'category_id',
    'subcategory',
    'type',
    'text',
    'options',
    'correct_index',
    'numeric_answer',
    'fact',
    'difficulty',
    'family_safe',
    'region_tag',
    'valid_until',
    'source_url',
  ];
  return Object.fromEntries(keys.map((k) => [k, q[k]]));
}

const duelRow = async (id: string) =>
  (
    await t.pool.query<{ score_a: number; score_b: number; winner_id: string | null }>(
      'SELECT score_a, score_b, winner_id FROM duels WHERE id = $1',
      [id],
    )
  ).rows[0]!;

describe('re-scoring a corrected question', () => {
  it('gives the new answer its points in duels and the Daily, flips a result, and tells the players', async () => {
    const [ada, bayo, chika, dupe, emeka] = (await Promise.all(
      ['ada', 'bayo', 'chika', 'dupe', 'emeka'].map((n) => named(n)),
    )) as [string, string, string, string, string];
    // Bayo lost 250–300, but picked what is about to become the right answer.
    const flip = await duel({
      a: ada,
      b: bayo,
      state: 'complete',
      scoreA: 300,
      scoreB: 250,
      winner: ada,
      picks: [
        { user: ada, chosen: 0, ms: 3000 },
        { user: bayo, chosen: 1, ms: 4000 },
      ],
    });
    const active = await duel({
      a: ada,
      b: chika,
      state: 'wait_a_r2r3',
      scoreA: 0,
      scoreB: 120,
      winner: null,
      picks: [{ user: chika, chosen: 1, ms: 6000 }],
    });
    const forfeit = await duel({
      a: ada,
      b: chika,
      state: 'forfeit',
      scoreA: 100,
      scoreB: 500,
      winner: ada,
      picks: [{ user: chika, chosen: 1, ms: 5000 }],
    });
    const old = await duel({
      a: ada,
      b: emeka,
      state: 'complete',
      scoreA: 300,
      scoreB: 250,
      winner: ada,
      picks: [{ user: emeka, chosen: 1, ms: 4000 }],
      servedAgo: 20 * DAY,
    });
    const cancelled = await duel({
      a: ada,
      b: emeka,
      state: 'cancelled',
      scoreA: 0,
      scoreB: 0,
      winner: null,
      picks: [{ user: emeka, chosen: 1, ms: 4000 }],
    });

    // A finished Daily: Dupe picked the new answer as question 3; Emeka was ahead.
    await t.pool.query(
      `INSERT INTO daily_challenges (id, play_date, question_ids, locked, snapshot_at) VALUES ($1, $2, $3, true, $4)`,
      [DAILY_ID, PLAY_DATE, ['q_a', 'q_b', qid, 'q_d', 'q_e', 'q_f', 'q_g'], new Date(t.clock.now() - DAY)],
    );
    const dupeAnswers = [true, true, false, true, false, false, false].map((correct, i) => ({
      qid: i === 2 ? qid : `q_${i}`,
      picked: i === 2 ? 1 : correct ? 0 : 3,
      ms: 5000,
      correct,
      points: correct ? 150 : 0,
    }));
    await t.pool.query(
      `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, answers, rank)
       VALUES ($1, $2, 3, 450, 35000, 'GGRGRRR', $3, 2), ($1, $4, 4, 500, 30000, 'GGGGRRR', NULL, 1)`,
      [DAILY_ID, dupe, JSON.stringify(dupeAnswers), emeka],
    );
    await t.pool.query(
      `INSERT INTO weekly_standings (iso_week, user_id, score, dailies, rank) VALUES ($1, $2, 450, 1, 2), ($1, $3, 500, 1, 1)`,
      [isoWeek(PLAY_DATE), dupe, emeka],
    );

    await correctTo(1);
    const queued = await t.pool.query(
      'SELECT old_index, new_index, done_at FROM question_corrections WHERE question_id = $1',
      [qid],
    );
    expect(queued.rows).toEqual([{ old_index: 0, new_index: 1, done_at: null }]);

    expect(await processCorrections(deps)).toBe(1);

    // The duel's totals flipped: Bayo wins now. Ada keeps the points she had.
    expect(await duelRow(flip)).toEqual({ score_a: 300, score_b: 250 + pointsAt(4000), winner_id: bayo });
    const adaAnswer = await t.pool.query(
      'SELECT correct, points FROM duel_answers WHERE duel_id = $1 AND user_id = $2',
      [flip, ada],
    );
    expect(adaAnswer.rows).toEqual([{ correct: true, points: pointsAt(3000) }]);
    // Still being played: the points count; a forfeit stays with the player who waited.
    expect(await duelRow(active)).toEqual({ score_a: 0, score_b: 120 + pointsAt(6000), winner_id: null });
    expect(await duelRow(forfeit)).toEqual({ score_a: 100, score_b: 500 + pointsAt(5000), winner_id: ada });
    // Older than 14 days, or cancelled: left as they were.
    expect(await duelRow(old)).toEqual({ score_a: 300, score_b: 250, winner_id: ada });
    expect(await duelRow(cancelled)).toEqual({ score_a: 0, score_b: 0, winner_id: null });

    // Dupe's Daily: the answer, score, grid, final rank, the week, and the board.
    const daily = (
      await t.pool.query(
        'SELECT score, correct_count, grid, rank, answers FROM daily_results WHERE daily_id = $1 AND user_id = $2',
        [DAILY_ID, dupe],
      )
    ).rows[0];
    expect(daily).toMatchObject({ score: 450 + pointsAt(5000), correct_count: 4, grid: 'GGGGRRR', rank: 1 });
    expect(daily.answers[2]).toEqual({ qid, picked: 1, ms: 5000, correct: true, points: pointsAt(5000) });
    const week = await t.pool.query(
      'SELECT user_id, score, rank FROM weekly_standings WHERE iso_week = $1 ORDER BY rank',
      [isoWeek(PLAY_DATE)],
    );
    expect(week.rows).toEqual([
      { user_id: dupe, score: 450 + pointsAt(5000), rank: 1 },
      { user_id: emeka, score: 500, rank: 2 },
    ]);
    expect(Number(await t.redis.zscore('lb:daily:20270510', dupe))).toBe(
      dailyBoardScore(450 + pointsAt(5000), 35000),
    );

    // Everyone whose games changed is told once.
    const pushes = await t.pool.query<{ user_id: string; params: Record<string, unknown> }>(
      "SELECT user_id, params FROM push_outbox WHERE type = 'content_correction' AND user_id = ANY($1)",
      [[ada, bayo, chika, dupe, emeka]],
    );
    const pushTo = (user: string) => {
      const found = pushes.rows.filter((p) => p.user_id === user);
      expect(found, user).toHaveLength(found.length === 0 ? 0 : 1);
      return found[0]
        ? renderPush({ type: 'content_correction', ...found[0].params } as PushParams, 'en')
        : null;
    };
    expect(pushTo(bayo)).toMatchObject({
      title: expect.stringMatching(/^You won your duel vs ada\d+! 🎉$/),
      url: `/duel/${flip}`,
    });
    expect(pushTo(ada)).toMatchObject({
      title: expect.stringMatching(/^Your duel vs bayo\d+ changed$/),
      url: `/duel/${flip}`,
    });
    expect(pushTo(chika)).toMatchObject({
      title: `+${(pointsAt(6000) + pointsAt(5000)).toLocaleString('en-NG')} points from a corrected question`,
      url: '/home',
    });
    expect(pushTo(dupe)).toMatchObject({ title: `+${pointsAt(5000)} points in Daily #${DAILY_ID}` });
    expect(pushTo(emeka)).toBeNull();

    const history = await t.pool.query(
      "SELECT note FROM question_history WHERE question_id = $1 AND action = 'rescored'",
      [qid],
    );
    expect(history.rows).toEqual([
      { note: '4 answers now right, 3 duels (1 with a new result), 1 Daily result; 4 players told.' },
    ]);

    // Done once.
    expect(await processCorrections(deps)).toBe(0);

    // Corrected back: nobody loses what they were given.
    await correctTo(0);
    expect(await processCorrections(deps)).toBe(1);
    expect(await duelRow(flip)).toEqual({ score_a: 300, score_b: 250 + pointsAt(4000), winner_id: bayo });
    const back = await t.pool.query(
      "SELECT note FROM question_history WHERE question_id = $1 AND action = 'rescored' ORDER BY id DESC LIMIT 1",
      [qid],
    );
    expect(back.rows[0].note).toBe('No games from the last 14 days had the new answer picked.');
  });

  it('queues nothing when the options change too, or for a question nobody has played', async () => {
    const before = await t.pool.query(
      'SELECT count(*)::int AS n FROM question_corrections WHERE question_id = $1',
      [qid],
    );
    const q = (
      await t.app.inject({ method: 'GET', url: `/admin/questions/${qid}`, headers: bearer(editor) })
    ).json<AdminQuestion>();
    const res = await t.app.inject({
      method: 'PUT',
      url: `/admin/questions/${qid}`,
      headers: bearer(editor),
      payload: {
        ...pickInput(q as unknown as Record<string, unknown>),
        options: ['Right', 'Wrong one', 'Wrong two', 'Something new'],
        correct_index: 3,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = await t.pool.query(
      'SELECT count(*)::int AS n FROM question_corrections WHERE question_id = $1',
      [qid],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
