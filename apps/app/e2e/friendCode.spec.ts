/**
 * Friend codes (build plan step 2.12): a player shows their friend code; a friend opens its link
 * (as their phone's camera would from the QR code) and adds them. Someone who isn't signed up is
 * asked to first.
 */
import { expect, test } from '@playwright/test';
import { newPlayer, randomPhone, signUp, uniqueName } from './helpers';

test('a friend opens a friend code and adds the player', async ({ browser }) => {
  test.setTimeout(120_000);
  const ada = await newPlayer(browser);
  const femi = await newPlayer(browser);
  const adaName = uniqueName('ada');
  const femiName = uniqueName('femi');
  await signUp(ada, randomPhone(), adaName);
  await signUp(femi, randomPhone(), femiName);

  await ada.getByTestId('open-friends').click();
  await expect(ada.getByTestId('friend-code')).toBeVisible();
  const link = (await ada.getByTestId('friend-code-url').textContent())!.trim();
  expect(link).toMatch(new RegExp(`/u/${adaName}$`));

  // The link shows who it is; Femi adds Ada.
  await femi.goto(link);
  await expect(femi.getByTestId('friend-card')).toContainText(adaName);
  await femi.getByTestId('friend-add').click();
  await expect(femi.getByTestId('friend-message')).toHaveText(`Request sent to ${adaName}`);

  // Ada sees the request; her own link says it's hers.
  await ada.reload();
  await expect(ada.getByTestId(`accept-${femiName}`)).toBeVisible();
  await ada.goto(link);
  await expect(ada.getByText("That's your own friend code.", { exact: false })).toBeVisible();

  // Someone new is asked to sign up first.
  const stranger = await newPlayer(browser);
  await stranger.goto(link);
  await expect(stranger.getByTestId('friend-card')).toContainText(adaName);
  await expect(stranger.getByText(`Sign up to add ${adaName} as a friend`, { exact: false })).toBeVisible();
});
