import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pseudonymousId } from '@whosabi/analytics/server';
import type {
  AdminImportResponse,
  AdminQuestion,
  AdminQuestionInput,
  AdminQuestionListResponse,
  AdminReportsResponse,
  AdminRole,
} from '@whosabi/shared-types';
import { SYSTEM_ADMIN_ID } from '../src/admin/permissions';
import { AdminSessions } from '../src/admin/sessions';
import { newId } from '../src/ids';
import { retireExpiredQuestions } from '../src/jobs/contentExpiry';
import { bearer, createTestApp, signInGuest } from './helpers';

let t: Awaited<ReturnType<typeof createTestApp>>;
let sessions: AdminSessions;
beforeAll(async () => {
  t = await createTestApp();
  sessions = new AdminSessions(t.redis, t.clock.now);
  await t.pool.query(
    `INSERT INTO admin_users (id, email, name, status) VALUES ($1, 'system@whosabi.invalid', 'System', 'removed')
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_ADMIN_ID],
  );
});
afterAll(() => t.close());

interface Staff {
  id: string;
  name: string;
  token: string;
}

async function staff(roles: AdminRole[], name = roles.join('+')): Promise<Staff> {
  const id = newId('adm');
  const email = `staff${randomInt(1e9)}@whosabi.ng`;
  await t.pool.query('INSERT INTO admin_users (id, email, name) VALUES ($1, $2, $3)', [id, email, name]);
  for (const role of roles) {
    await t.pool.query('INSERT INTO admin_role_grants (admin_id, role, granted_by) VALUES ($1, $2, $3)', [
      id,
      role,
      SYSTEM_ADMIN_ID,
    ]);
  }
  // Straight to a session: the sign-in itself is tested in admin.test.ts, and its per-IP limit
  // is shared with the other files in this run.
  return { id, name, token: (await sessions.create(id)).token };
}

const call = (s: Staff, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: bearer(s.token), ...(payload ? { payload } : {}) });

/** A unique, well-formed question; each test gets its own words so duplicate checks stay out of the way. */
function question(over: Partial<AdminQuestionInput> = {}): AdminQuestionInput {
  const n = randomInt(1e9);
  return {
    category_id: 'music',
    subcategory: null,
    type: 'mcq4',
    text: `Which artist released test album number ${n}?`,
    options: [`Artist ${n}`, 'Burna Boy', 'Tiwa Savage', 'Davido'],
    correct_index: 0,
    numeric_answer: null,
    fact: 'A fact that adds something.',
    difficulty: 2,
    family_safe: true,
    region_tag: 'ALL',
    valid_until: null,
    source_url: 'https://example.com/source',
    ...over,
  };
}

async function create(s: Staff, input: AdminQuestionInput): Promise<AdminQuestion> {
  const res = await call(s, 'POST', '/admin/questions', input);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as AdminQuestion;
}

const act = (s: Staff, id: string, action: string, note?: string) =>
  call(s, 'POST', `/admin/questions/${id}/actions`, { action, ...(note ? { note } : {}) });

async function detail(s: Staff, id: string): Promise<AdminQuestion> {
  const res = await call(s, 'GET', `/admin/questions/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AdminQuestion;
}

const statusOf = async (id: string) =>
  (await t.pool.query<{ status: string }>('SELECT status FROM questions WHERE id = $1', [id])).rows[0]
    ?.status;

/** CSV text in the question bank's format. */
function bankCsv(rows: Array<Record<string, string>>): string {
  const columns = [
    'id',
    'category',
    'subcategory',
    'type',
    'difficulty',
    'question',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_option',
    'fact',
    'family_safe',
    'valid_until',
    'region_tag',
    'status',
    'source_url',
    'source_title',
    'added_on',
    'review_status',
    'reviewer',
    'review_notes',
  ];
  const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
  return [columns.join(','), ...rows.map((r) => columns.map((c) => quote(r[c] ?? '')).join(','))].join('\n');
}

function bankRow(id: string, over: Record<string, string> = {}): Record<string, string> {
  return {
    id,
    category: 'food',
    type: 'mcq4',
    difficulty: '2',
    question: `Which soup is test dish ${id} in the ${randomInt(1e9)} cookbook?`,
    option_a: 'Egusi',
    option_b: 'Ogbono',
    option_c: 'Afang',
    option_d: 'Banga',
    correct_option: 'a',
    fact: 'Egusi is made from melon seeds.',
    family_safe: 'true',
    valid_until: '',
    region_tag: 'ALL',
    status: 'draft',
    source_url: 'https://example.com/egusi',
    review_status: 'to check',
    ...over,
  };
}

async function importCsv(s: Staff, csv: string, options: { dry_run: boolean; publish_approved?: boolean }) {
  const res = await call(s, 'POST', '/admin/questions/import', { csv, ...options });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AdminImportResponse;
}

describe('the question workflow', () => {
  it('goes from draft to live through a writer, a fact-checker and an editor, and keeps every step', async () => {
    const writer = await staff(['writer'], 'Wale Writer');
    const checker = await staff(['fact_checker'], 'Funmi Checker');
    const editor = await staff(['editor'], 'Ego Editor');

    const draft = await create(writer, question());
    expect(draft).toMatchObject({
      status: 'draft',
      version: 1,
      author: 'Wale Writer',
      can_edit: true,
      allowed_actions: ['submit'],
      checks: { errors: [], warnings: [] },
    });

    expect((await act(writer, draft.id, 'submit')).json()).toMatchObject({ status: 'in_review' });
    expect((await act(writer, draft.id, 'approve')).statusCode).toBe(403);
    expect((await act(checker, draft.id, 'publish')).statusCode).toBe(403);
    expect((await act(checker, draft.id, 'approve')).json()).toMatchObject({
      status: 'approved',
      reviewed_by: 'Funmi Checker',
    });
    expect((await act(writer, draft.id, 'publish')).statusCode).toBe(403);
    const live = (await act(editor, draft.id, 'publish')).json() as AdminQuestion;
    expect(live.status).toBe('live');
    expect(live.history.map((h) => [h.action, h.actor])).toEqual([
      ['publish', 'Ego Editor'],
      ['approve', 'Funmi Checker'],
      ['submit', 'Wale Writer'],
      ['created', 'Wale Writer'],
    ]);
    // A live question can't be published again.
    const again = await act(editor, draft.id, 'publish');
    expect(again.statusCode).toBe(409);
    expect(again.json().detail).toBe("This question is live, so it can't be published.");

    const audit = await t.pool.query<{ action: string }>(
      "SELECT action FROM admin_audit_log WHERE entity = 'question' AND entity_id = $1 ORDER BY id",
      [draft.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'create_question',
      'question_submit',
      'question_approve',
      'question_publish',
    ]);
  });

  it('keeps writers to their own questions, needs a source for review, and a note to send back', async () => {
    const writer = await staff(['writer']);
    const other = await staff(['writer']);
    const checker = await staff(['fact_checker']);

    const q = await create(writer, question({ source_url: null }));
    expect(q.checks.errors).toEqual(['Add the source link that confirms the fact.']);
    const blocked = await act(writer, q.id, 'submit');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().detail).toContain('source link');

    expect((await call(other, 'GET', `/admin/questions/${q.id}`)).statusCode).toBe(404);
    const theirs = (await call(other, 'GET', '/admin/questions')).json() as AdminQuestionListResponse;
    expect(theirs.questions.map((r) => r.id)).not.toContain(q.id);
    const all = (
      await call(checker, 'GET', `/admin/questions?q=${q.id}`)
    ).json() as AdminQuestionListResponse;
    expect(all.questions.map((r) => r.id)).toContain(q.id);

    const edited = (
      await call(writer, 'PUT', `/admin/questions/${q.id}`, {
        ...question(),
        text: q.text,
        options: q.options,
        source_url: 'https://example.com/found-it',
      })
    ).json() as AdminQuestion;
    expect(edited).toMatchObject({ version: 2, source_url: 'https://example.com/found-it' });
    expect(edited.history[0]).toMatchObject({ action: 'edited', version: 2 });
    expect((await act(writer, q.id, 'submit')).statusCode).toBe(200);

    const noNote = await act(checker, q.id, 'send_back');
    expect(noNote.statusCode).toBe(400);
    const back = (await act(checker, q.id, 'send_back', 'Option B is also right.')).json() as AdminQuestion;
    expect(back.status).toBe('draft');
    expect(back.history[0]).toMatchObject({ action: 'send_back', note: 'Option B is also right.' });

    // A fact-checker's own question needs someone else's check.
    const own = await create(checker, question());
    await act(checker, own.id, 'submit');
    const self = await act(checker, own.id, 'approve');
    expect(self.statusCode).toBe(403);
    expect(self.json().detail).toBe('Someone else has to fact-check your question.');
  });

  it('lets only editors change a live question, keeping the version before', async () => {
    const editor = await staff(['editor']);
    const checker = await staff(['fact_checker']);
    const q = await create(editor, question());
    await act(editor, q.id, 'submit');
    await act(checker, q.id, 'approve');
    await act(editor, q.id, 'publish');

    const denied = await call(checker, 'PUT', `/admin/questions/${q.id}`, { ...question(), text: q.text });
    expect(denied.statusCode).toBe(403);

    const changed = (
      await call(editor, 'PUT', `/admin/questions/${q.id}`, {
        ...question(),
        text: q.text,
        options: q.options,
        correct_index: 1,
      })
    ).json() as AdminQuestion;
    expect(changed).toMatchObject({ status: 'live', version: 2, correct_index: 1 });
    expect(changed.history[0]).toMatchObject({ action: 'edited', note: 'The answer changed.' });
    const snapshot = await t.pool.query<{ snapshot: AdminQuestionInput }>(
      "SELECT snapshot FROM question_history WHERE question_id = $1 AND action = 'edited'",
      [q.id],
    );
    expect(snapshot.rows[0]!.snapshot.correct_index).toBe(0);

    // Retired is final until reopened.
    await act(editor, q.id, 'retire');
    expect(
      (await call(editor, 'PUT', `/admin/questions/${q.id}`, { ...question(), text: q.text })).statusCode,
    ).toBe(403);
    expect((await act(editor, q.id, 'reopen')).json()).toMatchObject({ status: 'draft' });
  });
});

describe('importing from the question bank', () => {
  it('brings in approved and unchecked rows, and skips rejected, broken and repeated ones', async () => {
    const editor = await staff(['editor']);
    const first = bankRow('TST-0001', {
      review_status: 'approved',
      reviewer: 'Ada',
      review_notes: 'Checked on BBC',
    });
    const japa = (
      await t.pool.query<{ text: string }>("SELECT text FROM questions WHERE external_ref = 'SEED-0001'")
    ).rows[0]!.text;
    const csv = bankCsv([
      first,
      bankRow('TST-0002'),
      bankRow('TST-0003', { review_status: 'rejected' }),
      bankRow('TST-0004', { option_b: 'An option much longer than thirty characters' }),
      bankRow('TST-0005', { question: first.question!.toUpperCase() }),
      bankRow('TST-0006', { question: japa }),
      bankRow('TST-0007', { category: 'sport' }),
      bankRow('TST-0008', { question: first.question!.replace('Which soup', 'Which stew') }),
    ]);

    const dry = await importCsv(editor, csv, { dry_run: true });
    expect(dry).toMatchObject({
      dry_run: true,
      rows: 8,
      created: { approved: 1, in_review: 3, live: 0 },
      skipped: 3,
    });
    expect(dry.errors).toEqual([
      {
        line: 5,
        ref: 'TST-0004',
        message: '"An option much longer than thirty characters" is 44 characters; options are at most 30.',
      },
    ]);
    const messages = dry.warnings.map((w) => `${w.ref}: ${w.message}`);
    expect(messages).toContain('TST-0005: Skipped: the same question as TST-0001.');
    expect(messages).toContain('TST-0006: Skipped: the same question as q_seed-0001.');
    expect(messages.some((m) => m.startsWith('TST-0008: Reads like'))).toBe(false); // compared with the database only
    expect(messages).toContain(
      'sport: The sport category is switched off, so its questions are not played until it is switched on.',
    );
    expect(await statusOf('q_tst-0001')).toBeUndefined();

    const done = await importCsv(editor, csv, { dry_run: false, publish_approved: true });
    expect(done.created).toMatchObject({ live: 1, in_review: 3 });
    expect(await statusOf('q_tst-0001')).toBe('live');
    expect(await statusOf('q_tst-0002')).toBe('in_review');
    expect(await statusOf('q_tst-0003')).toBeUndefined();
    const imported = await detail(editor, 'q_tst-0001');
    expect(imported).toMatchObject({
      author: null,
      external_ref: 'TST-0001',
      reviewed_by: 'Ada',
      source_url: 'https://example.com/egusi',
    });
    expect(imported.history[0]).toMatchObject({
      action: 'imported_live',
      note: 'Approved in the question bank by Ada: Checked on BBC',
    });

    // The same file again changes nothing; a near-copy of a question now in the game is flagged.
    // Whoever imported a question can fact-check it: they did not write it.
    expect((await act(editor, 'q_tst-0002', 'approve')).json()).toMatchObject({ status: 'approved' });

    const again = await importCsv(editor, csv, { dry_run: true });
    expect(again.created).toMatchObject({ approved: 0, in_review: 0, live: 0 });
    const near = await importCsv(
      editor,
      bankCsv([bankRow('TST-0009', { question: first.question!.replace('Which soup', 'Which broth') })]),
      { dry_run: true },
    );
    // Like TST-0001, and TST-0008 now in review: either can be the closest.
    expect(near.warnings[0]?.message).toMatch(/^Reads like q_tst-000[18] \(\d+% alike\)/);
  });

  it('refuses people without import rights, and files it cannot read', async () => {
    const checker = await staff(['fact_checker']);
    expect(
      (await call(checker, 'POST', '/admin/questions/import', { csv: 'x', dry_run: true })).statusCode,
    ).toBe(403);
    const editor = await staff(['editor']);
    const bad = await call(editor, 'POST', '/admin/questions/import', {
      csv: 'id,question\nX-1,Hi?',
      dry_run: true,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toMatch(/^It needs these columns: category, type/);
  });

  it('publishes approved questions together and skips the rest', async () => {
    const editor = await staff(['editor']);
    await importCsv(
      editor,
      bankCsv([
        bankRow('TST-0101', { review_status: 'approved' }),
        bankRow('TST-0102', { review_status: 'approved' }),
        bankRow('TST-0103'),
      ]),
      { dry_run: false },
    );
    const res = await call(editor, 'POST', '/admin/questions/publish', {
      ids: ['q_tst-0101', 'q_tst-0102', 'q_tst-0103', 'q_missing'],
    });
    expect(res.json()).toEqual({ published: 2, skipped: ['q_tst-0103', 'q_missing'] });
    expect(await statusOf('q_tst-0102')).toBe('live');
  });
});

describe('player reports', () => {
  async function liveQuestion(ref: string): Promise<string> {
    const editor = await staff(['editor']);
    await importCsv(editor, bankCsv([bankRow(ref, { review_status: 'approved' })]), {
      dry_run: false,
      publish_approved: true,
    });
    return `q_${ref.toLowerCase()}`;
  }

  const report = async (access: string, id: string, reason: string, note?: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/questions/${id}/reports`,
      headers: bearer(access),
      payload: { reason, ...(note ? { note } : {}) },
    });

  it('takes a question out after five "wrong answer" reports, and editors decide what happens next', async () => {
    const id = await liveQuestion('TST-0201');
    const players = await Promise.all(Array.from({ length: 5 }, () => signInGuest(t.app)));
    for (const [i, p] of players.entries()) {
      const res = await report(p.access, id, 'wrong_answer', i === 4 ? 'It is Ogbono, not Egusi' : undefined);
      expect(res.statusCode, res.body).toBe(202);
      expect(await statusOf(id)).toBe(i < 4 ? 'live' : 'suspended');
    }
    // Reporting twice counts once.
    await report(players[0]!.access, id, 'typo');
    const reports = await t.pool.query(
      'SELECT count(*)::int AS n FROM question_reports WHERE question_id = $1',
      [id],
    );
    expect(reports.rows[0].n).toBe(5);

    const pid = pseudonymousId(players[0]!.user.id, t.config.analyticsKey);
    const events = ((await t.redis.xrange('ev:stream', '-', '+')) as Array<[string, string[]]>)
      .flatMap(([, fields]) => JSON.parse(fields[1]!) as Array<Record<string, unknown>>)
      .filter((row) => row.user_pid === pid && row.event === 'question_reported');
    expect(events.map((e) => JSON.parse(e.props as string))).toEqual([{ qid: id, reason: 'wrong_answer' }]);

    const editor = await staff(['editor']);
    const queue = (await call(editor, 'GET', '/admin/reports')).json() as AdminReportsResponse;
    const group = queue.groups.find((g) => g.question.id === id)!;
    expect(group).toMatchObject({
      open: 5,
      reasons: { wrong_answer: 5 },
      notes: ['It is Ogbono, not Egusi'],
      auto_suspended: true,
      question: { status: 'suspended' },
    });
    expect(queue.groups[0]!.question.status).toBe('suspended');
    const history = await detail(editor, id);
    expect(history.history[0]).toMatchObject({ action: 'auto_suspended', actor: 'System' });

    const writer = await staff(['writer']);
    expect(
      (await call(writer, 'POST', `/admin/questions/${id}/reports/resolve`, { resolution: 'rejected' }))
        .statusCode,
    ).toBe(403);
    const kept = (
      await call(editor, 'POST', `/admin/questions/${id}/reports/resolve`, {
        resolution: 'rejected',
        note: 'Egusi is right; checked the source.',
      })
    ).json() as AdminQuestion;
    expect(kept).toMatchObject({ status: 'live', open_reports: 0 });
    const after = (await call(editor, 'GET', '/admin/reports')).json() as AdminReportsResponse;
    expect(after.groups.map((g) => g.question.id)).not.toContain(id);
  });

  it('suspends on reports from more than 3% of plays, but only after 100 plays', async () => {
    const early = await liveQuestion('TST-0301');
    const seasoned = await liveQuestion('TST-0302');
    await t.pool.query('INSERT INTO question_stats (question_id, plays) VALUES ($1, 50), ($2, 100)', [
      early,
      seasoned,
    ]);
    for (let i = 0; i < 4; i++) {
      const p = await signInGuest(t.app);
      await report(p.access, early, 'typo');
      await report(p.access, seasoned, 'typo');
      expect(await statusOf(seasoned)).toBe(i < 3 ? 'live' : 'suspended');
    }
    expect(await statusOf(early)).toBe('live');
  });

  it('only takes reports on questions players can have seen', async () => {
    const writer = await staff(['writer']);
    const draft = await create(writer, question());
    const p = await signInGuest(t.app);
    expect((await report(p.access, draft.id, 'typo')).statusCode).toBe(404);
    expect((await report(p.access, 'q_seed-0002', 'nonsense')).statusCode).toBe(400);
  });
});

describe('the worker', () => {
  it('retires questions past their "valid until" date', async () => {
    const editor = await staff(['editor']);
    await importCsv(
      editor,
      bankCsv([
        bankRow('TST-0401', { review_status: 'approved', valid_until: '2026-10-31' }),
        bankRow('TST-0402', { review_status: 'approved', valid_until: '2026-11-30' }),
      ]),
      { dry_run: false, publish_approved: true },
    );
    expect(await retireExpiredQuestions({ pool: t.pool, clock: t.clock })).toBeGreaterThanOrEqual(1);
    expect(await statusOf('q_tst-0401')).toBe('retired');
    expect(await statusOf('q_tst-0402')).toBe('live');
    expect((await detail(editor, 'q_tst-0401')).history[0]).toMatchObject({
      action: 'expired',
      actor: 'System',
      note: 'Valid until 2026-10-31',
    });
  });
});
