import { test, expect } from '@playwright/test';
import { mockBackend, login, edfFile, user, noOverflow } from './helpers.js';

const rows = (page) => page.locator('#historyList li');
const saveBtn = (page) => page.getByRole('button', { name: 'Save to your analyses' });
const rulesBtn = (page) => page.getByRole('button', { name: 'Save rules to this analysis' });
const newBtn = (page) => page.getByRole('button', { name: '+ New analysis' });

async function openRecording(page, name) {
  await page.locator('#file').setInputFiles(await edfFile(page, name));
  await expect(page.locator('#loaded')).toContainText(name);
  await expect(page.locator('#analysisStatus')).toHaveText('Saved to your analyses.');
}

test('a real recording is saved automatically, shows in the sidebar and reopens', async ({ page }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html');
  await login(page);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#historyEmpty')).toBeVisible();

  await openRecording(page, 'night1.edf');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveClass(/active/);
  await expect(saveBtn(page)).toBeHidden(); // no separate save for real recordings
  expect(state.posted).toHaveLength(1);
  expect(state.posted[0]).toMatchObject({ filename: 'night1.edf', duration_sec: 300, channels: 6, sample_rate: 128 });
  expect(state.posted[0].storage_path).toMatch(new RegExp(`^${user.id}/`));
  expect(state.objects.size).toBe(1);
  // Metadata only: no signal data is ever written to the row.
  expect(Object.keys(state.posted[0]).sort()).toEqual([
    'channels', 'checklist', 'created_at', 'duration_sec', 'filename',
    'local_id', 'sample_rate', 'size_bytes', 'storage_path', 'user_id',
  ]);

  await openRecording(page, 'night2.edf');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('night2.edf');

  // New analysis goes back to the upload view.
  await newBtn(page).click();
  await expect(page.locator('#load')).toBeVisible();
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#historyList li.active')).toHaveCount(0);

  // Reopen the older one from the list.
  await rows(page).filter({ hasText: 'night1.edf' }).locator('.history-open').click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#loaded')).toContainText('night1.edf');
  await expect(rows(page).filter({ hasText: 'night1.edf' })).toHaveClass(/active/);
  await expect(page.locator('#verdictPill')).toHaveText('usable after fixes');

  // Still there after a reload.
  await page.reload();
  await expect(rows(page)).toHaveCount(2);

  page.on('dialog', dialog => dialog.accept());
  await rows(page).first().locator('.history-remove').click();
  await expect(rows(page)).toHaveCount(1);
});

test('the demo is not saved on its own, but can be saved explicitly', async ({ page }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);
  await expect(page.locator('#report')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  expect(state.posted).toHaveLength(0);
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('demo-recording.edf');
  await expect(rows(page).first()).toHaveClass(/active/);
  await expect(saveBtn(page)).toBeHidden();
  expect(state.posted).toHaveLength(1);
});

test('changing the rules of an open analysis offers to save them, replacing the entry', async ({ page }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html');
  await login(page);
  await openRecording(page, 'night1.edf');
  await expect(rulesBtn(page)).toBeHidden();
  const before = state.posted[0].local_id;

  await page.locator('#checklist button').first().click();
  const kept = await page.locator('#checklist li').count();
  await expect(rulesBtn(page)).toBeVisible();
  await rulesBtn(page).click();
  await expect(page.locator('#analysisStatus')).toHaveText('Rules saved to this analysis.');
  await expect(rulesBtn(page)).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  expect(state.analyses).toHaveLength(1);
  expect(state.analyses[0].local_id).not.toBe(before);
  expect(state.analyses[0].checklist).toHaveLength(kept);

  await newBtn(page).click();
  await rows(page).locator('.history-open').click();
  await expect(page.locator('#checklist li')).toHaveCount(kept);
});

test('an analysis saved in one browser can be reopened from the account in another', async ({ page, browser }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html');
  await login(page);
  await openRecording(page, 'night1.edf');

  // Different browser context: no IndexedDB history at all.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await mockBackend(fresh, state);
  await fresh.goto('/app.html');
  await login(fresh);
  await expect(rows(fresh)).toHaveCount(1);
  await rows(fresh).locator('.history-open').click();
  await expect(fresh.locator('#report')).toBeVisible();
  await expect(fresh.locator('#verdictPill')).toHaveText('usable after fixes');
  expect(state.downloads).toBeGreaterThan(0);
  await other.close();
});

test('the sidebar stays pinned while the report scrolls past', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#sidebar')).toHaveCSS('position', 'sticky');
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(150);
  // The report has scrolled away, but the analyses list is still on screen.
  expect(await page.locator('#mapwrap').evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(0);
  expect(await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(0, 0); // sub-pixel page heights can nudge it by a fraction
  await expect(rows(page)).toBeInViewport();
});

test('phone layout: sidebar collapses to a drawer and nothing overflows', async ({ page }) => {
  await mockBackend(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app.html');
  await login(page);
  await openRecording(page, 'night1.edf');
  const toggle = page.getByRole('button', { name: 'Analyses', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rows(page)).toBeHidden();
  expect(await noOverflow(page)).toBe(true);
  await toggle.click();
  await expect(rows(page)).toBeVisible();
  await expect(page.getByLabel('Keep the recording so it can be reopened')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await newBtn(page).click();
  await expect(rows(page)).toBeHidden(); // drawer closes
  await expect(page.locator('#load')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});
