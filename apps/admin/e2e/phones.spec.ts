/**
 * Staff phones (step 2.9a): a phone signed in to staff tools in the app shows in the console,
 * and an owner signs it out there, ending its session at once.
 */
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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

test('an owner sees the phones signed in to staff tools and signs one out', async ({ page, request }) => {
  const n = randomInt(1e9);
  const owner = `e2e-phone-owner-${n}@whosabi.ng`;
  const label = `E2E Tecno ${n}`;
  addStaff(owner, 'owner');

  // What the app does after Google sign-in (the dev route stands in for Google here).
  const signedIn = await request.post(`${API}/admin/auth/phone/dev`, { data: { email: owner, label } });
  expect(signedIn.status()).toBe(200);
  const phone = { authorization: `Bearer ${(await signedIn.json()).token}` };
  expect((await request.get(`${API}/admin/overview`, { headers: phone })).status()).toBe(200);

  await signIn(page, owner);
  await page.getByRole('link', { name: 'Staff phones' }).click();
  await expect(page.getByTestId('phones')).toContainText(label);
  await page.getByRole('button', { name: `Sign out ${label}` }).click();
  await expect(page.getByText(label)).toHaveCount(0);
  expect((await request.get(`${API}/admin/overview`, { headers: phone })).status()).toBe(401);
});
