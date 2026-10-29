import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminDailyCalendar,
  AdminDailyCandidates,
  AdminDailyDay,
  AdminDailyPlanResponse,
  AdminRole,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { bearer, createTestApp } from './helpers';

const HOUR = 3_600_000;
// A month no other test file plays in: Monday 7 February 2028, 10:00 WAT.
const NOW = Date.UTC(2028, 1, 7, 9, 0);

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp();
  t.clock.t = NOW;
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(async () => {
  await t.pool.query("DELETE FROM daily_challenges WHERE play_date BETWEEN '2028-02-01' AND '2028-03-31'");
  await t.close();
});

async function staff(roles: AdminRole[]): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `daily-${randomInt(1e9)}@whosabi.ng`,
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

const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (token: string, url: string, payload: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(token), payload });

describe('the Daily scheduler (step 2.7f)', () => {
  it('plans the next 30 Dailies; today is fixed, later ones open to swaps until 22:00 the day before', async () => {
    const liveops = await staff(['liveops']);
    const support = await staff(['support']);
    expect((await get(support, '/admin/daily')).statusCode).toBe(403);

    const before = (await get(liveops, '/admin/daily')).json() as AdminDailyCalendar;
    expect(before.today).toBe('2028-02-07');
    expect(before.days).toHaveLength(30);
    expect(before.days.every((d) => d.id === null)).toBe(true);

    expect((await post(liveops, '/admin/daily/plan', {})).statusCode).toBe(400);
    const plan = (
      await post(liveops, '/admin/daily/plan', { reason: 'Plan February' })
    ).json() as AdminDailyPlanResponse;
    expect(plan).toEqual({ planned: 30, short: [] });
    expect(
      ((await post(liveops, '/admin/daily/plan', { reason: 'Again' })).json() as AdminDailyPlanResponse)
        .planned,
    ).toBe(0);

    const after = (await get(liveops, '/admin/daily')).json() as AdminDailyCalendar;
    const [today, tomorrow, later] = after.days;
    expect([today!.editable, tomorrow!.editable, later!.editable]).toEqual([false, true, true]);
    expect(today!.locked).toBe(true);
    // Numbered by calendar day, one after another.
    expect(after.days.map((d) => d.id! - today!.id!)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    for (const day of after.days) {
      expect(day.questions).toHaveLength(7);
      expect(new Set(day.questions.map((q) => q.id)).size).toBe(7);
    }
    expect(later!.questions[0]).toMatchObject({
      text: expect.any(String),
      options: expect.any(Array),
      correct_index: expect.any(Number),
    });
  });

  it('swaps a question for one that fits, with a reason, and not once the Daily is fixed', async () => {
    const liveops = await staff(['liveops']);
    const date = '2028-02-10';
    const day = (await get(liveops, `/admin/daily/${date}`)).json() as AdminDailyDay;
    const third = day.questions[2]!;

    const options = (
      await get(liveops, `/admin/daily/${date}/candidates?slot=3`)
    ).json() as AdminDailyCandidates;
    expect(options.candidates.length).toBeGreaterThan(0);
    expect(options.candidates.some((c) => day.questions.some((q) => q.id === c.id))).toBe(false);
    // The same category first, when there is one.
    if (options.candidates.some((c) => c.category === third.category)) {
      expect(options.candidates[0]!.category).toBe(third.category);
    }

    const pick = options.candidates[0]!;
    const swapped = await post(liveops, `/admin/daily/${date}/swap`, {
      slot: 3,
      question_id: pick.id,
      reason: 'Too close to last week',
    });
    expect(swapped.statusCode, swapped.body).toBe(200);
    expect((swapped.json() as AdminDailyDay).questions[2]!.id).toBe(pick.id);
    const audit = await t.pool.query(
      "SELECT reason, before, after FROM admin_audit_log WHERE action = 'swap_daily_question' ORDER BY id DESC LIMIT 1",
    );
    expect(audit.rows[0]).toMatchObject({
      reason: 'Too close to last week',
      before: { date, slot: 3, question: third.id },
      after: { date, slot: 3, question: pick.id },
    });

    const again = await post(liveops, `/admin/daily/${date}/swap`, {
      slot: 4,
      question_id: pick.id,
      reason: 'Twice',
    });
    expect(again.statusCode).toBe(409);
    const notOne = await post(liveops, `/admin/daily/${date}/swap`, {
      slot: 4,
      question_id: 'q_no_such_question',
      reason: 'Nope',
    });
    expect(notOne.statusCode).toBe(400);

    // Today's is fixed, and tomorrow's from 22:00 WAT.
    const other = options.candidates[1]!;
    expect(
      (
        await post(liveops, '/admin/daily/2028-02-07/swap', {
          slot: 1,
          question_id: other.id,
          reason: 'Late',
        })
      ).statusCode,
    ).toBe(409);
    t.clock.t = NOW + 12.5 * HOUR; // 22:30 WAT
    const late = await post(liveops, '/admin/daily/2028-02-08/swap', {
      slot: 1,
      question_id: other.id,
      reason: 'Late',
    });
    expect([late.statusCode, late.json().title]).toEqual([409, 'Too late to change']);
    t.clock.t = NOW;
  });
});
