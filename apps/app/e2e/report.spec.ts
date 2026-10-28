/**
 * Reporting a question (PRD US-9, mockup 27): after answering, two taps and an optional note.
 */
import { expect, test } from '@playwright/test';

test('a player reports a question in two taps from the answer screen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('option-0')).toBeEnabled();
  await page.getByTestId('option-0').click();
  await expect(page.getByTestId('reveal')).toBeVisible();

  await page.getByTestId('report-question').click();
  const sheet = page.getByTestId('report-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('report-send')).toBeDisabled();
  await page.getByTestId('reason-typo').click();
  await sheet.getByRole('textbox').fill('The name is spelt wrong');
  const sent = page.waitForResponse(
    (res) => /\/v1\/questions\/[^/]+\/reports$/.test(res.url()) && res.request().method() === 'POST',
  );
  await page.getByTestId('report-send').click();
  expect((await sent).status()).toBe(202);
  await expect(page.getByTestId('report-thanks')).toBeVisible();
  await page.getByRole('button', { name: 'Back to the game' }).click();
  await expect(sheet).toBeHidden();

  // The game goes on where it was.
  await page.getByTestId('next').click();
  await expect(page.getByText('Question 2 of 3')).toBeVisible();
});
