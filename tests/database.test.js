import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_CHECKLIST } from '../src/rules.js';

test('migration enforces owner access, least privilege and rule validation in Postgres', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261017144704_private_checklists.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';`);
    const { rows: [row] } = await db.query('insert into public.checklists(name,rules) values ($1,$2) returning id', ['Lab', JSON.stringify(DEFAULT_CHECKLIST)]);
    assert.equal((await db.query('select * from public.checklists')).rows.length, 1);
    for (const rules of [{}, [null], [{...DEFAULT_CHECKLIST[0], metric:'__proto__'}], [{...DEFAULT_CHECKLIST[0], value:null}],
      [{...DEFAULT_CHECKLIST[0],value:1e309}], [{...DEFAULT_CHECKLIST[0],name:'x'.repeat(61)}],
      [{...DEFAULT_CHECKLIST[0],recording:'must not store'}], Array(101).fill(DEFAULT_CHECKLIST[0])]) {
      await assert.rejects(db.query('insert into public.checklists(name,rules) values ($1,$2)', ['Lab',JSON.stringify(rules)]), /check constraint/);
    }
    await assert.rejects(db.query('insert into public.checklists(name,rules) values ($1,$2)', ['  ', '[]']), /check constraint/);
    await assert.rejects(db.query("update public.checklists set name = 'changed'"), /permission denied/);
    await db.exec(`set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';`);
    assert.equal((await db.query('select * from public.checklists')).rows.length, 0);
    assert.equal((await db.query('delete from public.checklists where id=$1 returning id', [row.id])).rows.length, 0);
    await assert.rejects(db.query('insert into public.checklists(user_id,name,rules) values ($1,$2,$3)', ['00000000-0000-4000-8000-000000000001','stolen','[]']), /row-level security/);
    await db.query('insert into public.checklists(name,rules) values ($1,$2)', ['Second user','[]']);
    await db.exec(`set role anon;`);
    await assert.rejects(db.query('select * from public.checklists'), /permission denied/);
    await assert.rejects(db.query("insert into public.checklists(name,rules) values ('anon','[]')"), /permission denied/);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';`);
    assert.equal((await db.query('delete from public.checklists where id=$1 returning id',[row.id])).rows.length, 1);
  } finally { await db.close(); }
});
