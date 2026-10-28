/**
 * Friends and direct challenges (doc 09 §2.3, §2.5): two accounts become friends by username,
 * one challenges the other, who declines before playing.
 */
import { expect, test } from '@playwright/test';
import { newPlayer, pickCategory, playRound, randomPhone, signUp, uniqueName } from './helpers';

test('friends by username, a direct challenge, and a decline', async ({ browser }) => {
  test.setTimeout(120_000);
  const tolu = await newPlayer(browser);
  const chidi = await newPlayer(browser);
  const toluName = uniqueName('tolu');
  const chidiName = uniqueName('chidi');
  await signUp(tolu, randomPhone(), toluName);
  await signUp(chidi, randomPhone(), chidiName);

  // Tolu asks; Chidi accepts.
  await tolu.getByTestId('open-friends').click();
  await tolu.getByTestId('friend-username').fill(chidiName);
  await tolu.getByTestId('friend-send').click();
  await expect(tolu.getByTestId('friends-message')).toHaveText(`Request sent to ${chidiName}`);

  await chidi.getByTestId('open-friends').click();
  await chidi.getByTestId(`accept-${toluName}`).click();
  await expect(chidi.getByTestId('friends-message')).toHaveText(`You and ${toluName} are friends now`);

  // Friends can challenge each other straight, no link needed.
  await tolu.reload();
  await tolu.getByTestId(`friend-challenge-${chidiName}`).click();
  await expect(tolu).toHaveURL(/\/duel\//);
  await pickCategory(tolu);
  await playRound(tolu);
  await expect(tolu.getByTestId('waiting-title')).toBeVisible();

  // Chidi sees the new challenge and may still decline it.
  await chidi.goto('/home');
  await expect(chidi.getByText('Your turn')).toBeVisible();
  await chidi.locator('[data-testid^="turn-"]').first().click();
  await expect(chidi.getByTestId('intro-play')).toBeVisible();
  await chidi.getByTestId('intro-decline').click();
  await expect(chidi.getByTestId('result-title')).toHaveText('You declined this duel');

  await tolu.goto('/home');
  await expect(tolu.getByText(`Duel with ${chidiName} ended`)).toBeVisible();
});
