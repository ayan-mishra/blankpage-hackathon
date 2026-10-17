import { test, expect } from '@playwright/test';
import { mockBackend, edfFile, login } from './helpers.js';

test('guest recordings survive reload, reopen locally, and never upload on later sign-in', async ({ page }) => {
  const state = await mockBackend(page);
  const requests = [];
  page.on('request', request => { if (request.url().startsWith('https://somnium-test.supabase.co/')) requests.push(request.url()); });
  await page.goto('/app.html?demo');
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#accountEmail')).toHaveText('Guest · this browser');
  await page.locator('#file').setInputFiles(await edfFile(page, 'guest-night.edf'));
  await expect(page.locator('#analysisStatus')).toHaveText('Saved in this browser.');
  await expect(page.locator('#historyList li')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#appShell')).toBeVisible();
  await page.locator('#historyList .history-open').click();
  await expect(page.locator('#loaded')).toContainText('guest-night.edf');
  await expect(page.locator('#cloud')).toBeHidden();
  expect(state.uploads).toBe(0);
  expect(state.posted).toHaveLength(0);
  expect(requests).toHaveLength(0);
  await page.locator('#account summary').click();
  await page.getByRole('button', { name: 'Use an account', exact: true }).click();
  await login(page);
  await expect(page.locator('#historyList li')).toHaveCount(0);
  expect(state.uploads).toBe(0);
  expect(state.posted).toHaveLength(0);
});

test('landing guest button remembers the demo destination and opens the study too', async ({ page }) => {
  await mockBackend(page);
  await page.addLocatorHandler(page.getByRole('button', { name: 'Continue anyway' }), b => b.click());
  await page.goto('/');
  await page.getByRole('link', { name: 'See a sample study' }).click();
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await expect(page).toHaveURL(/study\.html\?sample$/);
  await expect(page.locator('#progress')).toHaveText('Checked 8 recordings.');
  await page.getByRole('link', { name: 'Check one recording', exact: true }).click();
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#accountEmail')).toHaveText('Guest · this browser');
});

test('guest mode works without a configured Supabase client', async ({ page }) => {
  await page.route('**/src/supabase.js', route => route.fulfill({ contentType: 'application/javascript', body: 'export const supabase = null;' }));
  await page.goto('/app.html?demo');
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#accountEmail')).toHaveText('Guest · this browser');
});
