import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
    // Supabase's optional automatic-RLS setup installs this trigger helper.
    await db.exec(`create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$begin return;end;$$;`);
    for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).sort()) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    }
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_function_privilege($1, 'public.rls_auto_enable()', 'execute') as allowed`,[role])).rows[0].allowed, false);
    }
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

test('analyses migration keeps saved analyses private, immutable and validated', async () => {
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
    for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).sort()) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    }
    const insert = (over = {}) => {
      const row = { local_id: 'local-1', filename: 'night.edf', duration_sec: 300, channels: 6, sample_rate: 128, ...over };
      return db.query(
        'insert into public.analyses(local_id,filename,duration_sec,channels,sample_rate) values ($1,$2,$3,$4,$5) returning id',
        [row.local_id, row.filename, row.duration_sec, row.channels, row.sample_rate],
      );
    };

    await db.exec(`set role authenticated; set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';`);
    const { rows: [row] } = await insert();
    assert.ok(row.id);
    assert.equal((await db.query('select * from public.analyses')).rows.length, 1);
    // Re-syncing the same browser analysis must not duplicate it.
    await assert.rejects(insert(), /duplicate key|unique/i);
    for (const over of [
      { local_id: '' }, { local_id: '  ' }, { filename: '   ' }, { filename: 'x'.repeat(201) },
      { duration_sec: 0 }, { duration_sec: -1 }, { duration_sec: 86401 },
      { channels: 0 }, { channels: 1025 }, { channels: 2.5 },
      { sample_rate: 0 }, { sample_rate: 2e6 },
    ]) {
      await assert.rejects(insert(over), /check constraint|invalid input syntax/);
    }
    // Snapshots are immutable: no UPDATE grant exists.
    await assert.rejects(db.query("update public.analyses set filename = 'changed'"), /permission denied/);

    await db.exec(`set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';`);
    assert.equal((await db.query('select * from public.analyses')).rows.length, 0);
    assert.equal((await db.query('delete from public.analyses where id=$1 returning id', [row.id])).rows.length, 0);
    await assert.rejects(
      db.query("insert into public.analyses(user_id,local_id,filename,duration_sec,channels,sample_rate) values ('00000000-0000-4000-8000-000000000001','stolen','x.edf',10,1,100)"),
      /row-level security/,
    );
    // The same local id belongs to each account separately.
    await insert();
    assert.equal((await db.query('select * from public.analyses')).rows.length, 1);

    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from public.analyses'), /permission denied/);
    await assert.rejects(
      db.query("insert into public.analyses(local_id,filename,duration_sec,channels,sample_rate) values ('a','x.edf',10,1,100)"),
      /permission denied/,
    );

    // Deleting the account removes that account's saved analyses, and only those.
    await db.exec(`reset role; delete from auth.users where id = '00000000-0000-4000-8000-000000000001';`);
    const remaining = (await db.query('select user_id from public.analyses')).rows;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].user_id, '00000000-0000-4000-8000-000000000002');
  } finally { await db.close(); }
});

test('trigger restriction migration also works without the optional trigger', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../supabase/migrations/20261017145936_restrict_auto_rls_function.sql', import.meta.url), 'utf8'));
  } finally { await db.close(); }
});
