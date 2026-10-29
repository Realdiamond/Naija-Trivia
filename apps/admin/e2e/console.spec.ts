/**
 * The admin console v0 against the real API and worker (doc 18 §7, §16, AD-1, AD-5): a player
 * plays and signs up; support finds them, sees the game in their timeline, reveals the phone
 * number with a reason, and every look is in the audit log.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3100';
const repo = path.resolve(process.cwd(), '../..');

function addStaff(email: string, roles: string) {
  const db = new URL(process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres');
  db.pathname = '/whosabi_e2e';
  execFileSync('pnpm', ['--filter', '@whosabi/api', 'admin:add', email, 'E2E Staff', roles], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: db.toString() },
    stdio: 'ignore',
  });
}

async function lastCode(): Promise<string> {
  const log = await readFile(path.join(test.info().project.testDir, '.output/api.log'), 'utf8');
  const code = [...log.matchAll(/code is (\d{6})/g)].at(-1)?.[1];
  if (!code) throw new Error('no sign-in code in the API log');
  return code;
}

/** A guest plays the taste test, then signs up with a phone number, all through the API. */
async function playerWhoPlayed(request: APIRequestContext) {
  const guest = await (
    await request.post(`${API}/v1/auth/guest`, {
      data: { device_id: randomBytes(24).toString('base64url'), platform: 'web' },
    })
  ).json();
  const headers = { authorization: `Bearer ${guest.access}` };
  const round = await (
    await request.post(`${API}/v1/rounds`, { headers, data: { mode: 'taste_test' } })
  ).json();
  for (let seq = 1; seq <= round.total; seq++) {
    await request.post(`${API}/v1/rounds/${round.round_id}/questions/${seq}/serve`, { headers });
    await request.post(`${API}/v1/rounds/${round.round_id}/questions/${seq}/answer`, {
      headers,
      data: { display_index: 0, client_elapsed_ms: 1500 },
    });
  }
  const phone = `+234803${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const sent = await (
    await request.post(`${API}/v1/auth/otp/send`, { headers, data: { phone, platform: 'android' } })
  ).json();
  const account = await (
    await request.post(`${API}/v1/auth/otp/verify`, {
      headers,
      data: { request_id: sent.request_id, code: await lastCode() },
    })
  ).json();
  return { id: account.user.id as string, phone };
}

test('support finds a player, sees their game, reveals the phone with a reason, all logged', async ({
  page,
  request,
}) => {
  const email = `e2e-owner-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'owner');
  const player = await playerWhoPlayed(request);

  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  // Owners land on the Overview (step 2.7a).
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByTestId('staff-name')).toContainText('owner');
  await expect(page.getByTestId('overview-tiles')).toContainText('Online now');
  await expect(page.getByTestId('queues')).toContainText('Question reports');

  // Search by user id from the top bar, then open User 360.
  await page.getByTestId('search').fill(player.id);
  await page.getByTestId('search').press('Enter');
  await page.getByTestId('results').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/players/${player.id}`));
  await expect(page.getByTestId('masked-phone')).toHaveText(`+234 80• ••• ${player.phone.slice(-4)}`);
  await expect(page.getByText(player.phone)).toHaveCount(0);

  // Reveal needs a reason and shows the full number once.
  await page.getByTestId('reveal').click();
  await page.getByTestId('reveal-reason').fill('E2E ticket 42: confirm the number');
  await page.getByTestId('reveal-confirm').click();
  await expect(page.getByTestId('revealed')).toHaveText(player.phone);

  // The taste test reaches the timeline through the event stream and the worker (AD-1).
  await page.getByRole('link', { name: 'Timeline' }).click();
  await expect(page).toHaveURL(/tab=timeline/);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page
          .getByTestId('timeline')
          .getByText(/Question 1 shown \(taste_test\)/)
          .count();
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('timeline')).toContainText('Signed up with phone');

  // Every look and the reveal, with its reason, are in the player's admin history.
  await page.getByRole('link', { name: 'Admin history' }).click();
  await expect(page).toHaveURL(/tab=history/);
  await expect(page.getByTestId('history')).toContainText('reveal pii');
  await expect(page.getByTestId('history')).toContainText('E2E ticket 42: confirm the number');
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByTestId('audit')).toContainText('search users');

  await page.getByRole('link', { name: 'Staff and roles' }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByTestId(`staff-${email}`)).toContainText('owner');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/players');
  await expect(page).toHaveURL(/\/login/);
});

test('a moderator sees the party rooms on Live and closes one, with a reason', async ({ page, request }) => {
  const email = `e2e-mod-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'moderator');
  // A guest opens a party room in the game.
  const guest = await (
    await request.post(`${API}/v1/auth/guest`, {
      data: { device_id: randomBytes(24).toString('base64url'), platform: 'web' },
    })
  ).json();
  const categories = (
    (await (await request.get(`${API}/v1/categories`)).json()).categories as Array<{ id: string }>
  ).map((c) => c.id);
  const created = await (
    await request.post(`${API}/v1/party/rooms`, {
      headers: { authorization: `Bearer ${guest.access}` },
      data: {
        settings: {
          questions: 5,
          timer_s: 10,
          family_safe: false,
          wahala: true,
          host_plays: true,
          categories,
        },
        nickname: 'Tolu',
      },
    })
  ).json();
  const code = created.room.code as string;

  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole('link', { name: 'Live' }).click();
  await expect(page).toHaveURL(/\/live$/);
  const room = page.getByTestId(`room-${code}`);
  await expect(room).toContainText("Tolu's room · lobby");

  // Closing needs a reason; then the room is gone.
  await expect(page.getByTestId(`close-${code}`)).toBeDisabled();
  await page.getByTestId(`reason-${code}`).fill('E2E: test room');
  await page.getByTestId(`close-${code}`).click();
  await expect(room).toHaveCount(0);
  const preview = await request.get(`${API}/v1/party/rooms/${code}`);
  expect(preview.status()).toBe(404);
});

test('support leaves a note, grants coins within the limit and signs a player out', async ({
  page,
  request,
}) => {
  const email = `e2e-support-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'support');
  const guest = await (
    await request.post(`${API}/v1/auth/guest`, {
      data: { device_id: randomBytes(24).toString('base64url'), platform: 'android' },
    })
  ).json();
  const id = guest.user.id as string;

  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page.getByTestId('staff-name')).toContainText('support');
  await page.goto(`/players/${id}?tab=support`);

  await page.getByTestId('note-body').fill('E2E: says a duel froze on question 3');
  await page.getByTestId('note-save').click();
  await expect(page.getByTestId('notes')).toContainText('E2E: says a duel froze on question 3');

  // 100 coins, then 450 more is over support's 500 a day.
  await page.getByTestId('action-amount').fill('100');
  await page.getByTestId('action-reason').fill('E2E ticket 77: frozen duel');
  await page.getByTestId('action-confirm').click();
  await expect(page.getByTestId('action-done')).toHaveText('Granted 100 coins. They now have 100.');
  await expect(page.getByTestId('player-tiles')).toContainText('Coins100');
  // The form starts afresh after each action.
  await page.getByTestId('action-amount').fill('450');
  await page.getByTestId('action-reason').fill('E2E ticket 77: more');
  await page.getByTestId('action-confirm').click();
  await expect(page.getByTestId('action-error')).toContainText('400 left today');

  await page.getByRole('link', { name: 'Money', exact: true }).click();
  await expect(page.getByTestId('money-coins')).toHaveText('100');
  await expect(page.getByTestId('ledger')).toContainText('admin grant');

  await page.getByRole('link', { name: 'Support', exact: true }).click();
  await page.getByTestId('action-sign_out').check();
  await page.getByTestId('action-reason').fill('E2E: lost phone');
  await page.getByTestId('action-confirm').click();
  await expect(page.getByTestId('action-done')).toContainText('Signed out of 1 session');
  const refresh = await request.post(`${API}/v1/auth/refresh`, { data: { refresh: guest.refresh } });
  expect(refresh.status()).toBe(401);
});

test('an on-call engineer switches party rooms off and back on, and puts up a banner', async ({
  page,
  request,
}) => {
  const email = `e2e-engineer-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'engineer');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await page.getByRole('link', { name: 'LiveOps' }).click();
  await expect(page).toHaveURL(/\/liveops$/);
  await expect(page.getByTestId('flag-state-party-enabled')).toHaveText('On for everyone');

  await page.getByTestId('flag-change-party-enabled').click();
  await page.getByTestId('flag-party-enabled-on').uncheck();
  await page.getByTestId('flag-party-enabled-reason').fill('E2E: rooms dropping players');
  await page.getByTestId('flag-party-enabled-save').click();
  await expect(page.getByTestId('flag-state-party-enabled')).toHaveText('Off for everyone');
  const config = await (await request.get(`${API}/v1/config`)).json();
  expect(config.flags['party.enabled']).toBe(false);

  await page.getByTestId('banner-en').fill('Party rooms are having issues. Duels still work.');
  await page.getByTestId('banner-reason').fill('E2E: incident');
  await page.getByTestId('banner-set').click();
  await expect(page.getByTestId('banner-now')).toHaveText('Party rooms are having issues. Duels still work.');
  expect((await (await request.get(`${API}/v1/config`)).json()).banner.text_en).toContain('Duels still work');

  await page.getByTestId('banner-reason').fill('E2E: fixed');
  await page.getByTestId('banner-clear').click();
  await expect(page.getByTestId('banner-none')).toBeVisible();
  // The flag's form is still open from before.
  await page.getByTestId('flag-party-enabled-on').check();
  await page.getByTestId('flag-party-enabled-reason').fill('E2E: fixed');
  await page.getByTestId('flag-party-enabled-save').click();
  await expect(page.getByTestId('flag-state-party-enabled')).toHaveText('On for everyone');
});

test('a moderator warns a player and bans them for a week, with reasons', async ({ page, request }) => {
  const email = `e2e-moderator-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'moderator');
  const guest = await (
    await request.post(`${API}/v1/auth/guest`, {
      data: { device_id: randomBytes(24).toString('base64url'), platform: 'android' },
    })
  ).json();

  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page.getByTestId('staff-name')).toContainText('moderator');
  await page.goto(`/players/${guest.user.id}?tab=safety`);

  await page.getByTestId('mod-message').fill('Please keep party nicknames clean.');
  await page.getByTestId('mod-reason').fill('E2E report 5');
  await page.getByTestId('mod-confirm').click();
  await expect(page.getByTestId('mod-done')).toContainText('Warned');
  await expect(page.getByTestId('moderation-history')).toContainText('Please keep party nicknames clean.');
  const me = await (
    await request.get(`${API}/v1/me`, { headers: { authorization: `Bearer ${guest.access}` } })
  ).json();
  expect(me.notices[0].message).toBe('Please keep party nicknames clean.');

  await page.getByTestId('mod-ban').check();
  await page.getByTestId('mod-days').selectOption('7');
  await page.getByTestId('mod-reason').fill('E2E: second report');
  await page.getByTestId('mod-confirm').click();
  await expect(page.getByTestId('mod-done')).toHaveText('Banned for 7 days, and signed out everywhere.');
  await expect(page.getByTestId('player-status')).toContainText('banned until');
  const refresh = await request.post(`${API}/v1/auth/refresh`, { data: { refresh: guest.refresh } });
  expect(refresh.status()).toBe(401);

  // Longer than 30 days needs an admin.
  await page.getByTestId('mod-unban').check();
  await page.getByTestId('mod-reason').fill('E2E: appeal upheld');
  await page.getByTestId('mod-confirm').click();
  await expect(page.getByTestId('mod-done')).toHaveText('Ban lifted. They can sign in again.');
  await page.getByTestId('mod-ban').check();
  await page.getByTestId('mod-days').selectOption('forever');
  await page.getByTestId('mod-reason').fill('E2E: for good');
  await page.getByTestId('mod-confirm').click();
  await expect(page.getByTestId('mod-error')).toContainText('needs an admin');
});

test('LiveOps plans the Dailies and swaps a question in one, with a reason', async ({ page }) => {
  const email = `e2e-liveops-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'liveops');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await page.getByRole('link', { name: 'Daily', exact: true }).click();
  await expect(page).toHaveURL(/\/daily$/);

  // The e2e database starts empty of Dailies: plan the month.
  await page.getByTestId('plan-reason').fill('E2E: plan the month');
  await page.getByTestId('plan').click();
  await expect(page.getByTestId('plan-done')).toContainText('Planned');
  const calendar = page.getByTestId('daily-calendar');
  await expect(calendar.getByText('Not planned')).toHaveCount(0);

  // Three days on is still open: swap its third question.
  const later = new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
  await page.goto(`/daily/${later}`);
  const before = await page.getByTestId('slot-3').locator('b').first().textContent();
  await page.getByTestId('swap-3').click();
  const first = page.getByTestId('slot-3').locator('.candidate').first();
  const replacement = await first.locator('b').first().textContent();
  await first.locator('input[name="reason"]').fill('E2E: too close to last week');
  await first.getByRole('button', { name: 'Use this one' }).click();
  await expect(page.getByTestId('slot-3').locator('b').first()).toHaveText(replacement!);
  expect(replacement).not.toBe(before);
});

test('LiveOps changes a coin value with a reason and rolls it back', async ({ page, request }) => {
  const email = `e2e-config-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'liveops');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole('link', { name: 'LiveOps' }).click();
  await expect(page.getByTestId('config-now-econ-rewarded_ad_coins')).toHaveText('25');

  await page.getByTestId('config-change-econ-rewarded_ad_coins').click();
  await page.getByTestId('config-econ-rewarded_ad_coins-value').fill('40');
  await page.getByTestId('config-econ-rewarded_ad_coins-reason').fill('E2E: weekend promo');
  await page.getByTestId('config-econ-rewarded_ad_coins-save').click();
  await expect(page.getByTestId('config-now-econ-rewarded_ad_coins')).toHaveText('40');
  const config = await (await request.get(`${API}/v1/config`)).json();
  expect(config.values['econ.rewarded_ad_coins']).toBe(40);

  await page.getByTestId('config-econ-rewarded_ad_coins-reason').fill('E2E: promo over');
  await page.getByTestId('config-econ-rewarded_ad_coins-rollback').click();
  await expect(page.getByTestId('config-now-econ-rewarded_ad_coins')).toHaveText('25');
});

test('LiveOps schedules a Home banner that reaches the apps at once, and ends it', async ({
  page,
  request,
}) => {
  const email = `e2e-events-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'liveops');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole('link', { name: 'LiveOps' }).click();

  const title = `E2E pack ${randomInt(1e6)}`;
  // The console's times are Lagos time (UTC+1).
  const wat = (offsetMs: number) => new Date(Date.now() + 3_600_000 + offsetMs).toISOString().slice(0, 16);
  await page.getByTestId('event-new').click();
  await page.getByTestId('event-title').fill(title);
  await page.getByTestId('event-body').fill('Play it before Sunday.');
  await page.getByTestId('event-action').selectOption('party');
  await page.getByTestId('event-starts').fill(wat(-60_000));
  await page.getByTestId('event-ends').fill(wat(2 * 3_600_000));
  await page.getByTestId('event-reason').fill('E2E: flash pack');
  await page.getByTestId('event-save').click();
  await expect(page.getByTestId('event-done')).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row.getByText('Running')).toBeVisible();
  const config = await (await request.get(`${API}/v1/config`, { headers: { 'x-platform': 'web' } })).json();
  expect(config.home.map((b: { title_en: string }) => b.title_en)).toContain(title);

  await row.getByPlaceholder('Reason').fill('E2E: pack pulled');
  await row.getByRole('button', { name: 'End now' }).click();
  await expect(row.getByText('Ended')).toBeVisible();
});

test('finance sees a purchase and its refund in Commerce, and downloads the month', async ({
  page,
  request,
}) => {
  const { id } = await playerWhoPlayed(request);
  const store = (fields: Record<string, unknown>) =>
    request.post(`${API}/v1/webhooks/revenuecat`, {
      headers: { authorization: 'Bearer e2e-revenuecat' },
      data: {
        api_version: '1.0',
        event: {
          id: randomBytes(12).toString('hex'),
          type: 'NON_RENEWING_PURCHASE',
          app_user_id: id,
          product_id: 'coins_large',
          store: 'PLAY_STORE',
          environment: 'PRODUCTION',
          price_in_purchased_currency: 1500,
          currency: 'NGN',
          purchased_at_ms: Date.now(),
          ...fields,
        },
      },
    });
  const tx = `GPA.${randomBytes(8).toString('hex')}`;
  expect((await store({ transaction_id: tx })).status()).toBe(200);
  expect(
    (await store({ transaction_id: tx, type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' })).status(),
  ).toBe(200);

  const email = `e2e-finance-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'finance');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole('link', { name: 'Commerce' }).click();
  await expect(page.getByTestId('commerce-today')).toContainText('refund');
  await page.getByTestId('only-refunds').click();
  await expect(page.getByTestId('purchases')).toContainText('coins_large');
  await expect(page.getByTestId('purchases')).toContainText('Refunded');

  const month = new Date(Date.now() + 3_600_000).toISOString().slice(0, 7);
  const download = page.waitForEvent('download');
  await page.getByTestId(`export-${month}`).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`whosabi-purchases-${month}.csv`);
});

test('an analyst reads the KPI dashboards and narrows them to a platform', async ({ page, request }) => {
  await playerWhoPlayed(request);
  const email = `e2e-analyst-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'analyst');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page).toHaveURL(/\/overview$/);

  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByTestId('dau')).toBeVisible();
  await expect(
    page.getByTestId('session-lengths').or(page.getByText('No sessions in this range.')),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Growth & invites' }).click();
  await expect(page.getByTestId('new-players').locator('b')).not.toHaveText('0');
  await expect(page.getByTestId('growth-days')).toBeVisible();

  await page.getByLabel('Platform').selectOption('ios');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/platform=ios/);
  await expect(page).toHaveURL(/board=growth/);
  await expect(page.getByTestId('new-players').locator('b')).toHaveText('0');

  await page.getByRole('link', { name: 'Retention' }).click();
  await expect(page).toHaveURL(/platform=ios/);
  await expect(page.getByTestId('d1')).toBeVisible();

  await page.getByRole('link', { name: 'Gameplay' }).click();
  await expect(page.getByTestId('duels-finished')).toBeVisible();
  await expect(page.getByText('Matches count every platform')).toBeVisible();
  await page.getByRole('link', { name: 'Monetisation' }).click();
  await expect(page.getByTestId('store-revenue')).toBeVisible();
  // The ledger knows no platforms: Economy has no platform filter.
  await page.getByRole('link', { name: 'Economy' }).click();
  await expect(page.getByTestId('coins-earned')).toBeVisible();
  await expect(page.getByLabel('Platform')).toHaveCount(0);

  // A funnel of their own: the shop, then paying.
  await page.getByRole('link', { name: 'Funnels' }).click();
  await expect(page.getByTestId('funnel')).toBeVisible();
  await page.getByLabel('Events in order, with commas').fill('store_viewed,purchase_completed');
  await page.getByRole('button', { name: 'Build' }).click();
  await expect(page).toHaveURL(/funnel=custom/);
  await expect(page.getByTestId('funnel')).toContainText('purchase_completed');
  await page.getByRole('link', { name: 'Content', exact: true }).click();
  await expect(page.getByTestId('answers')).toBeVisible();
  await page.getByRole('link', { name: 'Tech health' }).click();
  await expect(page.getByTestId('cold-start')).toBeVisible();
  await page.getByRole('navigation', { name: 'Dashboards' }).getByRole('link', { name: 'Integrity' }).click();
  await expect(page.getByTestId('open-now')).toBeVisible();
});

test('finance sees Monetisation and Economy, and not the other dashboards', async ({ page }) => {
  const email = `e2e-finance-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'finance');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole('link', { name: 'Analytics' }).click();
  const tabs = page.getByRole('navigation', { name: 'Dashboards' });
  await expect(tabs.getByRole('link')).toHaveText(['Monetisation', 'Economy']);
  await expect(page.getByTestId('store-revenue')).toBeVisible();
});

test('an owner adds an alert rule, switches it off and deletes it', async ({ page }) => {
  const email = `e2e-alerts-${randomInt(1e9)}@whosabi.ng`;
  addStaff(email, 'owner');
  await page.goto('/login');
  await page.getByTestId('dev-email').fill(email);
  await page.getByTestId('dev-sign-in').click();
  await expect(page.getByTestId('staff-name')).toBeVisible();
  await page.getByRole('link', { name: 'Alert rules' }).click();

  const form = page.getByTestId('new-rule');
  await form.getByLabel('Watch').selectOption('otp_success');
  await form.getByLabel('Alert when it is').selectOption('below');
  await form.getByLabel('Line').fill('80');
  await form.getByLabel('Over the last (minutes)').fill('20');
  await form.getByLabel('Name (optional)').fill('Codes failing');
  // Email and Slack are not set up on this server: only staff phones can be chosen.
  await expect(form.getByLabel('Email')).toBeDisabled();
  await page.getByTestId('add-rule').click();
  await expect(page.getByTestId('rule-added')).toBeVisible();

  const row = page.getByTestId('rules').getByRole('row', { name: /Codes failing/ });
  await expect(row).toContainText('Sign-in codes verified below 80%, over the last 20 minutes');
  await expect(row).toContainText('Not checked yet');
  await row.getByRole('button', { name: 'Switch off' }).click();
  await expect(row).toContainText('Switched off');
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('rules').getByRole('row', { name: /Codes failing/ })).toHaveCount(0);
});

test('support logs a data request and the DPO erases the account, with reasons', async ({
  page,
  request,
}) => {
  const supportEmail = `e2e-support-${randomInt(1e9)}@whosabi.ng`;
  const dpoEmail = `e2e-dpo-${randomInt(1e9)}@whosabi.ng`;
  addStaff(supportEmail, 'support');
  addStaff(dpoEmail, 'dpo');
  const guest = await (
    await request.post(`${API}/v1/auth/guest`, {
      data: { device_id: randomBytes(24).toString('base64url'), platform: 'android' },
    })
  ).json();
  const signIn = async (email: string) => {
    await page.goto('/login');
    await page.getByTestId('dev-email').fill(email);
    await page.getByTestId('dev-sign-in').click();
    await expect(page.getByTestId('staff-name')).toBeVisible();
  };

  await signIn(supportEmail);
  await page.goto(`/players/${guest.user.id}?tab=support`);
  await page.getByTestId('dsar-kind').selectOption('erasure');
  await page.getByTestId('dsar-note').fill('E2E: email to help@ asking to be deleted');
  await page.getByTestId('dsar-log').click();
  await expect(page.getByTestId('dsar-done')).toContainText('Logged');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(dpoEmail);
  await page.getByRole('link', { name: 'Data requests' }).click();
  await expect(page).toHaveURL(/\/compliance$/);
  const row = page.getByTestId('dsar-queue').locator('tr', { hasText: 'E2E: email to help@' });
  await expect(row).toContainText('Delete the account');
  await row.locator('input[name="reason"]').fill('E2E: their email');
  await row.locator('input[name="confirm"]').fill('ERASE');
  await row.getByRole('button', { name: 'Erase now' }).click();
  // Done: it leaves the open queue.
  await expect(row).toHaveCount(0);
  const refresh = await request.post(`${API}/v1/auth/refresh`, { data: { refresh: guest.refresh } });
  expect(refresh.status()).toBe(401);
  await page.goto('/compliance?status=done');
  await expect(page.getByTestId('dsar-queue')).toContainText('E2E: email to help@');
});

test('someone not on the staff list is turned away', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('dev-email').fill('stranger@example.com');
  await page.getByTestId('dev-sign-in').click();
  await expect(page.getByText(/not on the staff list/)).toBeVisible();
});
