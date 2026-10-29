/**
 * Retention and compliance (build plan step 2.7n): the nightly job removes what doc 08 §4 says
 * to, records each run, and the console shows it next to consent rates and the access review.
 * The clock is 1 January 2027: its cutoffs fall before any other test file's data.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminComplianceOverview, AdminRole } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { ServerEvents } from '../src/events';
import { newId } from '../src/ids';
import { applyRetention } from '../src/jobs/retention';
import { bearer, createTestApp, signInGuest } from './helpers';

/** 1 January 2027 at a WAT hour. */
const jan1 = (hour: number) => Date.UTC(2027, 0, 1, hour - 1);
const OLD = new Date('2024-06-01T10:00:00Z');
const RECENT = new Date('2026-12-01T10:00:00Z');
const DAILY_IDS = [9_000_801, 9_000_802];

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
const made = { users: [] as string[], duels: [] as string[], parties: [] as string[] };
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = jan1(2);
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(async () => {
  await t.pool.query('DELETE FROM duels WHERE id = ANY($1)', [made.duels]);
  await t.pool.query('DELETE FROM party_games WHERE id = ANY($1)', [made.parties]);
  await t.pool.query('DELETE FROM daily_results WHERE daily_id = ANY($1)', [DAILY_IDS]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = ANY($1)', [DAILY_IDS]);
  await t.pool.query('DELETE FROM integrity_flags WHERE user_id = ANY($1)', [made.users]);
  await t.pool.query('DELETE FROM consent_records WHERE user_id = ANY($1)', [made.users]);
  await t.pool.query('DELETE FROM retention_runs');
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `compliance-${randomInt(1e9)}@whosabi.ng`,
    roles.join('+'),
  ]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  return (await sessions.create(id)).token;
}

const jobs = () => ({
  pool: t.pool,
  redis: t.redis,
  clock: t.clock,
  events: new ServerEvents(t.redis, t.config.analyticsKey, t.clock, t.app.log),
  log: t.app.log,
});

const exists = async (sql: string, args: unknown[]) => ((await t.pool.query(sql, args)).rowCount ?? 0) > 0;

describe('retention and compliance (step 2.7n)', () => {
  it('removes what is past its time each night, keeps the rest, and records each run', async () => {
    const [a, b] = [(await signInGuest(t.app)).user.id, (await signInGuest(t.app)).user.id];
    made.users.push(a, b);
    const question = (
      await t.pool.query<{ id: string }>("SELECT id FROM questions WHERE status = 'live' LIMIT 1")
    ).rows[0]!.id;

    // A duel with an answer from May 2026 (past 180 days) and one from December (not yet).
    const duel = newId('d');
    made.duels.push(duel);
    await t.pool.query(
      `INSERT INTO duels (id, player_a, player_b, source, state, created_at, completed_at)
       VALUES ($1, $2, $3, 'friend', 'complete', $4, $4)`,
      [duel, a, b, new Date('2026-05-01T10:00:00Z')],
    );
    for (const [seq, servedAt] of [
      [1, new Date('2026-05-01T10:00:00Z')],
      [2, RECENT],
    ] as const) {
      await t.pool.query(
        `INSERT INTO duel_answers (duel_id, round_no, seq, user_id, question_id, served_at, client_elapsed_ms,
                                   accepted_elapsed_ms, rtt_est_ms, tab_hidden_ms, correct, points)
         VALUES ($1, 1, $2, $3, $4, $5, 3000, 3100, 120, 0, true, 100)`,
        [duel, seq, a, question, servedAt],
      );
    }
    for (const at of [OLD, RECENT]) {
      const game = newId('pg');
      made.parties.push(game);
      await t.pool.query(
        `INSERT INTO party_games (id, room_code, settings, player_count, started_at, ended_at, questions)
         VALUES ($1, 'ZZZZZ', '{}', 1, $2, $2, 10)`,
        [game, at],
      );
      await t.pool.query(
        `INSERT INTO integrity_flags (user_id, kind, score, evidence, created_at)
         VALUES ($1, 'timing_anomaly', 0.5, '{}', $2)`,
        [a, at],
      );
    }
    for (const [id, at] of [
      [DAILY_IDS[0]!, OLD],
      [DAILY_IDS[1]!, RECENT],
    ] as const) {
      await t.pool.query(
        `INSERT INTO daily_challenges (id, play_date, question_ids, locked) VALUES ($1, $2::date, $3, true)`,
        [id, at.toISOString().slice(0, 10), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']],
      );
      await t.pool.query(
        `INSERT INTO daily_results (daily_id, user_id, correct_count, score, total_ms, grid, completed_at)
         VALUES ($1, $2, 7, 900, 60000, 'GGGGGGG', $3)`,
        [id, a, at],
      );
    }
    for (const at of [OLD, RECENT]) {
      await t.pool.query(
        `INSERT INTO practice_sets (user_id, pack_id, week, question_ids, issued_at)
         VALUES ($1, 'pk_core_slang', $2, '{}', $3)`,
        [a, `W-${at.getTime()}`, at],
      );
      await t.pool.query(
        `INSERT INTO practice_results (user_id, id, pack_id, week, answered, correct, complete, xp, played_at, received_at)
         VALUES ($1, $2, 'pk_core_slang', 'W', 10, 5, true, 110, $3, $3)`,
        [a, randomUUID(), at],
      );
    }
    const oldReport = (
      await t.pool.query<{ id: string }>(
        `INSERT INTO question_reports (question_id, reason, note, created_at) VALUES ($1, 'typo', $2, $3) RETURNING id`,
        [question, `old ${randomUUID()}`, OLD],
      )
    ).rows[0]!.id;
    // Consent records: of an account deleted in 2020 (over 6 years ago) and of one still here.
    await t.pool.query("UPDATE users SET status = 'deleted', deleted_at = '2020-01-01' WHERE id = $1", [b]);
    for (const user of [a, b]) {
      await t.pool.query(
        `INSERT INTO consent_records (user_id, purpose, granted, policy_version, source, created_at)
         VALUES ($1, 'analytics', true, '2026-10', 'onboarding', $2)`,
        [user, OLD],
      );
    }

    // Before 03:00 WAT, nothing; after, once a night.
    expect(await applyRetention(jobs())).toBeNull();
    t.clock.t = jan1(4);
    const removed = await applyRetention(jobs());
    expect(Object.keys(removed!)).toEqual([
      'duel_timing',
      'party_results',
      'daily_results',
      'practice_sets',
      'practice_results',
      'integrity_flags',
      'question_reports',
      'consent_records',
    ]);
    for (const n of Object.values(removed!)) expect(n).toBeGreaterThanOrEqual(1);
    expect(await applyRetention(jobs())).toBeNull();

    // The old answer keeps its points and server time, without the raw timing; the new one is untouched.
    const answers = await t.pool.query(
      `SELECT seq, client_elapsed_ms, accepted_elapsed_ms, rtt_est_ms, tab_hidden_ms, correct, points
         FROM duel_answers WHERE duel_id = $1 ORDER BY seq`,
      [duel],
    );
    expect(answers.rows).toEqual([
      {
        seq: 1,
        client_elapsed_ms: null,
        accepted_elapsed_ms: 3100,
        rtt_est_ms: null,
        tab_hidden_ms: null,
        correct: true,
        points: 100,
      },
      {
        seq: 2,
        client_elapsed_ms: 3000,
        accepted_elapsed_ms: 3100,
        rtt_est_ms: 120,
        tab_hidden_ms: 0,
        correct: true,
        points: 100,
      },
    ]);
    expect(await exists('SELECT 1 FROM party_games WHERE id = $1', [made.parties[0]])).toBe(false);
    expect(await exists('SELECT 1 FROM party_games WHERE id = $1', [made.parties[1]])).toBe(true);
    expect(await exists('SELECT 1 FROM daily_results WHERE daily_id = $1', [DAILY_IDS[0]])).toBe(false);
    expect(await exists('SELECT 1 FROM daily_results WHERE daily_id = $1', [DAILY_IDS[1]])).toBe(true);
    expect(
      (await t.pool.query('SELECT created_at FROM integrity_flags WHERE user_id = $1', [a])).rows,
    ).toEqual([{ created_at: RECENT }]);
    expect(await exists('SELECT 1 FROM question_reports WHERE id = $1', [oldReport])).toBe(false);
    expect(await exists('SELECT 1 FROM consent_records WHERE user_id = $1', [b])).toBe(false);
    expect(await exists('SELECT 1 FROM consent_records WHERE user_id = $1', [a])).toBe(true);

    const runs = await t.pool.query<{ rule: string; cutoff: Date }>(
      "SELECT rule, cutoff FROM retention_runs WHERE rule IN ('duel_timing', 'daily_results') ORDER BY rule",
    );
    expect(runs.rows).toEqual([
      { rule: 'daily_results', cutoff: new Date(jan1(4) - 730 * 86_400_000) },
      { rule: 'duel_timing', cutoff: new Date(jan1(4) - 180 * 86_400_000) },
    ]);
  });

  it('shows data kept, consent rates and the staff list; the DPO records the access review', async () => {
    const get = async (token: string) =>
      t.app.inject({ method: 'GET', url: '/admin/compliance/overview', headers: bearer(token) });
    expect((await get(await staff(['support']))).statusCode).toBe(403);
    const dpo = await staff(['dpo']);
    const before = (await get(dpo)).json() as AdminComplianceOverview;

    const timing = before.retention.find((r) => r.rule === 'duel_timing')!;
    expect(timing).toMatchObject({
      by: 'retention job',
      last_run_at: new Date(jan1(4)).toISOString(),
      behind: false,
    });
    expect(timing.last_rows).toBeGreaterThanOrEqual(1);
    expect(before.retention.map((r) => r.rule)).toEqual([
      'duel_timing',
      'party_results',
      'daily_results',
      'practice_sets',
      'practice_results',
      'analytics_events',
      'integrity_flags',
      'question_reports',
      'consent_records',
      'admin_audit_log',
    ]);
    expect(before.retention.find((r) => r.rule === 'admin_audit_log')).toMatchObject({
      by: 'kept',
      cutoff: null,
    });
    expect(before.consent.find((c) => c.purpose === 'analytics')?.answered).toBeGreaterThanOrEqual(1);
    expect(before.access.staff.some((s) => s.roles.some((r) => r.role === 'dpo'))).toBe(true);

    // Admins see it all but the DPO (or an owner) confirms the review.
    const review = (token: string, note: string) =>
      t.app.inject({
        method: 'POST',
        url: '/admin/compliance/access-review',
        headers: bearer(token),
        payload: { note },
      });
    expect((await review(await staff(['admin']), 'Looks fine')).statusCode).toBe(403);
    expect((await review(dpo, 'x')).statusCode).toBe(400);
    expect((await review(dpo, 'Q4 2026: removed one contractor, rest fine')).statusCode).toBe(204);
    const after = (await get(dpo)).json() as AdminComplianceOverview;
    expect(after.access.last_review).toMatchObject({ note: 'Q4 2026: removed one contractor, rest fine' });
    expect(after.access.due).toBe(false);
  });
});
