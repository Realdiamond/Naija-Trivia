/**
 * Help and support (build plan step 2.7p): a player reads an answer in the help centre, writes
 * to support from the app, and later reads support's answer there.
 */
import { expect, test } from '@playwright/test';
import { API, playTasteTest, staffHeaders } from './helpers';

test('a player writes to support from Help and reads the answer there', async ({ page, request }) => {
  await page.goto('/');
  await page.getByTestId('start').click();
  await playTasteTest(page);
  await page.getByTestId('later').click();
  await expect(page.getByTestId('greeting')).toBeVisible();

  await page.getByTestId('open-settings').click();
  await page.getByTestId('open-help').click();
  await page.getByTestId('faq-practice').click();
  await expect(
    page.getByText('Open a pack once with network and it stays on your device.', { exact: false }),
  ).toBeVisible();

  await page.getByTestId('topic-streak').click();
  await page.getByTestId('help-message').fill('My streak went back to zero after one missed day.');
  await page.getByTestId('help-email').fill('ada@example.com');
  await page.getByTestId('help-send').click();
  await expect(page.getByTestId('help-sent')).toBeVisible();
  const mine = page.locator('[data-testid^="my-ticket-st_"]');
  await expect(mine).toContainText('Waiting for an answer');
  const ticketId = (await mine.getAttribute('data-testid'))!.replace('my-ticket-', '');

  // Support answers in the console.
  const headers = await staffHeaders(request, 'support');
  const answered = await request.post(`${API}/admin/support/${ticketId}`, {
    headers,
    data: { status: 'answered', answer: 'We have restored your streak. Keep going!' },
  });
  expect(answered.status()).toBe(200);

  await page.reload();
  await expect(page.getByTestId(`my-ticket-${ticketId}`)).toContainText('Answered');
  await expect(page.getByTestId('my-ticket-answer')).toHaveText('We have restored your streak. Keep going!');
});
