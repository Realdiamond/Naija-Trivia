/**
 * The tab bar and the Profile (build plan step 2.11): a player moves between Home, Play, Shop and
 * Profile, sees their numbers, and changes their avatar and home state.
 */
import { expect, test } from '@playwright/test';
import { playTasteTest } from './helpers';

test('the tab bar, the Play tab and the Profile with its numbers and changes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();
  await expect(page.getByTestId('greeting')).toBeVisible();

  // Play lists every way to play.
  await page.getByTestId('tab-play').click();
  await expect(page).toHaveURL(/\/play$/);
  for (const mode of ['friend', 'random', 'party', 'daily', 'practice', 'leaderboards']) {
    await expect(page.getByTestId(`play-${mode}`)).toBeVisible();
  }
  await page.getByTestId('tab-shop').click();
  await expect(page).toHaveURL(/\/shop$/);

  // The Profile: a guest's tier, numbers and changes.
  await page.getByTestId('tab-profile').click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByTestId('me-name')).toHaveText('Guest');
  await expect(page.getByTestId('me-tier')).toContainText('Rating');
  await expect(page.getByTestId('me-stats')).toContainText('Practice games');

  await page.getByTestId('me-edit').click();
  await page.getByTestId('me-avatar-av_kaftan_blue').click();
  await page.getByText('Choose your state').click();
  await page.getByText('Lagos', { exact: true }).click();
  await page.getByTestId('me-save').click();
  await expect(page.getByTestId('me-edit-sheet')).toBeHidden();
  await expect(page.getByText('Lagos', { exact: true })).toBeVisible();

  await page.getByTestId('tab-home').click();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await expect(page.getByTestId('tab-profile')).toBeVisible();
});
