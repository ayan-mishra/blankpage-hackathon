import { test, expect } from '@playwright/test';
import { mockBackend, login, openAccount, session, user, noOverflow } from './helpers.js';

const status = page => page.getByRole('status');
test.beforeEach(async ({ page }) => { await mockBackend(page); });

test('signed out, the app page shows only the sign-in card', async ({ page }) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Somnium' })).toBeVisible();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Try the demo recording' })).toBeHidden();
});

test('login error, then sign-in reveals the app and ?demo survives the login', async ({ page }) => {
  await page.goto('/app.html?demo');
  await login(page, { password: 'incorrect', expectApp: false });
  await expect(status(page)).toContainText('Invalid login credentials');
  await expect(page.locator('#appShell')).toBeHidden();
  await login(page);
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#tour')).toContainText('Click here');
  await expect(page.locator('#loaded')).toContainText('Demo recording');
});

test('save/load/delete checklists, persisted session, sign out returns to the gate', async ({ page }) => {
  await page.goto('/app.html?demo');
  await login(page);
  await openAccount(page);
  await expect(page.locator('#accountEmail')).toHaveText(user.email);
  await expect(page.locator('#cloud')).toBeVisible();
  await page.getByLabel('Checklist name').fill('My lab');
  await page.getByRole('button', { name: 'Save current checklist' }).click();
  await expect(status(page)).toHaveText('Checklist saved.');
  await expect(page.locator('#savedChecklists option')).toHaveText('My lab');
  await page.locator('#checklist button').first().click();
  await expect(page.locator('#checklist li')).toHaveCount(4);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.locator('#checklist li')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('#appShell')).toBeVisible(); // session persisted, no second login
  await openAccount(page);
  await expect(page.locator('#savedChecklists option')).toHaveText('My lab');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(status(page)).toHaveText('Saved checklist deleted.');
  await expect(page.locator('#savedChecklists option')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#appShell')).toBeHidden();
  await expect(status(page)).toHaveText('Signed out.');
});

test('signup asks for email confirmation; the ?demo intent survives the confirmation link', async ({ page }) => {
  await page.goto('/app.html?demo');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(status(page)).toContainText('Check your email');
  await expect(page.locator('#appShell')).toBeHidden();
  await page.getByRole('button', { name: 'Send password reset' }).click();
  await expect(status(page)).toContainText('password reset email');

  // The confirmation link lands on plain app.html with tokens in the hash.
  const auth = session();
  await page.goto(`/app.html#access_token=${auth.access_token}&refresh_token=${auth.refresh_token}&expires_in=3600&token_type=bearer&type=signup`);
  await expect(page.locator('#appShell')).toBeVisible();
  await expect(page.locator('#tour')).toBeVisible();
  await expect(page).toHaveURL(/app\.html\?demo/);
});

test('recovery callback supports changing password before the app opens', async ({ page }) => {
  const auth = session();
  await page.goto(`/app.html#access_token=${auth.access_token}&refresh_token=${auth.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`);
  await expect(page.locator('#recoveryForm')).toBeVisible();
  await expect(page.locator('#appShell')).toBeHidden();
  await page.getByLabel('New password', { exact: true }).fill('updated-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.locator('#appShell')).toBeVisible();
  await openAccount(page);
  await expect(status(page)).toHaveText('Password updated.');
});

test('failed save leaves current rules intact and can be retried', async ({ page }) => {
  await page.goto('/app.html?demo');
  await login(page);
  await openAccount(page);
  await page.route('**/rest/v1/checklists', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Please try again.' }) });
    else await route.fallback();
  });
  await page.getByLabel('Checklist name').fill('My lab');
  await page.getByRole('button', { name: 'Save current checklist' }).click();
  await expect(status(page)).toContainText('Please try again');
  await expect(page.locator('#checklist li')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Save current checklist' })).toBeEnabled();
});

test('late checklist response cannot restore private state after logout', async ({ page }) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/rest/v1/checklists?**', async route => {
    await wait;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'private', name: 'Private checklist' }]) });
  });
  await page.goto('/app.html');
  const request = page.waitForRequest('**/rest/v1/checklists?**');
  await login(page);
  await request;
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#authForm')).toBeVisible();
  release();
  await expect(page.locator('#cloud')).toBeHidden();
  await expect(page.locator('#savedChecklists option')).toHaveCount(0);
});

test('unconfigured copy shows the gate with a clear message and no app', async ({ page }) => {
  await page.route('**/src/supabase.js', route => route.fulfill({ contentType: 'application/javascript', body: 'export const supabase = null;' }));
  await page.goto('/app.html?demo');
  await expect(status(page)).toContainText('Accounts are not configured');
  await expect(page.locator('#authForm')).toBeHidden();
  await expect(page.locator('#appShell')).toBeHidden();
  await page.goto('/study.html?sample');
  await expect(page.locator('.gate .account-status')).toContainText('Accounts are not configured');
  await expect(page.locator('#appShell')).toBeHidden();
});

test('gate and account menu fit desktop and mobile screens', async ({ page }) => {
  await page.goto('/app.html');
  await expect(page.locator('#authForm')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await noOverflow(page)).toBe(true);
  await login(page);
  await page.getByRole('button', { name: 'Analyses', exact: true }).click();
  await openAccount(page);
  await expect(page.getByRole('button', { name: 'Save current checklist' })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

// Where the tour's arrow tip is, and the box of what it should be pointing at.
const arrowCheck = page => page.evaluate(() => {
  const a = document.getElementById('tourArrow'), r = a.getBoundingClientRect(), up = a.dataset.dir === 'up';
  const ring = document.getElementById('tourRing').getBoundingClientRect(); // ring = target box + 5px
  return { tip: { x: r.left + r.width / 2, y: up ? r.top + 1 : r.bottom - 1 }, target: { left: ring.left + 5, right: ring.right - 5, top: ring.top + 5, bottom: ring.bottom - 5 } };
});
const STEPS = [
  ['1 of 4', 'Click here', null],
  ['2 of 4', 'Press this', '#teach'],
  ['3 of 4', 'Add it', '#pAdd'],
  ['4 of 4', 'Your rule changed the verdict', '#verdictPill'],
];

test('demo tour: follow the arrows to teach a rule and change the verdict (desktop and phone)', async ({ page }) => {
  await page.goto('/app.html');
  await login(page);
  for (const size of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: 'Try the demo recording' }).click();
    await expect(page.locator('#verdictPill')).toHaveText('usable');
    const tour = page.locator('#tour');
    await expect(tour).toBeFocused();
    await expect(page.locator('#tourLive')).toContainText('step 1 of 4');
    for (const [count, text, selector] of STEPS) {
      await expect(page.locator('#tourCount')).toHaveText(count);
      await expect(page.locator('#tourText')).toContainText(text);
      await page.waitForTimeout(600); // let any smooth scroll settle
      const { tip, target } = await arrowCheck(page);
      // The arrow tip lands inside the highlighted target, and that target is the real element.
      expect(tip.x).toBeGreaterThanOrEqual(target.left); expect(tip.x).toBeLessThanOrEqual(target.right);
      expect(tip.y).toBeGreaterThanOrEqual(target.top); expect(tip.y).toBeLessThanOrEqual(target.bottom);
      if (!selector) { // step 1 rings C4 (row 3) from 2:30, half way through the 5-minute demo, to the end
        const map = page.locator('#map'), m = await map.boundingBox();
        const { cw, cols } = await map.evaluate(c => ({ cw: c._cw, cols: Math.round((c._w - 44) / c._cw) }));
        expect(Math.abs(m.x + 44 + (cols / 2) * cw - target.left)).toBeLessThan(1.5);
        expect(Math.abs(m.x + 44 + cols * cw - target.right)).toBeLessThan(1.5);
        expect(Math.abs(m.y + 20 + 3 * 30 - target.top)).toBeLessThan(1.5);
      } else {
        const el = await page.locator(selector).boundingBox();
        expect(Math.abs(el.x - target.left)).toBeLessThan(1.5); expect(Math.abs(el.y - target.top)).toBeLessThan(1.5);
      }
      const card = await tour.boundingBox(); // the callout fits the screen
      expect(card.x).toBeGreaterThanOrEqual(0); expect(card.x + card.width).toBeLessThanOrEqual(size.width);
      if (count !== '4 of 4') await page.mouse.click(tip.x, tip.y); // do exactly what the arrow says
    }
    await expect(page.locator('#verdictPill')).toHaveText('usable after fixes');
    await expect(page.locator('#change')).toContainText('changed the verdict');
    await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();
    expect(await noOverflow(page)).toBe(true);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(tour).toBeHidden();
    await expect(page.locator('#tourArrow')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show me again' })).toBeFocused();
    if (size.width < 760) await page.getByRole('button', { name: 'Analyses', exact: true }).click();
    await page.getByRole('button', { name: '+ New analysis' }).click();
    await expect(tour).toBeHidden();
  }
});

test('demo tour: Escape skips it, Show me again restarts it, a real drag also works', async ({ page }) => {
  await page.goto('/app.html?demo');
  await login(page);
  await expect(page.locator('#tour')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tour')).toBeHidden();
  await expect(page.locator('#tourLive')).toHaveText('Tour closed.');
  await page.getByRole('button', { name: 'Show me again' }).click();
  await expect(page.locator('#tourCount')).toHaveText('1 of 4');
  await expect(page.getByRole('button', { name: 'Show me again' })).toBeHidden();
  // Drag across C4 from 2:30 to the end instead of a single click.
  const map = page.locator('#map');
  const box = await map.boundingBox();
  const { cw, cols } = await map.evaluate(c => ({ cw: c._cw, cols: Math.round((c._w - 44) / c._cw) }));
  const y = box.y + 20 + 3 * 30 + 15, x = col => box.x + 44 + col * cw + cw / 2;
  await page.mouse.move(x(cols / 2), y); await page.mouse.down();
  await page.mouse.move(x(cols - 1), y, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('#tourCount')).toHaveText('2 of 4');
  // Clicking a clean square elsewhere drops the selection, so the tour points back at the hum.
  await page.mouse.click(x(2), box.y + 20 + 15);
  await expect(page.locator('#tourCount')).toHaveText('1 of 4');
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('#tour')).toBeHidden();
});

test('map is keyboard operable', async ({ page }) => {
  await page.goto('/app.html?demo');
  await login(page);
  await page.locator('#map').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#evidence h3')).toContainText('F3');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByRole('button', { name: 'Teach a rule from selection' })).toBeEnabled();
});
