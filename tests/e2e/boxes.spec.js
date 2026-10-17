import { test, expect } from '@playwright/test';
import { mockBackend, login } from './helpers.js';

// The two result boxes are dropdowns: folded/shown by hand, and unfolded by the app when
// they have something to show. Folded boxes must not swallow the demo's teach-a-rule flow.
test('Evidence and Your rules fold, unfold on demand, and keep a manual fold', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/app.html?demo');
  await login(page);
  await page.waitForSelector('#report:not([hidden])');

  const ev = page.locator('#evidenceBox'), rules = page.locator('#ruleBox');

  // Re-measure the map each time: folding a box moves everything below it.
  const clickCell = async (row, frac) => {
    const map = page.locator('#map');
    await map.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const box = await map.boundingBox();
    const { cw, cols } = await map.evaluate(c => ({ cw: c._cw, cols: Math.round((c._w - 44) / c._cw) }));
    const x = box.x + 44 + Math.min(cols - 1, Math.round(cols * frac)) * cw + cw / 2;
    const y = box.y + 20 + row * 30 + 15;
    await page.mouse.click(x, y);
    return { x, y, cw };
  };

  // Evidence starts folded with a one-line state; your rules start unfolded.
  await expect(ev).not.toHaveAttribute('open', '');
  await expect(rules).toHaveAttribute('open', '');
  await expect(page.locator('#evidenceMeta')).toHaveText('Click a square on the map');
  await expect(page.locator('#rulesMeta')).toHaveText(/5 rules · flags \d+% of the recording/);
  expect(await page.locator('.shell').evaluate(el => getComputedStyle(el).gridTemplateColumns)).toMatch(/^272px \d+px$/); // analyses sidebar, then the report

  // Clicking a square unfolds Evidence by itself, on a cell that says what was found.
  await clickCell(3, 0.33);
  await expect(ev).toHaveAttribute('open', '');
  await expect(page.locator('#evidence h3')).toContainText('C4');
  await expect(page.locator('#evidenceMeta')).toHaveText(/C4 · \d+:\d\d–\d+:\d\d · (clean|flagged)/);

  // Folding by hand sticks: browsing the map must not pop it back open.
  await ev.locator('> summary').click();
  await expect(ev).not.toHaveAttribute('open', '');
  await clickCell(1, 0.5);
  await expect(ev).not.toHaveAttribute('open', '');
  await expect(page.locator('#evidenceMeta')).toHaveText(/F4 · /);

  // Teaching a rule always unfolds Your rules: the preview and its Add rule button live there.
  await rules.locator('> summary').click();
  await expect(rules).not.toHaveAttribute('open', '');
  const { x, y, cw } = await clickCell(3, 0.5);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + cw * 24, y, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Teach a rule from selection' }).click();
  await expect(rules).toHaveAttribute('open', '');
  await expect(page.locator('#proposal')).toBeVisible();
  await expect(page.locator('#pCount')).toContainText('changes the verdict');

  // A newly loaded recording goes back to the default: Evidence folded, your rules unfolded.
  await page.getByRole('button', { name: '+ New analysis' }).click();
  await page.getByRole('button', { name: 'Try the demo recording' }).click();
  await expect(ev).not.toHaveAttribute('open', '');
  await expect(rules).toHaveAttribute('open', '');
});
