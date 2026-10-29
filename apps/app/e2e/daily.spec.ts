/**
 * The Daily Sabi Challenge (PRD US-8) against the real API: a guest plays today's 7 questions
 * from Home, gets the grid, the share text and a Status picture, finds themselves on the boards,
 * and a friend opening the shared link lands on today's Daily in their browser.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { newPlayer, playTasteTest } from './helpers';

test('a guest plays the Daily, shares the grid and finds themselves on the boards', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();

  const banner = page.getByTestId('daily-banner');
  await expect(banner).toContainText(/Daily #\d+ dey wait/);
  const id = Number((await banner.textContent())!.match(/Daily #(\d+)/)![1]);
  await banner.click();

  for (let seq = 1; seq <= 7; seq++) {
    await expect(page.getByText(`Question ${seq} of 7`)).toBeVisible();
    await expect(page.getByTestId('option-0')).toBeEnabled();
    await page.getByTestId(`option-${seq % 2}`).click();
    await expect(page.getByTestId('reveal')).toBeVisible();
    await page.getByTestId('next').click();
  }

  await expect(page).toHaveURL(new RegExp(`/daily/${id}$`));
  await expect(page.getByTestId('daily-title')).toHaveText(`Daily Sabi #${id}`);
  await expect(page.getByTestId('daily-score')).toHaveText(/^[0-7]\/7$/);
  await expect(page.getByTestId('daily-streak')).toHaveText('1 day');
  // The first day of a streak pays 20 coins (step 2.4a).
  await expect(page.getByTestId('daily-reward')).toHaveText(/^\+20 coins · \+\d+ XP$/);
  const share = await page.getByTestId('daily-share-text').textContent();
  expect(share).toMatch(new RegExp(`^Who Sabi\\? #${id} [0-7]/7 ⏱ \\d+s`));
  expect(share).toMatch(/[🟩🟥]{7}/u);
  expect(share).toContain(`/daily/${id}`);

  // The picture for WhatsApp Status: this browser can't share files, so it downloads it.
  const download = page.waitForEvent('download');
  await page.getByTestId('daily-share-picture').click();
  const picture = await download;
  expect(picture.suggestedFilename()).toBe(`whosabi-daily-${id}.png`);
  expect((await readFile(await picture.path())).subarray(1, 4).toString('ascii')).toBe('PNG');
  await expect(page.getByTestId('daily-share-picture-note')).toContainText('Picture saved');

  await page.getByTestId('daily-review').click();
  await expect(page.getByText(/^Answer: /).first()).toBeVisible();

  // Guests start on All Naija; this week's board and today's both have them.
  await page.getByTestId('daily-leaderboards').click();
  await expect(page.getByTestId('lb-scope-global')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('lb-you')).toContainText('You');
  await page.getByTestId('lb-period-daily').click();
  await expect(page.getByTestId('lb-you')).toBeVisible();
  await page.getByTestId('lb-scope-friends').click();
  await expect(page.getByTestId('lb-empty')).toContainText('Sign up to add friends');

  // Back home, the Daily is done for today; the result stays one tap away.
  await page.goto('/home');
  await expect(page.getByTestId('daily-banner')).toContainText(`Daily #${id} done`);
  // The coins show on Home, and what earned them on the Coins screen.
  await expect(page.getByTestId('coin-balance')).toHaveText('20');
  await page.getByTestId('open-coins').click();
  await expect(page.getByTestId('coins-balance')).toHaveText('20');
  await expect(page.getByTestId('coins-entry')).toHaveText(new RegExp(`Daily #${id}.*\\+20$`));
  // The shop lists the coin packs; buying on the web comes with Paystack later (step 2.4d).
  await page.getByTestId('open-shop').click();
  await expect(page.getByTestId('shop-balance')).toHaveText('20 coins');
  await expect(page.getByTestId('pack-coins_medium')).toContainText('1,500');
  await expect(page.getByTestId('pack-coins_medium')).toContainText('₦800');
  await expect(page.getByTestId('pack-coins_medium')).toBeDisabled();
  await expect(page.getByTestId('shop-soon')).toContainText('coming soon');

  // A friend opens the shared link in their own browser and goes straight into today's Daily.
  const friend = await newPlayer(browser);
  await friend.goto(`/daily/${id}`);
  await expect(friend.getByTestId('daily-landing-title')).toHaveText(`Daily Sabi #${id}`);
  await friend.getByTestId('daily-play').click();
  await expect(friend.getByText('Question 1 of 7')).toBeVisible();
  await expect(friend.getByText(`Daily Sabi #${id}`)).toBeVisible();
});
