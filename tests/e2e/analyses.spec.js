import { test, expect } from '@playwright/test';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'researcher@example.com', aud: 'authenticated', role: 'authenticated' };
const token = () => {
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
};
const session = () => ({ access_token: token(), refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user });

function newState() {
  return { analyses: [], posted: [], objects: new Map(), uploads: 0, downloads: 0 };
}

// storage-js uploads a Blob as multipart/form-data. Pull the file part back out
// so the mock serves the actual EDF bytes on download, like the real service.
function extractFilePart(buf, contentType) {
  const m = /boundary=([^;]+)/.exec(contentType || '');
  if (!m || !buf) return buf;
  const boundary = Buffer.from(`--${m[1].replace(/^"|"$/g, '')}`);
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(start + boundary.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    // storage-js sends the blob as `Content-Disposition: form-data; name=""; filename="..."`,
    // alongside plain fields (cacheControl, metadata), so key off filename.
    if (headerEnd !== -1 && /filename=/.test(part.subarray(0, headerEnd).toString('latin1'))) {
      return part.subarray(headerEnd + 4, part.length - 2);
    }
    start = next;
  }
  return buf;
}

async function mockBackend(page, state = newState()) {
  await page.route('https://somnium-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname;

    if (path.includes('/storage/v1/object/recordings')) {
      const key = path.includes('/object/recordings/')
        ? decodeURIComponent(path.split('/object/recordings/')[1])
        : '';
      if (request.method() === 'DELETE') {
        state.objects.clear();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (request.method() === 'GET' || request.method() === 'HEAD') {
        const bytes = state.objects.get(key);
        state.downloads++;
        if (!bytes) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"not found"}' });
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes });
      }
      // POST / PUT -> upload
      state.objects.set(key, extractFilePart(request.postDataBuffer(), request.headers()['content-type']));
      state.uploads++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `recordings/${key}` }) });
    }

    let body = {}, status = 200;
    if (path.endsWith('/token')) body = session();
    else if (path.endsWith('/user')) body = user;
    else if (path.includes('/rest/v1/analyses')) {
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        state.posted.push(row);
        state.analyses.push(row);
        body = null; status = 201;
      } else if (request.method() === 'DELETE') { body = []; state.analyses = []; }
      else body = state.analyses;
    } else if (path.includes('/rest/v1/checklists')) body = [];
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

const rows = (page) => page.locator('#historyList li');
const saveBtn = (page) => page.getByRole('button', { name: 'Save analysis' });

test('saves an analysis, survives a reload, reopens the recording, and deletes', async ({ page }) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#report')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);

  await expect(saveBtn(page)).toBeEnabled();
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('demo-recording.edf');
  await expect(page.locator('#historyStatus')).toHaveText('Analysis saved on this device.');

  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#historyStatus')).toHaveText('1 saved on this device');

  // Load the page with no recording at all, then reopen from history.
  await page.goto('/app.html');
  await expect(page.locator('#report')).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await rows(page).locator('.history-open').click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#verdict')).toContainText('usable after fixes');
  await expect(page.locator('#checklist li')).toHaveCount(5);

  page.on('dialog', dialog => dialog.accept());
  await rows(page).locator('.history-remove').click();
  await expect(rows(page)).toHaveCount(0);
});

test('reopening restores the checklist the analysis was saved with', async ({ page }) => {
  await page.goto('/app.html?demo');
  // Drop one rule so the saved checklist differs from the default.
  await page.locator('#checklist button').first().click();
  await expect(page.locator('#checklist li')).toHaveCount(4);
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);

  await page.goto('/app.html');
  await expect(page.locator('#checklist')).toBeHidden();
  await rows(page).locator('.history-open').click();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#checklist li')).toHaveCount(4);
});

test('loading a recording does not save history on its own', async ({ page }) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#report')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(saveBtn(page)).toBeEnabled();
});

test('signed-in save uploads the recording and syncs metadata only', async ({ page }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);

  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#historyStatus')).toHaveText('Analysis saved to your account.');

  expect(state.posted).toHaveLength(1);
  expect(state.posted[0]).toMatchObject({
    filename: 'demo-recording.edf',
    duration_sec: 300,
    channels: 6,
    sample_rate: 128,
  });
  expect(state.posted[0].storage_path).toMatch(new RegExp(`^${user.id}/`));
  expect(Array.isArray(state.posted[0].checklist)).toBe(true);
  expect(state.posted[0].checklist).toHaveLength(5);
  expect(state.objects.size).toBe(1);
  // Metadata only: no signal data is ever written to the row.
  expect(Object.keys(state.posted[0]).sort()).toEqual([
    'channels', 'checklist', 'created_at', 'duration_sec', 'filename',
    'local_id', 'sample_rate', 'size_bytes', 'storage_path',
  ]);
});

test('an analysis saved in one browser can be reopened from the account in another', async ({ page, browser }) => {
  const state = await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);

  // Different browser context: no IndexedDB history at all.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await mockBackend(fresh, state);
  await fresh.goto('/app.html');
  await login(fresh);
  await expect(fresh.locator('#historyList li')).toHaveCount(1);
  await fresh.locator('#historyList li .history-open').click();
  await expect(fresh.locator('#report')).toBeVisible();
  await expect(fresh.locator('#verdict')).toContainText('usable after fixes');
  expect(state.downloads).toBeGreaterThan(0);
  await other.close();
});

test('the sidebar stays pinned while the report scrolls past', async ({ page }) => {
  await page.goto('/app.html?demo');
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('#history')).toHaveCSS('position', 'sticky');

  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(150);

  // The report has scrolled away, but the sidebar is still pinned near the top.
  const mapTop = await page.locator('#mapwrap').evaluate(el => el.getBoundingClientRect().top);
  expect(mapTop).toBeLessThan(0);
  const top = await page.locator('#history').evaluate(el => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThanOrEqual(24);
  await expect(saveBtn(page)).toBeInViewport();
  await expect(rows(page)).toBeInViewport();
  await page.screenshot({ path: 'test-results/sidebar-pinned.png' });

  // One column on a phone: pinning would cover the report, so it must not stick.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#history')).toHaveCSS('position', 'static');
});

test('sidebar follows the app theme and fits a phone without overflow', async ({ page }) => {
  await page.goto('/app.html?demo');
  await saveBtn(page).click();
  await expect(rows(page)).toHaveCount(1);

  // The sidebar is a normal card, not a new design language.
  const card = page.locator('#history');
  await expect(card).toHaveClass(/card/);
  const border = await card.evaluate(el => getComputedStyle(el).borderTopWidth);
  const shadow = await card.evaluate(el => getComputedStyle(el).boxShadow);
  expect(border).toBe('2px');
  expect(shadow).toContain('rgb(242, 169, 0)');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows(page)).toBeVisible();
  await expect(saveBtn(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/analyses-mobile.png', fullPage: true });
});
