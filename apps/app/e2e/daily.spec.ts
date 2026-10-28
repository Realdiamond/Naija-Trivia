/**
 * The Daily Sabi Challenge (PRD US-8) against the real API: a guest plays today's 7 questions
 * from Home, gets the grid and the share text, finds themselves on the boards, and a friend
 * opening the shared link lands on today's Daily in their browser.
 */
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
  const share = await page.getByTestId('daily-share-text').textContent();
  expect(share).toMatch(new RegExp(`^Who Sabi\\? #${id} [0-7]/7 ⏱ \\d+s`));
  expect(share).toMatch(/[🟩🟥]{7}/u);
  expect(share).toContain(`/daily/${id}`);

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

  // A friend opens the shared link in their own browser and goes straight into today's Daily.
  const friend = await newPlayer(browser);
  await friend.goto(`/daily/${id}`);
  await expect(friend.getByTestId('daily-landing-title')).toHaveText(`Daily Sabi #${id}`);
  await friend.getByTestId('daily-play').click();
  await expect(friend.getByText('Question 1 of 7')).toBeVisible();
  await expect(friend.getByText(`Daily Sabi #${id}`)).toBeVisible();
});
