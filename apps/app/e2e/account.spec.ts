/**
 * Your data and your account (build plan step 2.8a): a player downloads a copy of their data
 * from Settings and deletes their account; the web's /delete-account tells a signed-out visitor
 * how (Google Play's account deletion rule).
 */
import { expect, test } from '@playwright/test';
import { API } from './helpers';

test('a player downloads their data, then deletes their account for good', async ({ page, request }) => {
  await page.goto('/');
  const guest = page.waitForResponse(
    (r) => r.url().endsWith('/v1/auth/guest') && r.request().method() === 'POST',
  );
  await page.getByTestId('start').click();
  const signedIn = (await (await guest).json()) as { access: string; user: { id: string } };
  await expect(page).toHaveURL(/\/taste$/);
  await page.goto('/home');
  await page.getByTestId('open-settings').click();
  await expect(page).toHaveURL(/\/settings$/);

  const download = page.waitForEvent('download');
  await page.getByTestId('download-data').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^whosabi-data-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByTestId('download-note')).toContainText('Your data is ready');

  await page.getByTestId('open-delete').click();
  await expect(page).toHaveURL(/\/delete-account$/);
  await expect(page.getByTestId('delete-account')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('delete-confirm-word').fill('delete');
  await page.getByTestId('delete-account').click();
  await expect(page).toHaveURL(/\/welcome$/);

  const me = await request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${signedIn.access}` } });
  expect(me.status()).toBe(401);
});

test('the web page for deleting an account tells a signed-out visitor how', async ({ page }) => {
  await page.goto('/delete-account');
  await expect(page.getByText('Delete your account')).toBeVisible();
  await expect(page.getByTestId('delete-sign-in')).toBeVisible();
  await expect(page.getByText(/help@whosabi\.ng/)).toBeVisible();
});
