import { test, expect } from '@playwright/test';
import { mockBackend, login, session, user, edfFile, openAccount } from './helpers.js';

async function loginAsSecondUser(page) {
  const next = { ...user, id: '00000000-0000-4000-8000-000000000002', email: 'second@example.com' };
  await page.route('**/auth/v1/token?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...session(), user: next }) }));
  await login(page);
  await expect(page.locator('#accountEmail')).toHaveText(next.email);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  // headless Chromium renders in software, so study.html shows its hardware-acceleration notice
  await page.addLocatorHandler(page.getByRole('button', { name: 'Continue anyway' }), (b) => b.click());
});

test('switching accounts clears study rows and cannot regrade the previous files', async ({ page }) => {
  await page.goto('/study.html?sample');
  await login(page);
  await expect(page.locator('#progress')).toHaveText('Checked 8 recordings.');
  await expect(page.locator('#table tbody tr:not(.group)')).toHaveCount(8);
  await openAccount(page);
  await page.locator('#signOut').click();
  await expect(page.locator('#authForm')).toBeVisible();
  await loginAsSecondUser(page);
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#table tbody')).toBeEmpty();
  const rules = [{ id: 'flat', name: 'Flatline', metric: 'flat', op: '>', value: 0.5 }];
  await page.locator('#importRules').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rules })) });
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#progress')).toBeEmpty();
  await page.getByRole('button', { name: 'Try a sample study (8 participants)' }).click();
  await expect(page.locator('#progress')).toHaveText('Checked 8 recordings.');
});

test('an EDF read finishing after logout cannot repopulate the next account’s study', async ({ page }) => {
  await page.goto('/study.html');
  await login(page);
  const file = await edfFile(page, 'private-night.edf');
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      window.studyReadStarted = true;
      await new Promise(resolve => { window.finishStudyRead = resolve; });
      const buffer = await read.call(this);
      window.studyReadFinished = true;
      return buffer;
    };
  });
  await page.locator('#files').setInputFiles(file);
  await expect.poll(() => page.evaluate(() => window.studyReadStarted)).toBe(true);
  await openAccount(page);
  await page.locator('#signOut').click();
  await expect(page.locator('#authForm')).toBeVisible();
  await loginAsSecondUser(page);
  await page.evaluate(() => window.finishStudyRead());
  await expect.poll(() => page.evaluate(() => window.studyReadFinished)).toBe(true);
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#table tbody')).toBeEmpty();
  await expect(page.locator('#progress')).toBeEmpty();
});

test('a rule added in app.html grades the sample study, and reset goes back to the default', async ({ page }) => {
  await page.goto('/study.html?sample');
  await expect(page.locator('#appShell')).toBeHidden(); // gated until sign-in
  await login(page); // ?sample still runs after signing in
  await expect(page.locator('#rulesUsed')).toContainText('Using the default checklist (6 rules)');
  await expect(page.locator('#progress')).toContainText('Checked');
  const before = await page.locator('#summary h2').textContent();

  await page.goto('/app.html?demo');
  await page.getByLabel('Describe a rule in words').fill('flag swings above 1');
  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.locator('#checklist li')).toHaveCount(6); // demo's 5-rule starter + this one
  await page.getByRole('link', { name: 'Apply these rules to a study →' }).click();

  await expect(page.locator('#rulesUsed')).toContainText('Using your checklist: 6 rules');
  await page.getByRole('button', { name: 'Try a sample study (8 participants)' }).click();
  await expect(page.locator('#progress')).toContainText('Checked');
  // every window now has swings over 1 µV, so every night fails
  await expect(page.locator('#summary h2')).toHaveText(/Follow up with 8 of 8 participants/);
  expect(before).not.toMatch(/8 of 8/);

  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.locator('#rulesUsed')).toContainText('Using the default checklist');
  await expect(page.locator('#summary h2')).toHaveText(before);
});

test('the untouched demo starter does not become the study checklist', async ({ page }) => {
  await page.goto('/app.html?demo');
  await login(page);
  await expect(page.locator('#checklist li')).toHaveCount(5);
  await page.goto('/study.html');
  await expect(page.locator('#rulesUsed')).toContainText('Using the default checklist');
});

test('study imports a checklist file and rejects a bad one', async ({ page }) => {
  await page.goto('/study.html');
  await login(page);
  const rules = [{ id: 'flat', name: 'Flatline', metric: 'flat', op: '>', value: 0.5 }];
  await page.locator('#importRules').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ rules })) });
  await expect(page.locator('#rulesUsed')).toContainText('Using your checklist: 1 rule');
  await page.locator('#importRules').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"rules":[{"metric":"nope"}]}') });
  await expect(page.locator('#rulesNote')).toHaveText('That file isn’t a valid Somnium checklist.');
  await expect(page.locator('#rulesUsed')).toContainText('Using your checklist: 1 rule');
  await page.reload();
  await expect(page.locator('#rulesUsed')).toContainText('Using your checklist: 1 rule');
});
