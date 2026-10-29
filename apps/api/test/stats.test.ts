/**
 * The Profile screen's numbers (build plan step 2.11): duels and how they ended, the Daily and
 * its streak, party games, practice games, and right answers by category. A month no other test
 * file plays in: October 2028.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MyStats } from '@whosabi/shared-types';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const october = (day: number, hour: number) => Date.UTC(2028, 9, day, hour - 1);

let t: Awaited<ReturnType<typeof createTestApp>>;
const made = {
  users: [] as string[],
  questions: [] as string[],
  duels: [] as string[],
  games: [] as string[],
  daily: 0,
};

beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = october(20, 10);
});

afterAll(async () => {
  await t.pool.query('DELETE FROM duels WHERE id = ANY($1)', [made.duels]);
  await t.pool.query('DELETE FROM party_games WHERE id = ANY($1)', [made.games]);
  await t.pool.query('DELETE FROM daily_results WHERE daily_id = $1', [made.daily]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = $1', [made.daily]);
  await t.pool.query('DELETE FROM practice_results WHERE user_id = ANY($1)', [made.users]);
  await t.pool.query('DELETE FROM streaks WHERE user_id = ANY($1)', [made.users]);
  await t.pool.query('DELETE FROM questions WHERE id = ANY($1)', [made.questions]);
  await t.close();
});

async function question(category: string): Promise<string> {
  const id = `q_stats_${randomInt(1e9)}`;
  made.questions.push(id);
  await t.pool.query(
    `INSERT INTO questions (id, category_id, type, text, options, correct_index, difficulty, status)
     VALUES ($1, $2, 'mcq4', $3, '["A","B","C","D"]'::jsonb, 0, 2, 'live')`,
    [id, category, `Stats question ${id}?`],
  );
  return id;
}

describe('my stats (step 2.11)', () => {
  it('counts duels, Dailies, party and practice games, and right answers by category', async () => {
    const me = await signInGuest(t.app, 'android');
    const them = await signInGuest(t.app, 'android');
    made.users.push(me.user.id, them.user.id);
    const [food1, food2, music] = [await question('food'), await question('food'), await question('music')];

    // Won, lost, drawn and forfeited (by them); one still going doesn't count.
    const at = new Date(october(19, 12));
    for (const [state, winner] of [
      ['complete', me.user.id],
      ['complete', them.user.id],
      ['complete', null],
      ['forfeit', me.user.id],
      ['wait_b_r1r2', null],
    ] as const) {
      const id = newId('d');
      made.duels.push(id);
      await t.pool.query(
        `INSERT INTO duels (id, player_a, player_b, source, state, winner_id, created_at, completed_at)
         VALUES ($1, $2, $3, 'friend', $4, $5, $6, $6)`,
        [id, me.user.id, them.user.id, state, winner, at],
      );
    }
    // Three answers in the first duel: two food (one right), one music (right); and theirs, not mine.
    for (const [seq, qid, correct, user] of [
      [1, food1, true, me.user.id],
      [2, food2, false, me.user.id],
      [3, music, true, me.user.id],
      [1, food1, true, them.user.id],
    ] as const) {
      await t.pool.query(
        `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, received_at, correct)
         VALUES ($1, 1, $2, $3, $4, $5, $5, $6)`,
        [made.duels[0], seq, user, qid, at, correct],
      );
    }
    // A Daily with two answers (food right, music wrong), on a streak of 3 played yesterday.
    made.daily = 960_000 + randomInt(10_000);
    await t.pool.query(
      `INSERT INTO daily_challenges (id, play_date, question_ids) VALUES ($1, '2028-10-19', $2)`,
      [made.daily, [food1, music, 'x3', 'x4', 'x5', 'x6', 'x7']],
    );
    await t.pool.query(
      `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, completed_at, answers)
       VALUES ($1, $2, 1, 300, 30000, 'GRRRRRR', $3, $4)`,
      [
        made.daily,
        me.user.id,
        at,
        JSON.stringify([
          { qid: food1, picked: 0, ms: 3000, correct: true, points: 180 },
          { qid: music, picked: 1, ms: 4000, correct: false, points: 0 },
        ]),
      ],
    );
    await t.pool.query(
      `INSERT INTO streaks (user_id, current, best, last_play_date) VALUES ($1, 3, 5, '2028-10-19')`,
      [me.user.id],
    );
    // Two party games, one won; and a practice game.
    for (const rank of [1, 3]) {
      const game = newId('pg');
      made.games.push(game);
      await t.pool.query(
        `INSERT INTO party_games (id, room_code, settings, player_count, started_at, ended_at, questions)
         VALUES ($1, 'STATS', '{}', 3, $2, $2, 10)`,
        [game, at],
      );
      await t.pool.query(
        `INSERT INTO party_results (game_id, player_ref, user_id, rank, score, correct_count, name, kind)
         VALUES ($1, $2, $2, $3, 500, 5, 'Me', 'app')`,
        [game, me.user.id, rank],
      );
    }
    await t.pool.query(
      `INSERT INTO practice_results (user_id, id, pack_id, week, answered, correct, complete, xp, played_at, received_at)
       VALUES ($1, $2, 'pk_core_food', '2028-W42', 10, 6, true, 118, $3, $3)`,
      [me.user.id, randomUUID(), at],
    );

    const res = await t.app.inject({ method: 'GET', url: '/v1/me/stats', headers: bearer(me.access) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json() as MyStats).toEqual({
      duels: { played: 4, won: 2, lost: 1, drawn: 1 },
      daily: { played: 1, streak: 3, best_streak: 5 },
      party: { played: 2, won: 1 },
      practice: { games: 1 },
      categories: [
        { category_id: 'food', answered: 3, correct: 2 },
        { category_id: 'music', answered: 2, correct: 1 },
      ],
    });

    // Three days later, with no freeze to save it, the streak shows 0 (the best stays).
    t.clock.t = october(23, 10);
    const later = await signInGuest(t.app, 'android', me.deviceId);
    const stats = (
      await t.app.inject({ method: 'GET', url: '/v1/me/stats', headers: bearer(later.access) })
    ).json();
    expect(stats.daily).toEqual({ played: 1, streak: 0, best_streak: 5 });

    // A new player has nothing yet.
    const fresh = await signInGuest(t.app, 'web');
    made.users.push(fresh.user.id);
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/me/stats', headers: bearer(fresh.access) })).json(),
    ).toEqual({
      duels: { played: 0, won: 0, lost: 0, drawn: 0 },
      daily: { played: 0, streak: 0, best_streak: 0 },
      party: { played: 0, won: 0 },
      practice: { games: 0 },
      categories: [],
    });
  });
});
