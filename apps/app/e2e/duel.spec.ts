/**
 * The M1 goal in the browser: two players finish a duel (doc 19 §3). Tolu sends a duel link,
 * Chidi opens it as a guest, and they take turns until the result, the tie-break included
 * when the scores are level.
 */
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, pickCategory, playRound } from './helpers';

/** Answers the tie-break if the duel needs one, then shows the result. */
async function finish(page: Page, guess: string) {
  const result = page.getByTestId('result-title');
  const tiebreak = page.getByTestId('tiebreak-guess');
  await expect(result.or(tiebreak)).toBeVisible();
  if (await tiebreak.isVisible()) {
    await tiebreak.fill(guess);
    await page.getByTestId('tiebreak-submit').click();
    await expect(page.getByTestId('tiebreak-result')).toBeVisible();
  }
}

test('two players finish a duel through a link, both in the browser', async ({ browser }) => {
  test.setTimeout(180_000);
  const tolu = await newPlayer(browser);
  const chidi = await newPlayer(browser);

  // Tolu starts as a guest and sends a duel link, playing round 1 first.
  await tolu.goto('/');
  await tolu.getByTestId('start').click();
  await expect(tolu).toHaveURL(/\/taste$/);
  await tolu.goto('/home');
  await tolu.getByTestId('challenge').click();
  await tolu.getByTestId('send-link').click();
  await expect(tolu).toHaveURL(/\/duel\//);
  const duelPath = new URL(tolu.url()).pathname;
  await pickCategory(tolu);
  await playRound(tolu);
  await expect(tolu.getByTestId('waiting-title')).toBeVisible();
  const invite = new URL((await tolu.getByTestId('invite-url').textContent()) ?? '');

  // Chidi opens the link in another browser: no install, no sign-up.
  await chidi.goto(invite.pathname);
  await expect(chidi.getByTestId('invite-title')).toContainText('don challenge you');
  await chidi.getByTestId('invite-accept').click();
  await expect(chidi).toHaveURL(/\/duel\//);
  await playRound(chidi); // round 1, picked by Tolu
  await pickCategory(chidi);
  await playRound(chidi); // round 2, Chidi's pick
  await expect(chidi.getByTestId('waiting-title')).toBeVisible();

  // Back to Tolu: the duel is on the home screen under "Your turn".
  await tolu.goto('/home');
  await expect(tolu.getByText('Your turn')).toBeVisible();
  await tolu.goto(duelPath);
  await playRound(tolu); // round 2
  await pickCategory(tolu);
  await playRound(tolu); // round 3, Tolu's pick
  await expect(tolu.getByTestId('waiting-title')).toBeVisible();

  // Chidi plays the last round; a level score goes to the tie-break.
  await chidi.reload();
  await playRound(chidi);
  await finish(chidi, '100');
  await tolu.reload();
  await finish(tolu, '200');
  await chidi.reload();

  const results = [
    await tolu.getByTestId('result-title').textContent(),
    await chidi.getByTestId('result-title').textContent(),
  ];
  expect(
    [
      ['You win!', 'You lose this one'],
      ['You lose this one', 'You win!'],
      ['Draw!', 'Draw!'],
    ].map(String),
  ).toContain(String(results));

  // The finished duel shows under recent results, with a rematch on offer.
  await expect(tolu.getByTestId('rematch')).toBeVisible();
  await tolu.getByTestId('result-home').click();
  await expect(tolu.getByText('Recent results')).toBeVisible();
});
