/**
 * The web app on a computer (TRD FR-WEB-4, FR-WEB-5, FR-WEB-11): the consent banner, keyboard
 * play with 1–4, A–D, Enter and Esc, and the side navigation.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 860 }, isMobile: false, hasTouch: false });

test('consent, keyboard play and the side navigation on a computer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('consent-banner')).toBeVisible();
  await page.getByTestId('consent-allow').click();
  await expect(page.getByTestId('consent-banner')).toBeHidden();

  // The choice reaches the server as soon as there is a session (the guest sign-in).
  const consentSaved = page.waitForResponse(
    (res) => res.url().endsWith('/v1/me/consents') && res.status() === 204,
  );
  await page.getByTestId('start').click();
  await consentSaved;

  // The counter shows while a question loads; keys count once its answers can be picked.
  await expect(page.getByText('Question 1 of 3')).toBeVisible();
  await expect(page.getByTestId('option-0')).toBeEnabled();
  await expect(page.getByText(/Press 1 to 4 or A to D/)).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByTestId('reveal')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.getByText('Question 2 of 3')).toBeVisible();
  await expect(page.getByTestId('option-0')).toBeEnabled();
  await page.keyboard.press('b');
  await expect(page.getByTestId('reveal')).toBeVisible();
  await page.keyboard.press('Enter');

  // Esc asks before leaving; Esc again (or "Keep playing") stays.
  await expect(page.getByText('Question 3 of 3')).toBeVisible();
  await expect(page.getByTestId('option-0')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('leave-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('leave-dialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.getByTestId('leave-dialog-confirm').click();

  // Home, with the side navigation instead of a tab bar; the consent choice is remembered.
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('nav-home')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('consent-banner')).toBeHidden();
  await page.getByTestId('nav-challenge').click();
  await expect(page).toHaveURL(/\/challenge$/);
});
