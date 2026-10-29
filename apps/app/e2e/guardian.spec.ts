/**
 * Guardian consent for 13–17s (build plan step 2.8d): a teen who signs up asks a parent or
 * guardian, who gets a code by text; once it's typed in, the profile the teen filled in is saved
 * and they're home. Development "sends" texts by writing them to the API's log.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { enterPhoneCode, randomPhone, uniqueName } from './helpers';

async function guardianCodes(): Promise<string[]> {
  const log = await readFile(path.join(test.info().project.testDir, '.output/api.log'), 'utf8');
  return [...log.matchAll(/give them this code: (\d{6})/g)].map((m) => m[1]!);
}

test('a teen asks a parent, who agrees by text, and then plays with their name', async ({ page }) => {
  await page.goto('/sign-in');
  await enterPhoneCode(page, randomPhone());
  await expect(page).toHaveURL(/\/profile-setup$/);
  const username = uniqueName('teen');
  await page.getByTestId('username').fill(username);
  await page.getByTestId('age-13_17').click();
  await page.getByTestId('profile-continue').click();

  await expect(page).toHaveURL(/\/guardian$/);
  await expect(page.getByText('Ask a parent or guardian')).toBeVisible();
  const before = (await guardianCodes()).length;
  await page.getByTestId('guardian-contact').fill(randomPhone());
  await page.getByTestId('guardian-send').click();
  await expect(page.getByText('Type the code they got')).toBeVisible();
  await expect.poll(async () => (await guardianCodes()).length).toBeGreaterThan(before);
  await page.getByTestId('guardian-code').fill((await guardianCodes()).at(-1)!);

  // Saved with the name they picked before asking.
  await expect(page.getByTestId('greeting')).toHaveText(`Hi, ${username}`);
  await page.reload();
  await expect(page.getByTestId('greeting')).toHaveText(`Hi, ${username}`);
});

test('a teen can leave it for later and play as a guest', async ({ page }) => {
  await page.goto('/sign-in');
  await enterPhoneCode(page, randomPhone());
  await page.getByTestId('username').fill(uniqueName('later'));
  await page.getByTestId('age-13_17').click();
  await page.getByTestId('profile-continue').click();
  await expect(page).toHaveURL(/\/guardian$/);
  await page.getByTestId('guardian-later').click();
  await expect(page).toHaveURL(/\/welcome$/);
});
