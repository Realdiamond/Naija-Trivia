/** Steps the end-to-end tests share. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

/** A second player needs their own browser: a new context with the project's phone settings. */
export async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...test.info().project.use });
  return context.newPage();
}

async function sentCodes(): Promise<string[]> {
  const log = await readFile(path.join(test.info().project.testDir, '.output/api.log'), 'utf8');
  return [...log.matchAll(/code is (\d{6})/g)].map((m) => m[1]!);
}

/**
 * Sends a sign-in code and types it in. Development "sends" codes by writing them to the API's
 * log, so the test reads the newest one from there.
 */
export async function enterPhoneCode(page: Page, phone: string) {
  const before = (await sentCodes()).length;
  await page.getByTestId('phone').fill(phone);
  await page.getByTestId('send-code').click();
  await expect(page.getByText('6-digit code', { exact: true })).toBeVisible();
  await expect.poll(async () => (await sentCodes()).length).toBeGreaterThan(before);
  await page.getByTestId('code').fill((await sentCodes()).at(-1)!);
}

/** Like a phone code, by email (step 2.10): codes go to the API's log in development too. */
export async function enterEmailCode(page: Page, email: string) {
  const before = (await sentCodes()).length;
  await page.getByTestId('email').fill(email);
  await page.getByTestId('send-code').click();
  await expect(page.getByText(/^We sent a 6-digit code to /)).toBeVisible();
  await expect.poll(async () => (await sentCodes()).length).toBeGreaterThan(before);
  await page.getByTestId('code').fill((await sentCodes()).at(-1)!);
}

/** A new account from scratch: phone code, then username and age. */
export async function signUp(page: Page, phone: string, username: string) {
  await page.goto('/sign-in');
  await enterPhoneCode(page, phone);
  await expect(page).toHaveURL(/\/profile-setup$/);
  await page.getByTestId('username').fill(username);
  await page.getByTestId('age-18_plus').click();
  await page.getByTestId('profile-continue').click();
  await expect(page.getByTestId('greeting')).toHaveText(`Hi, ${username}`);
}

export const uniqueName = (prefix: string) => `${prefix}_${Date.now().toString(36).slice(-6)}`;

/** A fresh Nigerian mobile number, so retries never hit one number's code limits. */
export const randomPhone = () => `0803 ${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;

export async function playTasteTest(page: Page) {
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('question-text')).toBeVisible();
    await page.getByTestId('option-0').click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('taste-score')).toBeVisible();
}

/** Three duel questions, then the round review, then on to whatever comes next. */
export async function playRound(page: Page) {
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('question-text')).toBeVisible();
    await page.getByTestId(`option-${i % 2}`).click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('round-review')).toBeVisible();
  await expect(page.getByTestId('review-continue')).toBeEnabled();
  await page.getByTestId('review-continue').click();
}

export async function pickCategory(page: Page) {
  await page.locator('[data-testid^="category-"]').first().click();
}
