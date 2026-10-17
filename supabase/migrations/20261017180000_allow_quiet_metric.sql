-- Allow the 'quiet' (signal too faint) metric added to the default checklist.
-- create or replace keeps the existing grants and the table's check constraint.
create or replace function private.valid_checklist_rules(rules jsonb)
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
       or rule->>'metric' not in ('flat','quiet','ptp','kurtosis','line50','line60')
       or rule->>'op' not in ('>','<') or jsonb_typeof(rule->'op') <> 'string'
       or jsonb_typeof(rule->'value') <> 'number' then return false; end if;
    if abs((rule->>'value')::numeric) > 1.7976931348623157e308 then return false; end if;
  end loop;
  return true;
end;
$$;
