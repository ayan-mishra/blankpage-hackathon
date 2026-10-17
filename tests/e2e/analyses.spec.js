import { test, expect } from '@playwright/test';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'researcher@example.com', aud: 'authenticated', role: 'authenticated' };
const token = () => {
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
};
const session = () => ({ access_token: token(), refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user });

async function mockBackend(page) {
  const state = { analyses: [], posted: [] };
  await page.route('https://somnium-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url());
    let body = {}, status = 200;
    if (url.pathname.endsWith('/token')) body = session();
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.includes('/rest/v1/analyses')) {
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        state.posted.push(row);
        state.analyses.push(row);
        body = null; status = 201;
      } else if (request.method() === 'DELETE') { body = [{ id: 'gone' }]; state.analyses = []; }
      else body = state.analyses;
    } else if (url.pathname.includes('/rest/v1/checklists')) body = [];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return state;
}

async function login(page) {
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#cloud')).toBeVisible();
}

const item = (page) => page.locator('#historyList .history-item');

test('saves an analysis locally, survives a reload, and deletes', async ({ page }) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#report')).toBeVisible();
  await expect(item(page)).toHaveCount(0);

  const save = page.getByRole('button', { name: 'Save analysis' });
  await expect(save).toBeEnabled();
  await save.click();

  await expect(item(page)).toHaveCount(1);
  await expect(item(page)).toContainText('demo-recording.edf');
  await expect(item(page)).toContainText('6 ch · 128 Hz · 5m 00s');
  await expect(page.locator('#historyStatus')).toHaveText('Analysis saved on this device.');

  await page.reload();
  await expect(item(page)).toHaveCount(1);
  await expect(page.locator('#historyStatus')).toHaveText('1 saved on this device');
  await expect(item(page)).toContainText('demo-recording.edf');

  page.on('dialog', dialog => dialog.accept());
  await page.locator('.history-del').click();
  await expect(item(page)).toHaveCount(0);
});

test('loading a recording does not save history on its own', async ({ page }) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#report')).toBeVisible();
  await expect(item(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save analysis' })).toBeEnabled();
});

test('signed-in save uploads only metadata and shows the account sync', async ({ page }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);

  await page.getByRole('button', { name: 'Save analysis' }).click();
  await expect(item(page)).toHaveCount(1);
  await expect(page.locator('#historyStatus')).toHaveText('Analysis saved to your account.');

  expect(state.posted).toHaveLength(1);
  expect(state.posted[0]).toMatchObject({
    filename: 'demo-recording.edf',
    duration_sec: 300,
    channels: 6,
    sample_rate: 128,
  });
  expect(state.posted[0].local_id).toBeTruthy();
  // No signal data, no rules: metadata only.
  expect(Object.keys(state.posted[0]).sort()).toEqual(
    ['channels', 'created_at', 'duration_sec', 'filename', 'local_id', 'sample_rate'],
  );
});

test('an analysis saved while signed in is pulled back on a fresh profile', async ({ page, browser }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);
  await page.getByRole('button', { name: 'Save analysis' }).click();
  await expect(item(page)).toHaveCount(1);

  // A different browser context has no IndexedDB history; it must come from the account.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.route('https://somnium-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url());
    let body = {}, status = 200;
    if (url.pathname.endsWith('/token')) body = session();
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.includes('/rest/v1/analyses')) body = state.analyses;
    else if (url.pathname.includes('/rest/v1/checklists')) body = [];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await fresh.goto('/app.html');
  await login(fresh);
  await expect(fresh.locator('#historyList .history-item')).toHaveCount(1);
  await expect(fresh.locator('#historyList .history-item')).toContainText('demo-recording.edf');
  await other.close();
});

test('sidebar fits a phone without horizontal overflow', async ({ page }) => {
  await page.goto('/app.html?demo');
  await page.getByRole('button', { name: 'Save analysis' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(item(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save analysis' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/analyses-mobile.png', fullPage: true });
});
