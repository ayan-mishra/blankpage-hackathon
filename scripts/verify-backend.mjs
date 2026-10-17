// Creates two synthetic accounts without sending email and removes only those accounts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_CHECKLIST } from '../src/rules.js';

const url = process.env.SUPABASE_URL ?? 'https://czixliadrvvdooktoahe.supabase.co';
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Pe3kgh3XRrENKdIPAXTwQA_NI9cQxhc';
if (!process.env.SUPABASE_SECRET_KEY_FILE) throw new Error('Set SUPABASE_SECRET_KEY_FILE to a protected local file. Never commit the key.');
const secret = (await readFile(process.env.SUPABASE_SECRET_KEY_FILE, 'utf8')).trim();
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);
const created = [], clients = [];
function checked(result) { assert.equal(result.error, null, result.error?.message); return result.data; }
try {
  for (let i = 0; i < 2; i++) {
    const email = `somnium-check-${randomUUID()}@example.com`, password = randomBytes(24).toString('base64url');
    const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm:true }));
    created.push(user.id);
    const client = createClient(url, key, options);
    checked(await client.auth.signInWithPassword({email,password}));
    clients.push({client,email,password});
  }
  const [a,b] = clients.map(c => c.client);
  const anonymous = createClient(url,key,options);
  assert.equal((await anonymous.from('checklists').select('*')).error?.code, '42501');
  const row = checked(await a.from('checklists').insert({name:'Backend verification', rules:DEFAULT_CHECKLIST}).select().single());
  assert.equal(row.user_id, created[0]);
  assert.deepEqual(row.rules, DEFAULT_CHECKLIST);
  assert.equal(checked(await b.from('checklists').select('id').eq('id',row.id)).length,0);
  assert.equal(checked(await b.from('checklists').delete().eq('id',row.id).select('id')).length,0);
  assert.equal((await b.from('checklists').insert({user_id:created[0],name:'Forbidden',rules:[]})).error?.code,'42501');
  assert.equal((await a.from('checklists').insert({name:'Invalid',rules:[null]})).error?.code,'23514');
  assert.equal((await a.from('checklists').update({name:'Forbidden update'}).eq('id',row.id)).error?.code,'42501');
  checked(await b.from('checklists').insert({name:'Second account',rules:[]}));
  if (process.env.SOMNIUM_APP_URL) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(process.env.SOMNIUM_APP_URL);
      await page.locator('#email').fill(clients[0].email);
      await page.locator('#password').fill(clients[0].password);
      await page.locator('#login').click();
      await page.locator('#cloud').waitFor({state:'visible'});
      await page.locator('#savedChecklists option').filter({hasText:'Backend verification'}).waitFor({state:'attached'});
      await page.locator('#checklistName').fill('Live browser verification');
      await page.locator('#saveChecklist').click();
      await page.getByRole('status').filter({hasText:'Checklist saved.'}).waitFor();
      const browserRows = checked(await a.from('checklists').select('name'));
      assert.ok(browserRows.some(r => r.name === 'Live browser verification'));
      await page.reload();
      await page.locator('#cloud').waitFor({state:'visible'});
      await page.locator('#savedChecklists option').filter({hasText:'Live browser verification'}).waitFor({state:'attached'});
      await page.screenshot({path:'/tmp/somnium-live-login.png',fullPage:true});
      await page.locator('#signOut').click();
      await page.locator('#authForm').waitFor({state:'visible'});
      console.log('PASS: live browser login, private checklist save, persisted session and logout.');
    } finally { await browser.close(); }
  }
  const recovery = checked(await admin.auth.admin.generateLink({type:'recovery',email:clients[0].email,options:{redirectTo:'http://127.0.0.1:8082/app.html'}}));
  assert.equal(new URL(recovery.properties.action_link).searchParams.get('redirect_to'),'http://127.0.0.1:8082/app.html');
  checked(await a.auth.verifyOtp({token_hash:recovery.properties.hashed_token,type:'recovery'}));
  const replacement = randomBytes(24).toString('base64url');
  checked(await a.auth.updateUser({password:replacement}));
  checked(await a.auth.signOut({scope:'local'}));
  assert.ok((await a.auth.signInWithPassword({email:clients[0].email,password:clients[0].password})).error);
  checked(await a.auth.signInWithPassword({email:clients[0].email,password:replacement}));
  assert.equal(checked(await a.from('checklists').delete().eq('id',row.id).select('id')).length,1);
  console.log('PASS: hosted login, owner save/load/delete, cross-account isolation, anonymous denial, validation, recovery token and password update.');
} finally {
  for (const {client} of clients) await client.auth.signOut({scope:'local'});
  for (const id of created) checked(await admin.auth.admin.deleteUser(id));
  console.log(`Removed ${created.length} synthetic verification accounts and their checklist rows.`);
}
