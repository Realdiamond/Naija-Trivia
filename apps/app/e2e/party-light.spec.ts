/**
 * The light party client (build plan step 2.2c): a party link opened by someone without the app
 * loads the small client, not the full web app, and they play the whole game in it with just a
 * nickname, against a host in the app.
 */
import { expect, test } from '@playwright/test';
import { newPlayer } from './helpers';

test('a party link opens the light client, and its player plays to the podium', async ({ browser }) => {
  test.setTimeout(150_000);
  const tolu = await newPlayer(browser);
  const ada = await newPlayer(browser);

  await tolu.goto('/');
  await tolu.getByTestId('start').click();
  await expect(tolu).toHaveURL(/\/taste$/);
  await tolu.goto('/party');
  await tolu.getByTestId('party-nickname').fill('Tolu');
  await tolu.getByTestId('party-questions-5').click();
  await tolu.getByTestId('party-timer-10').click();
  await tolu.getByTestId('party-create').click();
  await expect(tolu).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  const code = (await tolu.getByTestId('party-code').textContent())!.trim();

  // Ada opens the link: only the light client's small files load, never the full app's.
  const scripts: string[] = [];
  ada.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname);
  });
  await ada.goto(`/r/${code}`);
  await expect(ada.getByTestId('party-joining')).toHaveText("You're joining Tolu's party");
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((s) => s.startsWith('/party-client/'))).toBe(true);
  await ada.getByTestId('party-nickname').fill('Ada');
  await ada.getByTestId('party-join').click();
  await expect(ada.getByTestId('party-waiting')).toHaveText('Waiting for Tolu to start the game.');
  await expect(tolu.getByTestId('party-player-Ada')).toBeVisible();

  await tolu.getByTestId('party-start').click();
  for (let n = 1; n <= 5; n++) {
    for (const page of [tolu, ada]) {
      await expect(page.getByText(new RegExp(`Q${n} of 5`))).toBeVisible({ timeout: 15_000 });
      await page.getByTestId(`option-${n % 2}`).click();
    }
    if (n === 4) await expect(ada.getByTestId('party-wahala')).toBeVisible();
    await expect(ada.getByTestId('party-result')).toBeVisible();
  }
  await expect(ada.getByTestId('party-winner')).toBeVisible({ timeout: 15_000 });
  await expect(ada.getByTestId('get-app')).toBeVisible();

  // A reload goes straight back into the room on the same seat.
  await ada.reload();
  await expect(ada.getByTestId('party-winner')).toBeVisible();
});
