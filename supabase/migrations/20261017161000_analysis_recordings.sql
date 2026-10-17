-- Reopening a saved analysis needs two extra things: the checklist it was scored
-- with, and the recording itself.
--
--   checklist    - the exact rules used, so the verdict can be reproduced.
--   storage_path - the object in the private `recordings` bucket, if kept.
--   size_bytes   - the stored file size, shown in the sidebar.
--
-- Rows stay immutable (no UPDATE grant). The bucket is private: objects live under
-- a `<user_id>/` prefix and the policies below are the only way in.
alter table public.analyses
  add column if not exists checklist jsonb not null default '[]'::jsonb
    check (private.valid_checklist_rules(checklist)),
  add column if not exists storage_path text
    -- Mirrors the browser check: relative, trimmed, bounded, no traversal.
    check (storage_path is null or (
      storage_path = btrim(storage_path)
      and char_length(storage_path) between 1 and 400
      and storage_path not like '/%'
      and position('..' in storage_path) = 0
    )),
  add column if not exists size_bytes bigint
    -- 1 GiB is the app's ceiling; the bucket below caps actual uploads at what
    -- this project's storage plan allows.
    check (size_bytes is null or (size_bytes > 0 and size_bytes <= 1073741824));

-- Private bucket. 50 MiB is this project's plan maximum for a single object.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 52428800, array['application/octet-stream', 'application/edf', 'application/x-edf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- One policy per operation, each scoped to the caller's own folder. No UPDATE
-- policy: a stored recording is written once and never rewritten in place.
drop policy if exists "Read own recordings" on storage.objects;
drop policy if exists "Upload own recordings" on storage.objects;
drop policy if exists "Delete own recordings" on storage.objects;

create policy "Read own recordings" on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Upload own recordings" on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Delete own recordings" on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
