import { test, expect } from '@playwright/test';
import { mockBackend, login, user, noOverflow } from './helpers.js';

const status = page => page.locator('#heroStatus');
test.beforeEach(async ({ page }) => { await mockBackend(page); });

test('the hero lead and descriptions make no in-browser or upload claims', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lead')).toHaveText('Somnium analyzes EEGs to catch common mistakes in readings such as headbands slipping, loss of skin contact, and recording stopping, showing you which nights to keep.');
  expect(await page.content()).not.toMatch(/in your browser|uploaded|only if you keep/i);
});

test('sign in from the hero opens the app', async ({ page }) => {
  await page.goto('/');
  await login(page, { password: 'incorrect', expectApp: false });
  await expect(status(page)).toContainText('Invalid login credentials');
  await expect(page).toHaveURL(/\/$/);
  await login(page, { expectApp: false });
  await expect(page).toHaveURL(/\/app\.html$/);
  await expect(page.locator('#appShell')).toBeVisible();
});

test('signed out, demo links stop at the form and the demo opens after sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Check a demo recording' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(status(page)).toHaveText('Sign in or create an account to open the demo recording.');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.locator('nav').getByRole('link', { name: 'One recording' }).click(); // nav links are gated too
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Check a demo recording' }).click();
  await login(page, { expectApp: false });
  await expect(page).toHaveURL(/\/app\.html\?demo$/);
  await expect(page.locator('#appShell')).toBeVisible();
});

test('missing fields are flagged and focused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(status(page)).toHaveText('Enter your email address.');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(status(page)).toHaveText('Enter your password.');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Forgot password?' }).click(); // reset needs only the email
  await expect(status(page)).toContainText('password reset email');
});

test('create account asks for email confirmation and remembers the sample-study intent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'See a sample study' }).click();
  await expect(status(page)).toContainText('the sample study');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(status(page)).toContainText('Check your email');
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('somnium.next'))).toBe('/study.html?sample');
});

test('signed in, the hero offers the app and demo links go straight there', async ({ page }) => {
  await page.goto('/app.html');
  await login(page);
  await page.goto('/');
  await expect(page.locator('#heroWho')).toHaveText(user.email);
  await expect(page.getByRole('link', { name: 'Open the app' })).toBeVisible();
  await expect(page.locator('#heroForm')).toBeHidden();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#heroForm')).toBeVisible();
  await expect(status(page)).toHaveText('Signed out.');
  await login(page, { expectApp: false });
  await expect(page).toHaveURL(/\/app\.html$/);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open the app' })).toBeVisible();
  await page.getByRole('link', { name: 'Check a demo recording' }).click();
  await expect(page).toHaveURL(/\/app\.html\?demo$/);
});

test('unconfigured copy shows a note instead of the form', async ({ page }) => {
  await page.route('**/src/supabase.js', route => route.fulfill({ contentType: 'application/javascript', body: 'export const supabase = null;' }));
  await page.goto('/');
  await expect(status(page)).toContainText('Accounts aren’t configured on this copy');
  await expect(page.locator('#heroForm')).toBeHidden();
  await page.getByRole('link', { name: 'Check a demo recording' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('hero fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('#heroForm')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});
