/**
 * Trending questions (step 2.6b-3, GDD §6.2): they leave the game 90 days after going live,
 * unless an editor renews them, through `valid_until` and the nightly expiry.
 */
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, watDate } from '@whosabi/game-rules';
import type { AdminQuestion, AdminQuestionInput, AdminRole } from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { retireExpiredQuestions } from '../src/jobs/contentExpiry';
import { bearer, createTestApp } from './helpers';

const DAY = 86_400_000;

let t: Awaited<ReturnType<typeof createTestApp>>;
let writer: string;
let checker: string;
let editor: string;
const made: string[] = [];

async function staff(role: AdminRole): Promise<string> {
  const id = newId('adm');
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
    id,
    `trend${randomInt(1e9)}@whosabi.ng`,
    role,
  ]);
  await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
    id,
    role,
    SYSTEM_ADMIN_ID,
  ]);
  return (await new AdminSessions(t.redis, t.clock.now).create(id)).token;
}

beforeAll(async () => {
  t = await createTestApp();
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  [writer, checker, editor] = await Promise.all([staff('writer'), staff('fact_checker'), staff('editor')]);
});
afterAll(async () => {
  await t.pool.query('DELETE FROM questions WHERE id = ANY($1)', [made]);
  await t.close();
});

const call = (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });

function input(over: Partial<AdminQuestionInput> = {}): AdminQuestionInput {
  const n = randomInt(1e9);
  return {
    category_id: 'sport',
    subcategory: null,
    type: 'mcq4',
    text: `Which song topped the trending test chart number ${n}?`,
    options: [`Song ${n}`, 'Last Last', 'Calm Down', 'Rush'],
    correct_index: 0,
    numeric_answer: null,
    fact: 'A fact that adds something.',
    difficulty: 2,
    family_safe: true,
    region_tag: 'ALL',
    valid_until: null,
    source_url: 'https://example.com/source',
    trending: false,
    ...over,
  };
}

/** Through the workflow to live: written, checked by someone else, published by an editor. */
async function live(over: Partial<AdminQuestionInput> = {}): Promise<AdminQuestion> {
  const created = await call(writer, 'POST', '/admin/questions', input(over));
  expect(created.statusCode, created.body).toBe(201);
  const id = (created.json() as AdminQuestion).id;
  made.push(id);
  for (const [token, action] of [
    [writer, 'submit'],
    [checker, 'approve'],
    [editor, 'publish'],
  ] as const) {
    const res = await call(token, 'POST', `/admin/questions/${id}/actions`, { action });
    expect(res.statusCode, res.body).toBe(200);
  }
  return detail(id);
}

const detail = async (id: string) =>
  (await call(editor, 'GET', `/admin/questions/${id}`)).json() as AdminQuestion;

describe('trending questions', () => {
  it('leave the game 90 days after going live, unless renewed', async () => {
    const today = watDate(t.clock.now());
    const q = await live({ trending: true });
    expect(q).toMatchObject({ status: 'live', trending: true, valid_until: addDays(today, 90) });
    // One that isn't trending keeps no end date.
    expect((await live()).valid_until).toBeNull();
    // Its own sooner date stays.
    expect((await live({ trending: true, valid_until: addDays(today, 10) })).valid_until).toBe(
      addDays(today, 10),
    );

    // A month on, an editor renews it: 90 days from then.
    t.clock.advance(30 * DAY);
    const later = watDate(t.clock.now());
    expect((await call(writer, 'POST', `/admin/questions/${q.id}/renew`)).statusCode).toBe(403);
    const renewed = await call(editor, 'POST', `/admin/questions/${q.id}/renew`);
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(renewed.json()).toMatchObject({ valid_until: addDays(later, 90) });
    expect((renewed.json() as AdminQuestion).history[0]).toMatchObject({
      action: 'renewed',
      note: `In the game until ${addDays(later, 90)}.`,
    });

    // Not renewed again: the nightly expiry takes it out after its last day.
    t.clock.advance(91 * DAY);
    expect(await retireExpiredQuestions({ pool: t.pool, clock: t.clock })).toBeGreaterThanOrEqual(1);
    expect((await detail(q.id)).status).toBe('retired');
  });

  it('starts the 90 days when a live question is marked trending, and renews only trending ones', async () => {
    const today = watDate(t.clock.now());
    const q = await live();
    const notTrending = await call(editor, 'POST', `/admin/questions/${q.id}/renew`);
    expect([notTrending.statusCode, notTrending.json().detail]).toEqual([
      409,
      'Only trending questions are renewed. Mark it trending first.',
    ]);

    const { id: _id, ...rest } = q as unknown as Record<string, unknown>;
    const edited = await call(editor, 'PUT', `/admin/questions/${q.id}`, {
      ...pick(rest),
      trending: true,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ trending: true, valid_until: addDays(today, 90) });
  });
});

/** The fields of a question an edit sends. */
function pick(q: Record<string, unknown>): Partial<AdminQuestionInput> {
  const keys = Object.keys(input()) as Array<keyof AdminQuestionInput>;
  return Object.fromEntries(keys.map((k) => [k, q[k]]));
}
