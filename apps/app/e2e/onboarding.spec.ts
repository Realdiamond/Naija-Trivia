/**
 * First run on the web (UX §2.1): the taste test as a guest, signing up with a phone code,
 * picking a username, and staying signed in after a reload.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** The newest sign-in code the API "sent" (development writes SMS to its log). */
async function lastCode(): Promise<string> {
  const log = await readFile(path.join(test.info().project.testDir, '.output/api.log'), 'utf8');
  const codes = [...log.matchAll(/code is (\d{6})/g)];
  const code = codes.at(-1)?.[1];
  if (!code) throw new Error('no sign-in code in the API log');
  return code;
}

async function playTasteTest(page: Page) {
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('question-text')).toBeVisible();
    await page.getByTestId('option-0').click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('taste-score')).toBeVisible();
}

test('a guest plays the taste test, signs up with a phone code and keeps their progress', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('start')).toBeVisible();

  // Pidgin changes the words at once.
  await page.getByTestId('language-pcm').click();
  await expect(page.getByTestId('start')).toHaveText(/Make we start/);
  await page.getByTestId('language-en').click();

  await page.getByTestId('start').click();
  await expect(page).toHaveURL(/\/taste$/);
  await expect(page.getByText('Question 1 of 3')).toBeVisible();
  await playTasteTest(page);
  await expect(page.getByTestId('taste-score')).toHaveText(/\d\/3/);

  // Save progress: phone codes are on in development.
  await page.getByTestId('signin-phone').click();
  await page.getByTestId('phone').fill('0803 123 4567');
  await page.getByTestId('send-code').click();
  await expect(page.getByText('6-digit code', { exact: true })).toBeVisible();
  await page.getByTestId('code').fill(await lastCode());

  // A new account picks a username, an avatar and an age band.
  await expect(page).toHaveURL(/\/profile-setup$/);
  const username = `e2e_${Date.now().toString(36)}`;
  await page.getByTestId('username').fill(username);
  await page.getByTestId('age-under_13').click();
  await page.getByTestId('profile-continue').click();
  await expect(page.getByText(/for ages 13 and up/)).toBeVisible();
  await page.getByTestId('age-18_plus').click();
  await page.getByTestId('profile-continue').click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('greeting')).toHaveText(`Hi, ${username}`);

  // The refresh cookie brings the same player back after a reload.
  await page.reload();
  await expect(page.getByTestId('greeting')).toHaveText(`Hi, ${username}`);
});

test('a returning guest goes straight home and can play again', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();
  await expect(page.getByTestId('greeting')).toHaveText('Hi, Guest');

  await page.goto('/');
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId('play-again').click();
  await expect(page.getByText('Question 1 of 3')).toBeVisible();
});
