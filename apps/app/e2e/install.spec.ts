/**
 * The installable web app (build plan step 2.8c): the service worker keeps the app's files, so a
 * repeat visit doesn't download them again and the app still opens offline; from the second
 * visit Home offers to install it. Headless Chromium never offers its install prompt by itself,
 * so the test plays the browser's part.
 */
import { expect, test, type Page } from '@playwright/test';
import { playTasteTest } from './helpers';

const offerInstall = (page: Page) =>
  page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        (window as unknown as { prompted: boolean }).prompted = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });

test('the web app keeps its files on the phone and opens without a connection', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('start')).toBeVisible();
  // The worker takes over and keeps the shell and what the page had already loaded.
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

  const bundles: { url: string; fromWorker: boolean }[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/_expo/static/js/'))
      bundles.push({ url: r.url(), fromWorker: r.fromServiceWorker() });
  });
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible();
  expect(bundles.length).toBeGreaterThan(0);
  expect(bundles.filter((b) => !b.fromWorker)).toEqual([]);

  // No connection at all: the app still opens, from the phone.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('start')).toBeVisible();
  await expect(page.getByText('Naija trivia with your own people.')).toBeVisible();
});

test('from the second visit, Home offers to install the web app', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await offerInstall(page);
  // Not on the first visit.
  await expect(page.getByTestId('install-card')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await offerInstall(page);
  await expect(page.getByTestId('install-card')).toBeVisible();
  await expect(page.getByTestId('install-card')).toContainText('Put Who Sabi? on your home screen');
  // "Not now" waits a week.
  await page.getByTestId('install-later').click();
  await expect(page.getByTestId('install-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await offerInstall(page);
  await expect(page.getByTestId('install-card')).toHaveCount(0);

  // Install shows the browser's own prompt.
  await page.evaluate(() => localStorage.removeItem('install.dismissedAt'));
  await page.reload();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await offerInstall(page);
  await page.getByTestId('install-app').click();
  await expect(page.getByTestId('install-card')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
});
