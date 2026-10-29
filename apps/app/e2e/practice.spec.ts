/**
 * Practice (build plan steps 2.8f and 2.8g): a player practises a core pack, which stays on the
 * device; with no connection the app still opens, the saved pack plays, and the game is sent
 * once the player is back.
 */
import { expect, test, type Page } from '@playwright/test';
import { playTasteTest } from './helpers';

async function playPractice(page: Page) {
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('question-text')).toBeVisible();
    await page.getByTestId(`option-${i % 2}`).click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await page.getByTestId('next').click();
  }
  await expect(page.getByTestId('practice-score')).toBeVisible();
}

const waiting = (page: Page) =>
  page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('whosabi.practice') ?? '{}') as { queue?: unknown[] };
    return saved.queue?.length ?? 0;
  });

test('a pack practised online plays again offline, and the game is sent once back', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();
  await expect(page.getByTestId('greeting')).toBeVisible();

  // Online: the Food pack's set comes down with its answers, and the game pays XP at once.
  await page.getByTestId('practice').click();
  await expect(page.getByTestId('pack-food')).toContainText('questions');
  await page.getByTestId('pack-food').click();
  await playPractice(page);
  await expect(page.getByTestId('practice-xp')).toHaveText(/^\+\d+ XP$/);
  await page.getByTestId('practice-back').click();
  await expect(page.getByTestId('pack-food')).toContainText('Saved for offline');

  // The service worker keeps the app, so it opens with no connection at all.
  await page.waitForFunction(
    async () => {
      if (!navigator.serviceWorker.controller) return false;
      const files = await (await caches.open('whosabi-files-v1')).keys();
      const shell = await (await caches.open('whosabi-shell-v1')).match('/__shell');
      return Boolean(shell) && files.some((request) => request.url.includes('/_expo/static/js/'));
    },
    undefined,
    { timeout: 20_000 },
  );
  await context.setOffline(true);
  await page.goto('/');
  await page.getByTestId('practice-offline').click();
  await expect(page.getByText("You're offline. These packs are saved on this device.")).toBeVisible();
  await page.getByTestId('pack-food').click();
  await playPractice(page);
  await expect(page.getByTestId('practice-xp')).toHaveText("You'll get your XP when you're back online.");
  expect(await waiting(page)).toBe(1);

  // Back online: Home sends the game, and the server takes it.
  await context.setOffline(false);
  const sent = page.waitForResponse(
    (r) => r.url().endsWith('/v1/practice/results') && r.request().method() === 'POST',
  );
  await page.goto('/');
  await expect(page.getByTestId('greeting')).toBeVisible();
  expect((await sent).status()).toBe(200);
  await expect.poll(() => waiting(page)).toBe(0);
});
