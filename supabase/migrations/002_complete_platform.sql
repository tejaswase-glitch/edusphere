-- =====================================================================
-- EduSphere 002 - complete platform migration (incremental + idempotent)
-- Run AFTER 001_upgrade.sql, once, in Supabase > SQL Editor.
-- It never drops tables or data. It only adds columns/tables and
-- replaces policies/functions with tighter versions.
-- =====================================================================

-- 0) Safety guard -----------------------------------------------------
do $$ begin
  if to_regclass('public.recorded_lectures') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='profiles' and column_name='email') then
    raise exception 'Run supabase/migrations/001_upgrade.sql first.';
  end if;
end $$;

-- 1) Subjects (managed by Admin) --------------------------------------
create table if not exists public.subjects(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now());
create unique index if not exists subjects_name_lower_uq on public.subjects(lower(name));
alter table public.subjects enable row level security;
drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select to authenticated
  using ((is_active and public.is_approved()) or public.is_admin());
drop policy if exists subjects_admin_insert on public.subjects;
create policy subjects_admin_insert on public.subjects for insert to authenticated with check (public.is_admin());
drop policy if exists subjects_admin_update on public.subjects;
create policy subjects_admin_update on public.subjects for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists subjects_admin_delete on public.subjects;
create policy subjects_admin_delete on public.subjects for delete to authenticated using (public.is_admin());
insert into public.subjects(name) values ('Biology'),('Mathematics'),('Physics'),('Chemistry') on conflict do nothing;

-- 2) Courses: teachers manage only their own; admin manages all --------
alter table public.courses add column if not exists subject text default '';
drop policy if exists courses_read_active on public.courses;
drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated
  using ((is_active and public.is_approved()) or public.is_admin() or (public.is_staff() and created_by=auth.uid()));
drop policy if exists courses_staff_insert on public.courses;
create policy courses_staff_insert on public.courses for insert to authenticated
  with check (public.is_staff() and created_by=auth.uid());
drop policy if exists courses_staff_update on public.courses;
create policy courses_staff_update on public.courses for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by=auth.uid()))
  with check (public.is_admin() or (public.is_staff() and created_by=auth.uid()));
-- courses_admin_delete (admin only) from the original schema is kept.

-- 3) Recorded lectures: optional course link ---------------------------
alter table public.recorded_lectures add column if not exists course_id uuid references public.courses(id) on delete set null;

-- 4) Materials: everyone approved sees published; teachers also see their own drafts
drop policy if exists materials_read_published_or_staff on public.materials;
drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated
  using ((is_published and public.is_approved()) or public.is_admin() or (public.is_staff() and uploaded_by=auth.uid()));
-- insert/update/delete policies from 001 already enforce: admin = any row, teacher = own rows only.

-- 5) Live classes: reschedule / cancel history -------------------------
alter table public.live_classes add column if not exists rescheduled_at timestamptz;
alter table public.live_classes add column if not exists original_starts_at timestamptz;
alter table public.live_classes add column if not exists cancelled_at timestamptz;
drop policy if exists classes_read_published_or_staff on public.live_classes;
drop policy if exists classes_read on public.live_classes;
create policy classes_read on public.live_classes for select to authenticated
  using ((is_published and public.is_approved()) or public.is_admin() or (public.is_staff() and created_by=auth.uid()));

create or replace function public.live_class_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.rescheduled_at := now();
    new.original_starts_at := coalesce(old.original_starts_at, old.starts_at);
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then new.cancelled_at := now(); end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' and not public.is_admin() then
    raise exception 'A cancelled class cannot be reopened. Create a new class instead.';
  end if;
  return new;
end $$;
drop trigger if exists live_class_before_update on public.live_classes;
create trigger live_class_before_update before update on public.live_classes
  for each row execute function public.live_class_before_update();

-- 6) Ownership columns can never be changed ----------------------------
create or replace function public.guard_owner_immutable() returns trigger
language plpgsql set search_path = public as $$
declare col text := case tg_table_name when 'materials' then 'uploaded_by' else 'created_by' end;
begin
  if (to_jsonb(new)->>col) is distinct from (to_jsonb(old)->>col) then
    raise exception 'Ownership cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists guard_owner_materials on public.materials;
create trigger guard_owner_materials before update on public.materials for each row execute function public.guard_owner_immutable();
drop trigger if exists guard_owner_lectures on public.recorded_lectures;
create trigger guard_owner_lectures before update on public.recorded_lectures for each row execute function public.guard_owner_immutable();
drop trigger if exists guard_owner_classes on public.live_classes;
create trigger guard_owner_classes before update on public.live_classes for each row execute function public.guard_owner_immutable();
drop trigger if exists guard_owner_courses on public.courses;
create trigger guard_owner_courses before update on public.courses for each row execute function public.guard_owner_immutable();

-- 7) Audit log (admin read only; written only by triggers / trusted functions)
create table if not exists public.audit_log(
  id bigint generated always as identity primary key,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_title text,
  performed_by uuid,
  performer_name text,
  performer_role text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.write_audit(p_action text, p_type text, p_id text, p_title text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_role text;
begin
  select full_name, role::text into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log(action,entity_type,entity_id,entity_title,performed_by,performer_name,performer_role,details)
  values (p_action,p_type,p_id,p_title,auth.uid(),coalesce(v_name,'system'),coalesce(v_role,'system'),coalesce(p_details,'{}'::jsonb));
end $$;
revoke execute on function public.write_audit(text,text,text,text,jsonb) from public, anon, authenticated;

create or replace function public.audit_row_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'materials' then
    perform public.write_audit('deleted','material',old.id::text,old.title,
      jsonb_build_object('subject',old.subject,'file_name',old.file_name,'uploaded_by',old.uploaded_by,'was_published',old.is_published));
  elsif tg_table_name = 'recorded_lectures' then
    perform public.write_audit('deleted','recorded_lecture',old.id::text,old.title,
      jsonb_build_object('subject',old.subject,'teacher_name',old.teacher_name,'created_by',old.created_by,'was_published',old.is_published));
  elsif tg_table_name = 'live_classes' then
    perform public.write_audit('deleted','live_class',old.id::text,old.title,
      jsonb_build_object('subject',old.subject,'starts_at',old.starts_at,'created_by',old.created_by,'status',old.status));
  elsif tg_table_name = 'courses' then
    perform public.write_audit('deleted','course',old.id::text,old.title,jsonb_build_object('created_by',old.created_by));
  end if;
  return old;
end $$;
drop trigger if exists audit_materials_delete on public.materials;
create trigger audit_materials_delete after delete on public.materials for each row execute function public.audit_row_delete();
drop trigger if exists audit_lectures_delete on public.recorded_lectures;
create trigger audit_lectures_delete after delete on public.recorded_lectures for each row execute function public.audit_row_delete();
drop trigger if exists audit_classes_delete on public.live_classes;
create trigger audit_classes_delete after delete on public.live_classes for each row execute function public.audit_row_delete();
drop trigger if exists audit_courses_delete on public.courses;
create trigger audit_courses_delete after delete on public.courses for each row execute function public.audit_row_delete();

-- Status changes by Admin are audited too.
create or replace function public.set_account_status(p_user_id uuid, p_status public.account_status) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'Only an approved admin can change account status'; end if;
  select id, full_name, role::text as role, status::text as status into r
    from public.profiles where id = p_user_id and role in ('student','teacher');
  if not found then raise exception 'Account not found'; end if;
  update public.profiles set status = p_status where id = p_user_id;
  perform public.write_audit('status_'||p_status::text, r.role, p_user_id::text, r.full_name,
    jsonb_build_object('from', r.status, 'to', p_status::text));
end $$;
grant execute on function public.set_account_status(uuid, public.account_status) to authenticated;

-- 8) Learning progress (real data for the student dashboard) -----------
create table if not exists public.lecture_progress(
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.recorded_lectures(id) on delete cascade,
  first_watched_at timestamptz not null default now(),
  last_watched_at timestamptz not null default now(),
  completed boolean not null default false,
  completed_at timestamptz,
  primary key (user_id, lecture_id));
alter table public.lecture_progress enable row level security;
drop policy if exists progress_select on public.lecture_progress;
create policy progress_select on public.lecture_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists progress_insert on public.lecture_progress;
create policy progress_insert on public.lecture_progress for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());
drop policy if exists progress_update on public.lecture_progress;
create policy progress_update on public.lecture_progress for update to authenticated
  using (user_id = auth.uid() and public.is_approved()) with check (user_id = auth.uid() and public.is_approved());

-- 9) Storage: study-materials (private), ownership based ---------------
update storage.buckets set
  file_size_limit = 52428800,
  allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp','image/gif','text/plain',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id = 'study-materials';

drop policy if exists materials_storage_staff_upload on storage.objects;
create policy materials_storage_staff_upload on storage.objects for insert to authenticated
  with check (bucket_id='study-materials' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists materials_storage_staff_update on storage.objects;
create policy materials_storage_staff_update on storage.objects for update to authenticated
  using (bucket_id='study-materials' and (public.is_admin() or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)))
  with check (bucket_id='study-materials' and (public.is_admin() or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)));
drop policy if exists materials_storage_staff_delete on storage.objects;
create policy materials_storage_staff_delete on storage.objects for delete to authenticated
  using (bucket_id='study-materials' and (public.is_admin() or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)));
drop policy if exists materials_storage_read_authorized on storage.objects;
create policy materials_storage_read_authorized on storage.objects for select to authenticated
  using (bucket_id='study-materials' and (
    public.is_admin()
    or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)
    or exists(select 1 from public.materials m where m.file_path = name and m.is_published and public.is_approved())));

-- 10) Storage: lecture-thumbnails (PUBLIC by design: shown on the homepage)
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('lecture-thumbnails','lecture-thumbnails',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=true, file_size_limit=2097152, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists thumbs_staff_insert on storage.objects;
create policy thumbs_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id='lecture-thumbnails' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists thumbs_staff_update on storage.objects;
create policy thumbs_staff_update on storage.objects for update to authenticated
  using (bucket_id='lecture-thumbnails' and (public.is_admin() or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)))
  with check (bucket_id='lecture-thumbnails' and (public.is_admin() or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)));
drop policy if exists thumbs_staff_delete on storage.objects;
create policy thumbs_staff_delete on storage.objects for delete to authenticated
  using (bucket_id='lecture-thumbnails' and (public.is_admin() or (public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text)));

-- 11) Anonymous visitors get NO direct table access (only the safe preview view)
revoke all on public.profiles, public.courses, public.materials, public.live_classes,
  public.recorded_lectures, public.subjects, public.lecture_progress from anon;
-- public.public_lectures (created in 001) stays readable by anon: no video id, no links.

-- 12) Optional read-only checks ---------------------------------------
-- select tablename, rowsecurity from pg_tables where schemaname='public';
-- select tablename, policyname, cmd from pg_policies where schemaname in ('public','storage') order by 1,2;
