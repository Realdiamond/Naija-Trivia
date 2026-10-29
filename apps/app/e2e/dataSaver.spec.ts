/**
 * Data Saver (build plan step 2.8b): on by itself while the browser asks to save data, until the
 * player chooses; their choice is kept in their profile, and they can hand it back to the app.
 */
import { expect, test } from '@playwright/test';
import { API } from './helpers';

test('Data Saver follows the browser until the player chooses, and keeps the choice', async ({
  page,
  request,
}) => {
  // A browser with Save-Data on, like Chrome with Android's Data Saver.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: Object.assign(new EventTarget(), { saveData: true, effectiveType: '4g' }),
    });
  });
  await page.goto('/');
  const guest = page.waitForResponse(
    (r) => r.url().endsWith('/v1/auth/guest') && r.request().method() === 'POST',
  );
  await page.getByTestId('start').click();
  const { access } = (await (await guest).json()) as { access: string };
  await expect(page).toHaveURL(/\/taste$/);
  await page.goto('/settings');

  const saver = page.getByRole('switch', { name: 'Data Saver' });
  await expect(saver).toBeChecked();
  await expect(page.getByText('On by itself because your connection is slow.')).toBeVisible();
  await expect(page.getByTestId('data-saver-auto')).toHaveCount(0);

  const saved = page.waitForResponse((r) => r.url().endsWith('/v1/me') && r.request().method() === 'PATCH');
  await saver.click();
  expect((await saved).status()).toBe(200);
  await expect(saver).not.toBeChecked();
  await expect(page.getByText(/Uses less data/)).toBeVisible();

  // Kept in the profile, not only on this device.
  await page.evaluate(() => localStorage.removeItem('data_saver'));
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Data Saver' })).not.toBeChecked();
  const me = async () =>
    (await (await request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${access}` } })).json())
      .data_saver as boolean | null;
  expect(await me()).toBe(false);

  await page.getByTestId('data-saver-auto').click();
  await expect(page.getByRole('switch', { name: 'Data Saver' })).toBeChecked();
  await expect(page.getByText('On by itself because your connection is slow.')).toBeVisible();
  await expect.poll(me).toBeNull();
});
