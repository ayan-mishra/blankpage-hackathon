create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Validate at the database boundary too: the browser is not an authority.
create function private.valid_checklist_rules(rules jsonb)
returns boolean
language plpgsql immutable strict
set search_path = ''
as $$
declare rule jsonb;
begin
  if jsonb_typeof(rules) <> 'array' then return false; end if;
  if jsonb_array_length(rules) > 100 then return false; end if;
  for rule in select value from jsonb_array_elements(rules) loop
    if jsonb_typeof(rule) <> 'object' then return false; end if;
    if not (rule ?& array['id','name','metric','op','value'])
       or rule - array['id','name','metric','op','value'] <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(rule->'id') <> 'string' or char_length(rule->>'id') > 100
       or jsonb_typeof(rule->'name') <> 'string' or char_length(rule->>'name') > 60
       or jsonb_typeof(rule->'metric') <> 'string'
       or rule->>'metric' not in ('flat','ptp','kurtosis','line50','line60')
       or rule->>'op' not in ('>','<') or jsonb_typeof(rule->'op') <> 'string'
       or jsonb_typeof(rule->'value') <> 'number' then return false; end if;
    if abs((rule->>'value')::numeric) > 1.7976931348623157e308 then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_checklist_rules(jsonb) from public;
grant execute on function private.valid_checklist_rules(jsonb) to authenticated;

create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  rules jsonb not null check (private.valid_checklist_rules(rules)),
  created_at timestamptz not null default now()
);
create index checklists_user_created_idx on public.checklists (user_id, created_at desc);
alter table public.checklists enable row level security;
revoke all on table public.checklists from public, anon, authenticated;
grant select, insert, delete on table public.checklists to authenticated;
create policy "Read own checklists" on public.checklists for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Save own checklists" on public.checklists for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Delete own checklists" on public.checklists for delete to authenticated
  using ((select auth.uid()) = user_id);
