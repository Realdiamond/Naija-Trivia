/**
 * Random opponents (build plan step 2.3): Ada asks for a random opponent and plays round 1 while
 * the game looks for one; Bola asks a moment later and lands in Ada's duel, ready to play. The
 * Sabi Bot, a minute later, needs the worker: the API's tests cover it.
 */
import { expect, test } from '@playwright/test';
import { newPlayer, pickCategory, playRound } from './helpers';

test('a random opponent near your rating joins your duel', async ({ browser }) => {
  test.setTimeout(120_000);
  const ada = await newPlayer(browser);
  const bola = await newPlayer(browser);
  for (const page of [ada, bola]) {
    await page.goto('/');
    await page.getByTestId('start').click();
    await expect(page).toHaveURL(/\/taste$/);
    await page.goto('/home');
  }

  await ada.getByTestId('random').click();
  await expect(ada).toHaveURL(/\/duel\//);
  const duelPath = new URL(ada.url()).pathname;
  await pickCategory(ada);
  await playRound(ada);
  await expect(ada.getByTestId('waiting-title')).toHaveText('Finding you an opponent');

  // Bola goes straight into Ada's duel: round 1 is Ada's pick, round 2 Bola's.
  await bola.getByTestId('random').click();
  await expect(bola).toHaveURL(new RegExp(`${duelPath}$`));
  await playRound(bola);
  await pickCategory(bola);
  await playRound(bola);
  await expect(bola.getByTestId('waiting-title')).toHaveText('Your turn is done');

  // Ada's home now has the duel under "Your turn".
  await ada.goto('/home');
  await expect(ada.getByText('Your turn')).toBeVisible();
});
