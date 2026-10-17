// Shared mocked Supabase backend for the browser tests: the real SDK talks to
// https://somnium-test.supabase.co (see playwright.config.js), answered here.
import { expect } from '@playwright/test';

export const user = { id: '00000000-0000-4000-8000-000000000001', email: 'researcher@example.com', aud: 'authenticated', role: 'authenticated' };
const token = () => {
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
};
export const session = () => ({ access_token: token(), refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user });

export const newState = () => ({ analyses: [], posted: [], checklists: [], objects: new Map(), uploads: 0, downloads: 0 });

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
    if (headerEnd !== -1 && /filename=/.test(part.subarray(0, headerEnd).toString('latin1'))) {
      return part.subarray(headerEnd + 4, part.length - 2);
    }
    start = next;
  }
  return buf;
}

export async function mockBackend(page, state = newState()) {
  await page.route('https://somnium-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;

    if (path.includes('/storage/v1/object/recordings')) {
      const key = path.includes('/object/recordings/') ? decodeURIComponent(path.split('/object/recordings/')[1]) : '';
      if (request.method() === 'DELETE') {
        for (const k of request.postDataJSON()?.prefixes ?? []) state.objects.delete(k);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (request.method() === 'GET' || request.method() === 'HEAD') {
        const bytes = state.objects.get(key);
        state.downloads++;
        if (!bytes) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"not found"}' });
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes });
      }
      state.objects.set(key, extractFilePart(request.postDataBuffer(), request.headers()['content-type']));
      state.uploads++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `recordings/${key}` }) });
    }

    let body = {}, status = 200;
    if (path.endsWith('/token')) {
      if (request.postDataJSON()?.password === 'incorrect') { status = 400; body = { msg: 'Invalid login credentials', error_code: 'invalid_credentials' }; }
      else body = session();
    } else if (path.endsWith('/signup')) body = { ...user, identities: [] };
    else if (path.endsWith('/user')) body = user;
    else if (path.includes('/rest/v1/analyses')) {
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        state.posted.push(row); state.analyses.push(row);
        body = null; status = 201;
      } else if (request.method() === 'DELETE') {
        const id = url.searchParams.get('local_id')?.replace(/^eq\./, '');
        body = state.analyses.filter(r => r.local_id === id).map(() => ({ id: 'gone' }));
        state.analyses = state.analyses.filter(r => r.local_id !== id);
      } else body = state.analyses;
    } else if (path.includes('/rest/v1/checklists')) {
      if (request.method() === 'POST') { state.checklists.push({ ...request.postDataJSON(), id: 'saved-1', created_at: new Date().toISOString() }); body = null; status = 201; }
      else if (request.method() === 'DELETE') { body = [{ id: 'saved-1' }]; state.checklists = []; }
      else if (url.searchParams.get('select') === 'rules') body = state.checklists[0];
      else body = state.checklists;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return state;
}

// Fill the gate's sign-in form. With `expectApp`, wait until the app is showing.
export async function login(page, { password = 'password123', expectApp = true } = {}) {
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (expectApp) await expect(page.locator('#appShell')).toBeVisible();
}

// Open the sidebar's account menu (signed-in email, sign out, saved checklists).
export async function openAccount(page) {
  const menu = page.locator('#account');
  if (!(await menu.evaluate(d => d.open))) await menu.locator('summary').click();
}

// The demo recording as a real EDF file, so a test can "drop" a non-demo recording.
export async function edfFile(page, name = 'night1.edf') {
  const bytes = await page.evaluate(async () => {
    const { demoFile } = await import('/src/demo.js');
    return Array.from(new Uint8Array(await demoFile().arrayBuffer()));
  });
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) };
}

export const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
