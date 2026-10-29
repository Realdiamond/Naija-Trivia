/**
 * LiveOps (build plan step 2.7c, doc 18 AD-7): staff switch party rooms off and put up a status
 * banner through the admin API; a player's Home shows both, and the server refuses a new room.
 */
import { expect, test } from '@playwright/test';
import { API, staffHeaders } from './helpers';

test('a kill switch and the status banner reach the app', async ({ page, request }) => {
  const headers = await staffHeaders(request, 'liveops');
  const party = (enabled: boolean) =>
    request.post(`${API}/admin/flags/party.enabled`, {
      headers,
      data: { enabled, rules: [], reason: 'E2E: party rooms' },
    });
  const banner = (text: string | null) =>
    request.post(`${API}/admin/banner`, {
      headers,
      data: {
        banner: text ? { level: 'warning', text_en: text, text_pcm: null } : null,
        reason: 'E2E: status banner',
      },
    });

  try {
    expect((await party(false)).status()).toBe(200);
    expect((await banner('Party rooms are having issues. Duels still work.')).status()).toBe(200);

    await page.goto('/');
    await page.getByTestId('start').click();
    await expect(page).toHaveURL(/\/taste$/);
    await page.goto('/home');
    await expect(page.getByTestId('status-banner')).toHaveText(
      'Party rooms are having issues. Duels still work.',
    );
    await expect(page.getByTestId('party')).toContainText('Taking a break');
    await expect(page.getByTestId('party')).toHaveAttribute('aria-disabled', 'true');

    // Back on, and the banner down: the next look at Home has them both gone.
    await party(true);
    await banner(null);
    await page.reload();
    await expect(page.getByTestId('party')).not.toContainText('Taking a break');
    await expect(page.getByTestId('status-banner')).toHaveCount(0);
  } finally {
    await party(true);
    await banner(null);
  }
});
