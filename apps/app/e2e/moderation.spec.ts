/**
 * Moderation (build plan step 2.7d): a moderator warns a player through the admin API; the
 * player's Home shows the warning until they say they have read it.
 */
import { expect, test } from '@playwright/test';
import { API, staffHeaders } from './helpers';

test("a moderator's warning shows on Home until the player has read it", async ({ page, request }) => {
  const headers = await staffHeaders(request, 'moderator');
  await page.goto('/');
  const guest = page.waitForResponse(
    (r) => r.url().endsWith('/v1/auth/guest') && r.request().method() === 'POST',
  );
  await page.getByTestId('start').click();
  const userId = ((await (await guest).json()) as { user: { id: string } }).user.id;
  await expect(page).toHaveURL(/\/taste$/);
  await page.goto('/home');
  await expect(page.getByTestId('greeting')).toBeVisible();

  const warned = await request.post(`${API}/admin/users/${userId}/actions`, {
    headers,
    data: { type: 'warn', message: 'Please keep party nicknames clean.', reason: 'E2E report 7' },
  });
  expect(warned.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('warning-notice')).toContainText('Please keep party nicknames clean.');
  await page.getByTestId('warning-ok').click();
  await expect(page.getByTestId('warning-notice')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('warning-notice')).toHaveCount(0);
});
