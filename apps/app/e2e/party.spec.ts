/**
 * Party rooms (build plan step 2.2b): Tolu makes a room in the app, Bola opens its link in another
 * browser with just a nickname, and they play a whole 5-question game, the Wahala Round included,
 * to the podium and back to the lobby.
 */
import { expect, test } from '@playwright/test';
import { newPlayer } from './helpers';

test('a host and a web guest play a party game from the link to the podium', async ({ browser }) => {
  test.setTimeout(150_000);
  const tolu = await newPlayer(browser);
  const bola = await newPlayer(browser);

  // Tolu: a guest in the app, so the room asks for a nickname.
  await tolu.goto('/');
  await tolu.getByTestId('start').click();
  await expect(tolu).toHaveURL(/\/taste$/);
  await tolu.goto('/home');
  await tolu.getByTestId('party').click();
  await expect(tolu).toHaveURL(/\/party$/);
  await tolu.getByTestId('party-nickname').fill('Tolu');
  await tolu.getByTestId('party-questions-5').click();
  await tolu.getByTestId('party-timer-10').click();
  await tolu.getByTestId('party-create').click();
  await expect(tolu).toHaveURL(/\/party\/[A-Z0-9]{5}$/);
  const code = (await tolu.getByTestId('party-code').textContent())!.trim();
  await expect(tolu.getByTestId('party-link')).toContainText(`/r/${code}`);
  await expect(tolu.getByTestId('party-start')).toBeDisabled();

  // Bola: never signed in, just a nickname, in the full web app (?app=1; party-light.spec.ts has
  // the light party client).
  await bola.goto(`/r/${code}?app=1`);
  await expect(bola.getByTestId('party-joining')).toHaveText("You're joining Tolu's party");
  await bola.getByTestId('party-nickname').fill('Bola');
  await bola.getByTestId('party-join').click();
  await expect(bola).toHaveURL(new RegExp(`/party/${code}$`));
  await expect(bola.getByTestId('party-player-Bola')).toBeVisible();
  await expect(bola.getByText('Waiting for Tolu to start the game.')).toBeVisible();
  await expect(tolu.getByTestId('party-player-Bola')).toBeVisible();

  await tolu.getByTestId('party-start').click();
  for (let n = 1; n <= 5; n++) {
    for (const page of [tolu, bola]) {
      await expect(page.getByText(new RegExp(`Q${n} of 5`))).toBeVisible({ timeout: 15_000 });
      await page.getByTestId(`option-${n % 2}`).click();
    }
    if (n === 3) await expect(bola.getByTestId('party-wahala')).toBeVisible();
    await expect(bola.getByTestId('party-result')).toBeVisible();
    await expect(tolu.getByTestId('party-board')).toBeVisible();
  }

  for (const page of [tolu, bola])
    await expect(page.getByTestId('party-winner')).toBeVisible({ timeout: 15_000 });
  await expect(bola.getByTestId('party-again')).toHaveCount(0);
  await tolu.getByTestId('party-again').click();
  await expect(bola.getByText('Waiting for Tolu to start the game.')).toBeVisible();
  await expect(tolu.getByTestId('party-start')).toBeEnabled();
});
