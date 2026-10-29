/**
 * The Content module against the real API (doc 04 §3, doc 18 §12, PRD US-9): a writer drafts a
 * question and sends it for review, an editor checks and publishes it, imports a question-bank
 * file, and clears a question that player reports took out of the game.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:3100';
const repo = path.resolve(process.cwd(), '../..');

function addStaff(email: string, roles: string) {
  const db = new URL(process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres');
  db.pathname = '/whosabi_e2e';
  execFileSync('pnpm', ['--filter', '@whosabi/api', 'admin:add', email, `E2E ${roles}`, roles], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: db.toString() },
    stdio: 'ignore',
  });
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page.getByTestId('staff-name')).toBeVisible();
}

async function report(request: APIRequestContext, qid: string) {
  const guest = await (
    await request.post(`${API}/v1/auth/guest`, {
      data: { device_id: randomBytes(24).toString('base64url'), platform: 'web' },
    })
  ).json();
  const res = await request.post(`${API}/v1/questions/${qid}/reports`, {
    headers: { authorization: `Bearer ${guest.access}` },
    data: { reason: 'wrong_answer', note: 'The answer is Ogbono' },
  });
  expect(res.status()).toBe(202);
}

test('a question goes from a writer to live, an import lands, and reports get an answer', async ({
  page,
  request,
}) => {
  const n = randomInt(1e9);
  const writer = `e2e-writer-${n}@whosabi.ng`;
  const editor = `e2e-editor-${n}@whosabi.ng`;
  addStaff(writer, 'writer');
  addStaff(editor, 'editor');

  // The writer lands on the questions (no player search for writers) and drafts one.
  await signIn(page, writer);
  await expect(page).toHaveURL(/\/questions/);
  await page.getByTestId('new-question').click();
  const text = `Which state is the e2e dish number ${n} from?`;
  await page.getByTestId('field-text').fill(text);
  for (const [i, option] of ['Cross River', 'Lagos', 'Kano', 'Enugu'].entries()) {
    await page.getByTestId(`field-option${i}`).fill(option);
  }
  await page.getByTestId('field-source').fill('https://example.com/e2e-dish');
  await page.getByTestId('trending').check();
  await page.getByTestId('save-question').click();
  await expect(page).toHaveURL(/\/questions\/q_[0-9A-Z]+\?saved=1/);
  const questionUrl = page.url().replace(/\?.*$/, '');
  await expect(page.getByTestId('question-status')).toHaveText('Draft');
  await expect(page.getByTestId('checks')).toContainText('Meets the Question Bible');
  await page.getByTestId('action-submit').click();
  await expect(page.getByTestId('question-status')).toHaveText('In review');
  await page.getByRole('button', { name: 'Sign out' }).click();

  // The editor fact-checks it from the review list and publishes it.
  await signIn(page, editor);
  await page.goto('/questions?status=in_review');
  await page.getByRole('link', { name: text }).click();
  await page.getByTestId('action-approve').click();
  await expect(page.getByTestId('question-status')).toHaveText('Approved');
  await page.getByTestId('action-publish').click();
  await expect(page.getByTestId('question-status')).toHaveText('Live');
  // Trending: 90 days in the game from going live, and the editor can renew it.
  await expect(page.getByTestId('trending-badge')).toContainText('Trending · in the game until');
  await page.getByTestId('renew').click();
  await expect(page.getByText('Renewed for 90 days.')).toBeVisible();
  await expect(page.getByTestId('history')).toContainText('Published');
  await expect(page.getByTestId('history')).toContainText('Sent for review');

  // An import from the question bank: check first, then import.
  const ref = `E2E-${n}`;
  const csv = [
    'id,category,subcategory,type,difficulty,question,option_a,option_b,option_c,option_d,correct_option,fact,family_safe,valid_until,region_tag,status,source_url,source_title,added_on,review_status,reviewer,review_notes',
    `${ref},food,,mcq4,2,Which soup is the e2e import ${n} about?,Egusi,Ogbono,Afang,Banga,a,Egusi is made from melon seeds.,true,,ALL,draft,https://example.com/egusi,,,approved,Ada,`,
  ].join('\n');
  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles({
    name: 'food.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByTestId('import-check').click();
  await expect(page.getByTestId('import-result')).toContainText('Would add 1: 1 approved');
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-result')).toContainText('Added 1: 1 approved');
  await page.goto('/questions?status=approved');
  await expect(page.getByText(`Which soup is the e2e import ${n} about?`)).toBeVisible();

  // Five players say the live question's answer is wrong: it leaves the game until an editor decides.
  const qid = questionUrl.split('/').at(-1)!;
  for (let i = 0; i < 5; i++) await report(request, qid);
  await page.goto('/reports');
  const card = page.getByTestId(`report-${qid}`);
  await expect(card).toContainText('Taken out automatically');
  await expect(card).toContainText('Wrong answer: 5');
  await expect(card).toContainText('The answer is Ogbono');
  await page.getByTestId(`keep-${qid}`).click();
  await expect(card).toHaveCount(0);
  await page.goto(questionUrl);
  await expect(page.getByTestId('question-status')).toHaveText('Live');
  await expect(page.getByTestId('history')).toContainText('Reports closed: nothing wrong');
});

test('an editor makes a coins pack and chooses its questions', async ({ page }) => {
  const n = randomInt(1e9);
  const editor = `e2e-packs-${n}@whosabi.ng`;
  addStaff(editor, 'editor');
  await signIn(page, editor);

  // A question from the bank to choose: imported, so it has a reference.
  const ref = `PACK-${n}`;
  const csv = [
    'id,category,subcategory,type,difficulty,question,option_a,option_b,option_c,option_d,correct_option,fact,family_safe,valid_until,region_tag,status,source_url,source_title,added_on,review_status,reviewer,review_notes',
    `${ref},food,,mcq4,2,Which soup is pack question ${n} about?,Egusi,Ogbono,Afang,Banga,a,Egusi is made from melon seeds.,true,,ALL,draft,https://example.com/egusi,,,approved,Ada,`,
  ].join('\n');
  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles({
    name: 'food.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByTestId('import-check').click();
  await expect(page.getByTestId('import-result')).toContainText('Would add 1');
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-result')).toContainText('Added 1');

  // The core packs are there already, one per category.
  await page.goto('/packs');
  await expect(page.getByTestId('packs')).toContainText('Food');
  await page.getByTestId('pack-title').fill(`E2E pack ${n}`);
  await page.getByTestId('pack-access').selectOption('coins');
  await page.getByTestId('pack-price').fill('400');
  await page.getByTestId('save-pack').click();
  await expect(page).toHaveURL(/\/packs\/pk_[0-9A-Z]+$/);
  await expect(page.getByTestId('pack-state')).toHaveText('Needs 10 live questions');

  await page.getByTestId('pack-refs').fill(`${ref}\nNOPE-${n}`);
  await page.getByTestId('add-to-pack').click();
  await expect(page.getByTestId('questions-added')).toHaveText(`1 added; not found: NOPE-${n}.`);
  await expect(page.getByTestId('pack-questions')).toContainText(`Which soup is pack question ${n} about?`);
  await page.getByRole('button', { name: 'Take out' }).click();
  await expect(page.getByText('None chosen yet.')).toBeVisible();

  await page.goto('/packs');
  await expect(page.getByTestId(`pack-e2e-pack-${n}`)).toContainText('400 coins');
});
