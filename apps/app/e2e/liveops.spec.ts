/**
 * LiveOps (build plan step 2.7c, doc 18 AD-7): staff switch party rooms off and put up a status
 * banner through the admin API; a player's Home shows both, and the server refuses a new room.
 * Home banners and events (step 2.7h) show on Home while they run.
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

test('Home banners and Weekend Wahala show on Home while they run', async ({ page, request }) => {
  const headers = await staffHeaders(request, 'liveops');
  const schedule = async (data: object) =>
    (
      await request.post(`${API}/admin/events`, {
        headers,
        data: {
          starts_at: new Date(Date.now() - 60_000).toISOString(),
          ends_at: new Date(Date.now() + 3_600_000).toISOString(),
          reason: 'E2E: events',
          ...data,
        },
      })
    ).json() as Promise<{ id: number }>;
  const news = await schedule({
    kind: 'banner',
    title_en: 'Owambe Starter Pack is here',
    action: 'leaderboards',
  });
  const wahala = await schedule({ kind: 'double_xp', title_en: 'Weekend Wahala', category_id: 'music' });
  try {
    await page.goto('/');
    await page.getByTestId('start').click();
    await expect(page).toHaveURL(/\/taste$/);
    await page.goto('/home');
    await expect(page.getByTestId(`home-banner-${wahala.id}`)).toContainText('2× XP');
    await expect(page.getByTestId(`home-banner-${wahala.id}`)).toContainText(
      'Double XP for every Music answer',
    );
    await expect(page.getByTestId(`home-banner-${news.id}`)).toContainText('Owambe Starter Pack is here');

    // Closed stays closed on this device.
    await page.getByTestId(`home-banner-close-${wahala.id}`).click();
    await expect(page.getByTestId(`home-banner-${wahala.id}`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId(`home-banner-${news.id}`)).toBeVisible();
    await expect(page.getByTestId(`home-banner-${wahala.id}`)).toHaveCount(0);

    // Tapping one opens its screen.
    await page.getByTestId(`home-banner-open-${news.id}`).click();
    await expect(page).toHaveURL(/\/leaderboards$/);
  } finally {
    for (const { id } of [news, wahala]) {
      await request.post(`${API}/admin/events/${id}/end`, { headers, data: { reason: 'E2E: done' } });
    }
  }
});
