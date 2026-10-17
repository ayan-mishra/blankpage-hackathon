import { test, expect } from '@playwright/test';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'researcher@example.com', aud: 'authenticated', role: 'authenticated' };
const token = () => {
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${encode({alg:'HS256'})}.${encode({sub:user.id, exp:Math.floor(Date.now()/1000)+3600})}.test`;
};
const session = () => ({ access_token: token(), refresh_token: 'test-refresh', token_type:'bearer', expires_in:3600, user });
async function mockBackend(page) {
  let rows = [], analyses = [];
  await page.route('https://somnium-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url());
    let body = {}, status = 200;
    if (url.pathname.endsWith('/token')) {
      if (request.postDataJSON()?.password === 'incorrect') { status = 400; body = { msg: 'Invalid login credentials', error_code:'invalid_credentials' }; }
      else body = session();
    } else if (url.pathname.endsWith('/signup')) body = { ...user, identities: [] };
    else if (url.pathname.endsWith('/user')) body = user;
    else if (url.pathname.includes('/rest/v1/analyses')) {
      if (request.method() === 'POST') { analyses.push(request.postDataJSON()); body = null; status = 201; }
      else if (request.method() === 'DELETE') { body = [{ id: 'gone' }]; analyses = []; }
      else body = analyses;
    }
    else if (url.pathname.includes('/rest/v1/checklists')) {
      if (request.method() === 'POST') { rows.push({ ...request.postDataJSON(), id:'saved-1', created_at: new Date().toISOString() }); body = null; status = 201; }
      else if (request.method() === 'DELETE') { body = [{id:'saved-1'}]; rows = []; }
      else if (url.searchParams.get('select') === 'rules') body = rows[0];
      else body = rows;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
async function login(page, password = 'password123') {
  await page.getByLabel('Email', {exact:true}).fill(user.email);
  await page.getByLabel('Password', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
}
test.beforeEach(async ({page}) => { await mockBackend(page); });

test('login error, login, save/load/delete, persisted session, logout and demo', async ({page}) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#report')).toBeVisible();
  await login(page, 'incorrect');
  await expect(page.getByRole('status')).toContainText('Invalid login credentials');
  await login(page);
  await expect(page.locator('#cloud')).toBeVisible();
  await page.getByLabel('Checklist name').fill('My lab');
  await page.getByRole('button',{name:'Save current checklist'}).click();
  await expect(page.getByRole('status')).toHaveText('Checklist saved.');
  await expect(page.locator('#savedChecklists option')).toHaveText('My lab');
  await page.locator('#checklist button').first().click();
  await expect(page.locator('#checklist li')).toHaveCount(4);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button',{name:'Load',exact:true}).click();
  await expect(page.locator('#checklist li')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('#cloud')).toBeVisible();
  await expect(page.locator('#savedChecklists option')).toHaveText('My lab');
  await page.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Saved checklist deleted.');
  await expect(page.locator('#savedChecklists option')).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('#cloud')).toBeHidden();
  await expect(page.locator('#savedChecklists option')).toHaveCount(0);
  await expect(page.locator('#report')).toBeVisible();
});
test('signup requires email confirmation and reset request works without password', async ({page}) => {
  await page.goto('/app.html');
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill('password123');
  await page.getByRole('button',{name:'Create account'}).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect(page.locator('#cloud')).toBeHidden();
  await page.getByRole('button',{name:'Send password reset'}).click();
  await expect(page.getByRole('status')).toContainText('password reset email');
});
test('recovery callback supports changing password', async ({page}) => {
  const auth = session();
  await page.goto(`/app.html#access_token=${auth.access_token}&refresh_token=${auth.refresh_token}&expires_in=3600&token_type=bearer&type=recovery`);
  await expect(page.locator('#recoveryForm')).toBeVisible();
  await page.getByLabel('New password',{exact:true}).fill('updated-password');
  await page.getByRole('button',{name:'Update password'}).click();
  await expect(page.getByRole('status')).toHaveText('Password updated.');
  await expect(page.locator('#cloud')).toBeVisible();
});
test('failed save leaves current rules intact and can be retried', async ({page}) => {
  await page.goto('/app.html?demo');
  await login(page);
  await expect(page.locator('#cloud')).toBeVisible();
  await page.route('**/rest/v1/checklists', async route => {
    if (route.request().method() === 'POST') await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Please try again.'})});
    else await route.fallback();
  });
  await page.getByLabel('Checklist name').fill('My lab');
  await page.getByRole('button',{name:'Save current checklist'}).click();
  await expect(page.getByRole('status')).toContainText('Please try again');
  await expect(page.locator('#checklist li')).toHaveCount(5);
  await expect(page.getByRole('button',{name:'Save current checklist'})).toBeEnabled();
});

test('late checklist response cannot restore private state after logout', async ({page}) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  await page.route('**/rest/v1/checklists?**', async route => {
    await wait;
    await route.fulfill({contentType:'application/json', body:JSON.stringify([{id:'private', name:'Private checklist'}])});
  });
  await page.goto('/app.html');
  const request = page.waitForRequest('**/rest/v1/checklists?**');
  await login(page);
  await request;
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('#authForm')).toBeVisible();
  release();
  await expect(page.locator('#cloud')).toBeHidden();
  await expect(page.locator('#savedChecklists option')).toHaveCount(0);
});
test('unconfigured copy still supports the demo', async ({page}) => {
  await page.route('**/src/supabase.js', route => route.fulfill({contentType:'application/javascript',body:'export const supabase = null;'}));
  await page.goto('/app.html?demo');
  await expect(page.getByRole('status')).toContainText('Accounts are not configured');
  await expect(page.locator('#authForm')).toBeHidden();
  await expect(page.locator('#report')).toBeVisible();
});
test('account forms fit desktop and mobile screens', async ({page}) => {
  await page.goto('/app.html?demo');
  await expect(page.locator('#authForm')).toBeVisible();
  await page.screenshot({path:'test-results/account-desktop.png', fullPage:true});
  await login(page);
  await expect(page.locator('#cloud')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Save current checklist'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/account-mobile.png',fullPage:true});
});
