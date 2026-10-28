/**
 * First run on the web (UX §2.1): the taste test as a guest, signing up with a phone code,
 * picking a username, and staying signed in after a reload.
 */
import { expect, test } from '@playwright/test';
import { enterEmailCode, enterPhoneCode, playTasteTest, randomPhone } from './helpers';

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
  await enterPhoneCode(page, randomPhone());

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

test('a guest signs up with a code by email instead', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);

  await page.getByTestId('signin-email').click();
  await expect(page).toHaveURL(/\/sign-in\?with=email$/);
  // Both kinds of code are on in development, so the player can switch.
  await page.getByTestId('switch-channel').click();
  await expect(page.getByTestId('phone')).toBeVisible();
  await page.getByTestId('switch-channel').click();
  await enterEmailCode(page, `e2e.${Date.now().toString(36)}@example.com`);

  await expect(page).toHaveURL(/\/profile-setup$/);
  const username = `em_${Date.now().toString(36)}`;
  await page.getByTestId('username').fill(username);
  await page.getByTestId('age-18_plus').click();
  await page.getByTestId('profile-continue').click();
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
