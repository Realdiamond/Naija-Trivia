import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerEvents } from '../src/events';
import { newId } from '../src/ids';
import { checkIntegrity } from '../src/jobs/integrity';
import type { JobDeps } from '../src/jobs/deps';
import { createTestApp, signInGuest } from './helpers';

const SECOND = 1000;
const HOUR = 3_600_000;
// A week no other test file plays in: Tuesday 5 October 2027, 04:10 WAT.
const NIGHT = Date.UTC(2027, 9, 5, 3, 10);

let t: Awaited<ReturnType<typeof createTestApp>>;
let deps: JobDeps;
const questions: string[] = [];
const players: string[] = [];
beforeAll(async () => {
  t = await createTestApp();
  deps = {
    pool: t.pool,
    redis: t.redis,
    clock: t.clock,
    events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
    log: t.app.log,
  };
  // Hard questions (30% of players right) in a category the game never serves.
  await t.pool.query(
    `INSERT INTO categories (id, name_en, active, sort_order) VALUES ('integrity_test', 'Integrity test', false, 99)
     ON CONFLICT (id) DO NOTHING`,
  );
  for (let i = 0; i < 40; i++) {
    const id = `q_integrity_${randomInt(1e9)}`;
    questions.push(id);
    await t.pool.query(
      `INSERT INTO questions (id, category_id, type, text, options, correct_index, difficulty, status, source_url)
       VALUES ($1, 'integrity_test', 'mcq4', $2, $3::jsonb, 0, 4, 'retired', 'https://example.com/fact')`,
      [id, `Hard one (${id})`, JSON.stringify(['Right', 'Wrong one', 'Wrong two', 'Wrong three'])],
    );
    await t.pool.query('INSERT INTO question_stats (question_id, plays, correct) VALUES ($1, 100, 30)', [id]);
  }
});
afterAll(async () => {
  await t.pool.query('DELETE FROM integrity_flags WHERE user_id = ANY($1)', [players]);
  await t.pool.query('DELETE FROM duels WHERE player_a = ANY($1)', [players]);
  await t.pool.query("DELETE FROM staff_alerts WHERE url = '/integrity'");
  await t.pool.query('DELETE FROM questions WHERE id = ANY($1)', [questions]);
  await t.pool.query("DELETE FROM categories WHERE id = 'integrity_test'");
  await t.pool.query("UPDATE users SET last_seen_at = NULL WHERE last_seen_at >= '2027-09-01'");
  await t.close();
});

interface Answer {
  correct: boolean;
  /** What the app said, and what the server saw (from serve to answer). */
  clientMs?: number;
  serverMs?: number;
  platform?: 'android' | 'web';
  tabHiddenMs?: number;
}

/** One duel against another player, with these answers by `userId`, the day before the night. */
async function played(userId: string, answers: Answer[]) {
  const opponent = (await signInGuest(t.app)).user.id;
  const duel = newId('d');
  await t.pool.query(
    `INSERT INTO duels (id, player_a, player_b, source, state, created_at, completed_at)
     VALUES ($1, $2, $3, 'friend', 'complete', $4, $4)`,
    [duel, userId, opponent, new Date(NIGHT - 24 * HOUR)],
  );
  for (const [i, a] of answers.entries()) {
    const served = NIGHT - 24 * HOUR + i * 30 * SECOND;
    const serverMs = a.serverMs ?? 4000;
    await t.pool.query(
      `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, received_at,
                                 client_elapsed_ms, accepted_elapsed_ms, rtt_est_ms, correct, points, platform,
                                 tab_hidden_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 200, $10, 0, $11, $12)`,
      [
        duel,
        Math.floor(i / 3) + 1,
        (i % 3) + 1,
        userId,
        questions[i % questions.length],
        new Date(served),
        new Date(served + serverMs),
        a.clientMs ?? serverMs - 200,
        a.clientMs ?? serverMs - 200,
        a.correct,
        a.platform ?? 'android',
        a.tabHiddenMs ?? null,
      ],
    );
  }
}

async function player(): Promise<string> {
  const id = (await signInGuest(t.app)).user.id;
  players.push(id);
  return id;
}

const flagsOf = async (userId: string) =>
  (
    await t.pool.query<{ kind: string; score: number; evidence: Record<string, number> }>(
      'SELECT kind, score, evidence FROM integrity_flags WHERE user_id = $1',
      [userId],
    )
  ).rows;

describe('the nightly integrity checks (step 2.7e)', () => {
  it('flags what stands out, once a night and once a week per player, and tells the staff', async () => {
    t.clock.t = NIGHT - 2 * HOUR;
    const honest = await player();
    const reader = await player();
    const fastClock = await player();
    const tabber = await player();

    // About as many right as the questions allow, at human speeds.
    await played(
      honest,
      Array.from({ length: 40 }, (_, i) => ({ correct: i % 3 === 0, serverMs: 3000 + (i % 7) * 900 })),
    );
    // Every hard question right in just over 2 seconds, every time.
    await played(
      reader,
      Array.from({ length: 40 }, (_, i) => ({ correct: true, serverMs: 2100 + (i % 2) * 100 })),
    );
    // The app says 1 s when the server saw 8.
    await played(
      fastClock,
      Array.from({ length: 25 }, (_, i) => ({ correct: i % 3 === 0, clientMs: 1000, serverMs: 8000 })),
    );
    // On the web: right whenever the tab was hidden, mostly wrong otherwise.
    await played(
      tabber,
      Array.from({ length: 30 }, (_, i) => ({
        correct: i % 2 === 0 || i % 5 === 0,
        platform: 'web' as const,
        tabHiddenMs: i % 2 === 0 ? 6000 : 0,
      })),
    );

    // 03:10 WAT: too early.
    t.clock.t = NIGHT - HOUR;
    expect(await checkIntegrity(deps)).toBeNull();
    t.clock.t = NIGHT;
    const first = await checkIntegrity(deps);
    expect(first).toMatchObject({ flagged: 3 });
    expect(await checkIntegrity(deps)).toBeNull();

    expect(await flagsOf(honest)).toEqual([]);
    expect(await flagsOf(reader)).toEqual([
      {
        kind: 'accuracy_outlier',
        score: 1,
        evidence: expect.objectContaining({
          answers: 40,
          accuracy: 1,
          expected_accuracy: 0.3,
          hard_answers: 40,
        }),
      },
    ]);
    expect(await flagsOf(fastClock)).toEqual([
      {
        kind: 'timing_anomaly',
        score: expect.closeTo(0.77, 2),
        evidence: { answers: 25, median_gap_ms: 6800 },
      },
    ]);
    expect((await flagsOf(tabber)).map((f) => f.kind)).toEqual(['tab_hidden']);

    const alerts = await t.pool.query("SELECT title, body FROM staff_alerts WHERE url = '/integrity'");
    expect(alerts.rows).toEqual([
      {
        title: '3 new integrity flags',
        body: 'The nightly checks found players worth a look (highest risk 100%). Nothing was done automatically.',
      },
    ]);

    // The next night finds the same, but a player is flagged for a thing at most once a week.
    t.clock.t = NIGHT + 24 * HOUR;
    expect(await checkIntegrity(deps)).toMatchObject({ flagged: 0 });
    expect((await flagsOf(reader)).length).toBe(1);
  });
});
