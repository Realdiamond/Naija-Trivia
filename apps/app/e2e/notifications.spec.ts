/**
 * Notifications on the web (step 2.5c): the screen says where this browser stands, and the
 * switches for each kind are kept on the account. Headless Chromium reports notifications as
 * blocked, so this checks that advice; real pushes are covered by the API's tests.
 */
import { expect, test } from '@playwright/test';
import { playTasteTest } from './helpers';

test('the notifications screen says what to do and keeps each switch', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();
  await expect(page.getByTestId('greeting')).toHaveText('Hi, Guest');

  await page.getByTestId('open-notifications').click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId('notify-status')).toContainText('blocked for Who Sabi? in this browser');

  const friends = page.getByRole('switch', { name: 'Friends' });
  await expect(friends).toBeChecked();
  await friends.click();
  await expect(friends).not.toBeChecked();
  // Kept on the account, not just on the screen.
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByRole('switch', { name: 'Friends' }).isChecked();
    })
    .toBe(false);
  await expect(page.getByRole('switch', { name: 'Duels' })).toBeChecked();
});
