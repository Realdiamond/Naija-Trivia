/**
 * Packs and Solo Practice (build plan step 2.8f): the catalogue, unlocking a coins pack, the
 * week's practice set with its answers, practice results paying XP up to a daily cap, a guest's
 * packs following them into their account, and the console's Packs page.
 * The clock is December 2028 (after the analytics tests' months, before the Segments test's), and
 * the questions are in this file's own category.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminPack,
  AdminPackDetail,
  AdminPackQuestionsAdded,
  AdminRole,
  PackUnlockResponse,
  PacksResponse,
  PracticeResultResponse,
  PracticeSet,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { withTransaction } from '../src/db';
import { grantCoins } from '../src/economy/ledger';
import { newId } from '../src/ids';
import { bearer, createTestApp, signInGuest } from './helpers';

const CATEGORY = 'practice_test';
/** December 2028 at a WAT hour. */
const december = (day: number, hour: number) => Date.UTC(2028, 11, day, hour - 1);

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
const made = { users: [] as string[], questions: [] as string[], packs: [] as string[], daily: 0 };
/** 14 live questions (2 not family-safe), plus one in tomorrow's Daily. */
let core: string;
/** 12 chosen questions, for 300 coins. */
let premium: string;
let dailyQuestion: string;

async function question(n: number, options: { familySafe?: boolean; status?: string } = {}): Promise<string> {
  const id = `q_practice_${randomInt(1e9)}`;
  made.questions.push(id);
  await t.pool.query(
    `INSERT INTO questions (id, external_ref, category_id, type, text, options, correct_index, difficulty, status,
                            family_safe, fact)
     VALUES ($1, $2, $3, 'mcq4', $4, $5::jsonb, $6, 2, $7, $8, 'A fact.')`,
    [
      id,
      `PRAC-${id}`,
      CATEGORY,
      `Practice question ${n}? (${id})`,
      JSON.stringify(['One', 'Two', 'Three', 'Four']),
      n % 4,
      options.status ?? 'live',
      options.familySafe ?? true,
    ],
  );
  return id;
}

async function pack(fields: {
  access?: string;
  price?: number | null;
  category?: string | null;
  active?: boolean;
  starts?: number;
}): Promise<string> {
  const id = newId('pk');
  made.packs.push(id);
  await t.pool.query(
    `INSERT INTO packs (id, slug, title, access, price_coins, category_id, active, starts_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      `practice-${randomInt(1e9)}`,
      `Pack ${id}`,
      fields.access ?? 'free',
      fields.price ?? null,
      fields.category ?? null,
      fields.active ?? true,
      fields.starts ? new Date(fields.starts) : null,
      new Date(december(1, 9)),
    ],
  );
  return id;
}

beforeAll(async () => {
  t = await createTestApp();
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
  await t.pool.query(
    `INSERT INTO categories (id, name_en, active, sort_order) VALUES ($1, 'Practice test', true, 98)
     ON CONFLICT (id) DO NOTHING`,
    [CATEGORY],
  );
  t.clock.t = december(13, 10);
  for (let n = 0; n < 12; n++) await question(n);
  for (let n = 12; n < 14; n++) await question(n, { familySafe: false });
  await question(14, { status: 'draft' });
  dailyQuestion = await question(15);
  core = await pack({ category: CATEGORY });
  // The premium pack's own questions are drafts to everyone else: only chosen ones count.
  premium = await pack({ access: 'coins', price: 300 });
  const chosen = made.questions.slice(0, 12);
  await t.pool.query('INSERT INTO pack_questions (pack_id, question_id) SELECT $1, unnest($2::text[])', [
    premium,
    chosen,
  ]);
  made.daily = 950_000 + randomInt(10_000);
  await t.pool.query(
    `INSERT INTO daily_challenges (id, play_date, question_ids) VALUES ($1, '2028-12-14', $2)`,
    [made.daily, [dailyQuestion, 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']],
  );
});

afterAll(async () => {
  const users = made.users;
  await t.pool.query('DELETE FROM practice_results WHERE user_id = ANY($1)', [users]);
  await t.pool.query('DELETE FROM practice_sets WHERE user_id = ANY($1)', [users]);
  await t.pool.query('DELETE FROM pack_unlocks WHERE user_id = ANY($1)', [users]);
  await t.pool.query('DELETE FROM user_question_seen WHERE user_id = ANY($1)', [users]);
  const txs = (
    await t.pool.query<{ transaction_id: string }>(
      `SELECT DISTINCT e.transaction_id FROM ledger_entries e JOIN ledger_accounts l ON l.id = e.account_id
        WHERE l.owner_user_id = ANY($1)`,
      [users],
    )
  ).rows.map((r) => r.transaction_id);
  await t.pool.query('DELETE FROM ledger_entries WHERE transaction_id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_transactions WHERE id = ANY($1)', [txs]);
  await t.pool.query('DELETE FROM ledger_accounts WHERE owner_user_id = ANY($1)', [users]);
  await t.pool.query('DELETE FROM daily_challenges WHERE id = $1', [made.daily]);
  const packs = (
    await t.pool.query<{ id: string }>('SELECT id FROM packs WHERE id = ANY($1) OR category_id = $2', [
      made.packs,
      CATEGORY,
    ])
  ).rows.map((r) => r.id);
  await t.pool.query('DELETE FROM packs WHERE id = ANY($1)', [packs]);
  await t.pool.query('DELETE FROM questions WHERE category_id = $1', [CATEGORY]);
  await t.pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY]);
  await t.close();
});

async function player() {
  const guest = await signInGuest(t.app, 'android');
  made.users.push(guest.user.id);
  return guest;
}

const get = (token: string, url: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
const post = (token: string, url: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers: bearer(token), ...(payload ? { payload } : {}) });

async function catalogue(token: string) {
  const res = await get(token, '/v1/packs');
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as PacksResponse).packs;
}

async function practiceSet(token: string, id: string): Promise<PracticeSet> {
  const res = await get(token, `/v1/packs/${id}/practice`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as PracticeSet;
}

/** A game of the set's first 10 questions, `right` of them answered correctly. */
function game(set: PracticeSet, right: number, overrides: object = {}) {
  return {
    id: randomUUID(),
    pack_id: set.pack_id,
    week: set.week,
    played_at: new Date(t.clock.t - 60_000).toISOString(),
    answers: set.questions.slice(0, 10).map((q, i) => ({
      qid: q.qid,
      picked: i < right ? q.correct_index : (q.correct_index + 1) % q.options.length,
      elapsed_ms: 4000,
    })),
    complete: true,
    ...overrides,
  };
}

async function xpOf(userId: string): Promise<number> {
  return Number(
    (await t.pool.query<{ xp: string }>('SELECT xp FROM users WHERE id = $1', [userId])).rows[0]!.xp,
  );
}

describe('the pack catalogue', () => {
  it('shows packs with enough questions for the player, locked or not', async () => {
    const p = await player();
    const hidden = [
      await pack({ category: CATEGORY, active: false }),
      await pack({ category: CATEGORY, starts: december(20, 9) }),
      // Two questions chosen: not enough to practise.
      await pack({}),
    ];
    await t.pool.query('INSERT INTO pack_questions (pack_id, question_id) SELECT $1, unnest($2::text[])', [
      hidden[2],
      made.questions.slice(0, 2),
    ]);
    const packs = await catalogue(p.access);
    const ids = packs.map((x) => x.id);
    for (const h of hidden) expect(ids).not.toContain(h);
    // Tomorrow's Daily question and the draft are left out: 12 family-safe and 2 not.
    expect(packs.find((x) => x.id === core)).toMatchObject({
      access: 'free',
      unlocked: true,
      questions: 14,
      category_id: CATEGORY,
    });
    expect(packs.find((x) => x.id === premium)).toMatchObject({
      access: 'coins',
      price_coins: 300,
      unlocked: false,
      questions: 12,
      category_id: CATEGORY,
    });

    // In family mode, only family-safe questions count.
    await t.pool.query('UPDATE users SET family_mode = true WHERE id = $1', [p.user.id]);
    expect((await catalogue(p.access)).find((x) => x.id === core)?.questions).toBe(12);
  });
});

describe('practice sets', () => {
  it("sends the week's set with answers, the same each time, never with a Daily's question", async () => {
    const p = await player();
    const set = await practiceSet(p.access, core);
    expect(set).toMatchObject({ pack_id: core, week: '2028-W50', time_limit_ms: 15_000 });
    expect(set.questions).toHaveLength(14);
    const ids = set.questions.map((q) => q.qid);
    expect(ids).not.toContain(dailyQuestion);
    for (const q of set.questions) {
      expect(q.options).toEqual(['One', 'Two', 'Three', 'Four']);
      expect(q.correct_index).toBeGreaterThanOrEqual(0);
      expect(q.fact).toBe('A fact.');
    }
    // Seen by this player now, so their duels prefer other questions.
    const seen = await t.pool.query('SELECT question_id FROM user_question_seen WHERE user_id = $1', [
      p.user.id,
    ]);
    expect(seen.rows.map((r) => r.question_id).sort()).toEqual([...ids].sort());

    t.clock.advance(600_000);
    expect((await practiceSet(p.access, core)).questions.map((q) => q.qid)).toEqual(ids);
    // A question taken out of play leaves the set.
    await t.pool.query("UPDATE questions SET status = 'suspended' WHERE id = $1", [ids[0]]);
    expect((await practiceSet(p.access, core)).questions.map((q) => q.qid)).toEqual(ids.slice(1));
    await t.pool.query("UPDATE questions SET status = 'live' WHERE id = $1", [ids[0]]);
    t.clock.t = december(13, 10);
  });

  it('needs a coins pack unlocked first, once, with enough coins', async () => {
    const p = await player();
    const locked = await get(p.access, `/v1/packs/${premium}/practice`);
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ code: 'PACK_LOCKED' });
    const poor = await post(p.access, `/v1/packs/${premium}/unlock`);
    expect(poor.statusCode).toBe(409);
    expect(poor.json()).toMatchObject({ code: 'NOT_ENOUGH_COINS' });

    await withTransaction(t.pool, (client) =>
      grantCoins(client, p.user.id, 500, {
        key: `practice-${randomUUID()}`,
        reason: 'daily',
        now: t.clock.t,
      }),
    );
    const unlocked = await post(p.access, `/v1/packs/${premium}/unlock`);
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    expect(unlocked.json() as PackUnlockResponse).toMatchObject({
      pack: { id: premium, unlocked: true },
      coins: 200,
    });
    // Again costs nothing.
    expect(((await post(p.access, `/v1/packs/${premium}/unlock`)).json() as PackUnlockResponse).coins).toBe(
      200,
    );
    expect((await catalogue(p.access)).find((x) => x.id === premium)?.unlocked).toBe(true);
    expect((await practiceSet(p.access, premium)).questions).toHaveLength(12);
    const ledger = await t.pool.query(
      `SELECT t.reason, e.amount FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1 ORDER BY e.id`,
      [`user:${p.user.id}:coins`],
    );
    expect(ledger.rows).toEqual([
      { reason: 'daily', amount: '500' },
      { reason: 'pack', amount: '-300' },
    ]);
  });

  it('has no pack it does not show', async () => {
    const p = await player();
    const res = await get(p.access, `/v1/packs/${newId('pk')}/practice`);
    expect(res.statusCode).toBe(404);
  });
});

describe('practice results', () => {
  it('pays XP once per game, checked against the set, up to the day’s cap', async () => {
    const p = await player();
    const set = await practiceSet(p.access, core);
    const first = game(set, 7);
    const paid = await post(p.access, '/v1/practice/results', first);
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json() as PracticeResultResponse).toEqual({
      correct: 7,
      answered: 10,
      xp: 126,
      capped: false,
      level: 1,
    });
    expect(await xpOf(p.user.id)).toBe(126);

    // Sent again (the app retrying): the same answer, no more XP.
    const again = await post(p.access, '/v1/practice/results', first);
    expect((again.json() as PracticeResultResponse).xp).toBe(126);
    expect(await xpOf(p.user.id)).toBe(126);

    // 126 + 150 = 276, then only 24 more today (the cap is 300).
    expect(
      ((await post(p.access, '/v1/practice/results', game(set, 10))).json() as PracticeResultResponse).xp,
    ).toBe(150);
    const capped = (
      await post(p.access, '/v1/practice/results', game(set, 10))
    ).json() as PracticeResultResponse;
    expect(capped).toMatchObject({ xp: 24, capped: true, level: 2 });
    expect(
      ((await post(p.access, '/v1/practice/results', game(set, 10))).json() as PracticeResultResponse).xp,
    ).toBe(0);
    expect(await xpOf(p.user.id)).toBe(300);

    // A new day (WAT), a new allowance; a game left part way earns no finish.
    t.clock.t = december(14, 0) + 3_600_000;
    const tomorrow = await signInGuest(t.app, 'android', p.deviceId);
    const partial = game(set, 2, { complete: false });
    partial.answers = partial.answers.slice(0, 3);
    expect(
      ((await post(tomorrow.access, '/v1/practice/results', partial)).json() as PracticeResultResponse).xp,
    ).toBe(2 * 10 + 1 * 2);
    t.clock.t = december(13, 10);
  });

  it("refuses games that aren't from the player's set", async () => {
    const p = await player();
    const set = await practiceSet(p.access, core);
    const other = await player();
    const res = (body: object) => post(p.access, '/v1/practice/results', body);

    // Someone else's set, or a week with none.
    expect((await post(other.access, '/v1/practice/results', game(set, 5))).statusCode).toBe(404);
    expect((await res(game(set, 5, { week: '2028-W45' }))).statusCode).toBe(404);
    // A question not in the set, the same question twice, too many answers.
    const stranger = game(set, 5);
    stranger.answers[0] = { ...stranger.answers[0]!, qid: dailyQuestion };
    expect((await res(stranger)).statusCode).toBe(400);
    const twice = game(set, 5);
    twice.answers[1] = { ...twice.answers[0]! };
    expect((await res(twice)).statusCode).toBe(400);
    const eleven = game(set, 5);
    eleven.answers.push({ ...eleven.answers[0]!, qid: set.questions[10]!.qid });
    expect((await res(eleven)).statusCode).toBe(400);
    // Played over two weeks ago, or in the future.
    const old = new Date(t.clock.t - 15 * 86_400_000).toISOString();
    expect((await res(game(set, 5, { played_at: old }))).statusCode).toBe(400);
    const later = new Date(t.clock.t + 3_600_000).toISOString();
    expect((await res(game(set, 5, { played_at: later }))).statusCode).toBe(400);
    expect(await xpOf(p.user.id)).toBe(0);
  });

  it("moves a guest's packs and practice into the account they sign in to", async () => {
    const sub = `practice-merge-${randomInt(1e9)}`;
    const signIn = async (access: string) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/auth/google',
          headers: bearer(access),
          payload: { id_token: await t.signGoogle({ sub }), platform: 'android', merge_guest: true },
        })
      ).json() as { user: { id: string }; access: string };
    const account = await signIn((await player()).access);
    made.users.push(account.user.id);

    const guest = await player();
    await withTransaction(t.pool, (client) =>
      grantCoins(client, guest.user.id, 300, {
        key: `practice-${randomUUID()}`,
        reason: 'daily',
        now: t.clock.t,
      }),
    );
    expect((await post(guest.access, `/v1/packs/${premium}/unlock`)).statusCode).toBe(200);
    const set = await practiceSet(guest.access, premium);
    const played = game(set, 4);
    expect(
      ((await post(guest.access, '/v1/practice/results', played)).json() as PracticeResultResponse).xp,
    ).toBe(102);

    const merged = await signIn(guest.access);
    expect(merged.user.id).toBe(account.user.id);
    expect((await catalogue(merged.access)).find((x) => x.id === premium)?.unlocked).toBe(true);
    // A game played on the guest's phone before signing in still counts once, for the account.
    const later = await post(merged.access, '/v1/practice/results', game(set, 10));
    expect(later.statusCode, later.body).toBe(200);
    expect((await post(merged.access, '/v1/practice/results', played)).json()).toMatchObject({ xp: 102 });
  });
});

describe('packs in the console', () => {
  async function staff(roles: AdminRole[]): Promise<string> {
    const id = newId('adm');
    await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [
      id,
      `packs-${randomInt(1e9)}@whosabi.ng`,
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
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: object) =>
    t.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) });
  const input = (slug: string) => ({
    title: 'Owambe Starter Pack',
    slug,
    description: 'Party questions',
    access: 'free',
    price_coins: null,
    category_id: null,
    starts_at: null,
    ends_at: null,
    active: true,
  });

  it('lets editors make a pack and choose its questions; writers only look', async () => {
    const editor = await staff(['editor']);
    const writer = await staff(['writer']);
    const slug = `owambe-${randomInt(1e9)}`;
    expect((await call('POST', '/admin/packs', writer, input(slug))).statusCode).toBe(403);

    const created = await call('POST', '/admin/packs', editor, input(slug));
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as AdminPack).id;
    made.packs.push(id);
    expect(created.json()).toMatchObject({ slug, chosen: 0, live: 0, access: 'free' });
    expect((await call('POST', '/admin/packs', editor, input(slug))).statusCode).toBe(409);
    // A coins pack needs a price.
    expect(
      (await call('PUT', `/admin/packs/${id}`, editor, { ...input(slug), access: 'coins' })).statusCode,
    ).toBe(400);

    const [q1, q2, draft] = [made.questions[0]!, made.questions[1]!, made.questions[14]!];
    const added = await call('POST', `/admin/packs/${id}/questions`, editor, {
      refs: [q1, `PRAC-${q2}`, draft, q1, 'NOPE-1'],
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json() as AdminPackQuestionsAdded).toEqual({ added: 3, already: 0, unknown: ['NOPE-1'] });
    expect(
      (
        await call('POST', `/admin/packs/${id}/questions`, editor, { refs: [q2] })
      ).json() as AdminPackQuestionsAdded,
    ).toEqual({ added: 0, already: 1, unknown: [] });

    const updated = await call('PUT', `/admin/packs/${id}`, editor, {
      ...input(slug),
      access: 'coins',
      price_coins: 450,
    });
    expect(updated.statusCode, updated.body).toBe(200);
    // Three chosen, two of them live.
    expect(updated.json()).toMatchObject({ access: 'coins', price_coins: 450, chosen: 3, live: 2 });

    expect((await call('DELETE', `/admin/packs/${id}/questions/${q1}`, editor)).statusCode).toBe(204);
    expect((await call('DELETE', `/admin/packs/${id}/questions/${q1}`, editor)).statusCode).toBe(404);
    const detail = (await call('GET', `/admin/packs/${id}`, writer)).json() as AdminPackDetail;
    expect(detail.questions.map((q) => q.id).sort()).toEqual([q2, draft].sort());
    expect(
      ((await call('GET', '/admin/packs', writer)).json() as { packs: AdminPack[] }).packs.map((p) => p.id),
    ).toContain(id);

    const audit = await t.pool.query(
      `SELECT action FROM admin_audit_log WHERE entity = 'pack' AND entity_id = $1 ORDER BY id`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'create_pack',
      'add_pack_questions',
      'update_pack',
      'remove_pack_question',
    ]);
  });
});
