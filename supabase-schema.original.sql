-- EduSphere MVP schema. Run in Supabase SQL Editor after creating a project.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin','teacher','student');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_status as enum ('pending','approved','rejected','suspended');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  student_id text,
  course text,
  academic_year text,
  role public.app_role not null default 'student',
  status public.account_status not null default 'pending',
  created_at timestamptz not null default now()
);
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  course_id uuid references public.courses(id) on delete set null,
  file_path text not null,
  file_name text not null,
  content_type text,
  uploaded_by uuid not null references auth.users(id),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.live_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null default '',
  description text default '',
  meeting_url text not null,
  provider text not null default 'Google Meet' check (provider in ('Google Meet','Zoom','Other')),
  starts_at timestamptz not null,
  course_id uuid references public.courses(id) on delete set null,
  created_by uuid not null references auth.users(id),
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  constraint live_classes_meeting_url_https check (meeting_url ~ '^https://')
);

create index if not exists profiles_role_status_idx on public.profiles(role,status);
create index if not exists materials_course_published_idx on public.materials(course_id,is_published);
create index if not exists live_classes_starts_idx on public.live_classes(starts_at);

-- Helper functions run with a fixed search_path to avoid search-path attacks.
create or replace function public.current_role() returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;
create or replace function public.current_status() returns public.account_status
language sql stable security definer set search_path = public
as $$ select status from public.profiles where id = auth.uid() $$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','teacher') and status='approved') $$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved') $$;
create or replace function public.set_student_status(p_user_id uuid, p_status public.account_status) returns void
language plpgsql security definer set search_path = public
as $$ begin
  if not public.is_admin() then raise exception 'Only an approved admin can change student status'; end if;
  if p_status not in ('approved','rejected','suspended','pending') then raise exception 'Invalid status'; end if;
  update public.profiles set status=p_status where id=p_user_id and role='student';
  if not found then raise exception 'Student account not found'; end if;
end; $$;
grant execute on function public.current_role(), public.current_status(), public.is_staff(), public.is_admin(), public.set_student_status(uuid, public.account_status) to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.materials enable row level security;
alter table public.live_classes enable row level security;

-- Profiles: users can read their own row; approved staff can manage profiles.
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- Restrict ordinary users to safe profile fields. Role/status are not granted for user updates.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, student_id, course, academic_year) on public.profiles to authenticated;
drop policy if exists profiles_update_self_safe on public.profiles;
create policy profiles_update_self_safe on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id=auth.uid() and role='student' and status='pending');

-- Profile creation trigger: signup metadata is copied, but role/status are hard-coded safely.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles(id,full_name,phone,student_id,course,academic_year,role,status)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), coalesce(new.raw_user_meta_data->>'phone',''), nullif(new.raw_user_meta_data->>'student_id',''), nullif(new.raw_user_meta_data->>'course',''), nullif(new.raw_user_meta_data->>'academic_year',''), 'student','pending')
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Courses.
drop policy if exists courses_read_active on public.courses;
create policy courses_read_active on public.courses for select to authenticated using (is_active or public.is_staff());
drop policy if exists courses_staff_insert on public.courses;
create policy courses_staff_insert on public.courses for insert to authenticated with check (public.is_staff());
drop policy if exists courses_staff_update on public.courses;
create policy courses_staff_update on public.courses for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists courses_admin_delete on public.courses;
create policy courses_admin_delete on public.courses for delete to authenticated using (public.is_admin());

-- Materials: students only see published material; staff can manage material.
drop policy if exists materials_read_published_or_staff on public.materials;
create policy materials_read_published_or_staff on public.materials for select to authenticated using ((is_published and public.current_status()='approved') or public.is_staff());
drop policy if exists materials_staff_insert on public.materials;
create policy materials_staff_insert on public.materials for insert to authenticated with check (public.is_staff() and uploaded_by=auth.uid());
drop policy if exists materials_staff_update on public.materials;
create policy materials_staff_update on public.materials for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists materials_staff_delete on public.materials;
create policy materials_staff_delete on public.materials for delete to authenticated using (public.is_staff());

-- Live classes: approved students see published classes; staff can manage.
drop policy if exists classes_read_published_or_staff on public.live_classes;
create policy classes_read_published_or_staff on public.live_classes for select to authenticated using ((is_published and public.current_status()='approved') or public.is_staff());
drop policy if exists classes_staff_insert on public.live_classes;
create policy classes_staff_insert on public.live_classes for insert to authenticated with check (public.is_staff() and created_by=auth.uid());
drop policy if exists classes_staff_update on public.live_classes;
create policy classes_staff_update on public.live_classes for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists classes_staff_delete on public.live_classes;
create policy classes_staff_delete on public.live_classes for delete to authenticated using (public.is_staff());

-- Private bucket. Students can download only files attached to published material records.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('study-materials','study-materials',false,52428800,array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
on conflict (id) do update set public=false, file_size_limit=52428800;
drop policy if exists materials_storage_staff_upload on storage.objects;
create policy materials_storage_staff_upload on storage.objects for insert to authenticated with check (bucket_id='study-materials' and public.is_staff());
drop policy if exists materials_storage_staff_update on storage.objects;
create policy materials_storage_staff_update on storage.objects for update to authenticated using (bucket_id='study-materials' and public.is_staff()) with check (bucket_id='study-materials' and public.is_staff());
drop policy if exists materials_storage_staff_delete on storage.objects;
create policy materials_storage_staff_delete on storage.objects for delete to authenticated using (bucket_id='study-materials' and public.is_staff());
drop policy if exists materials_storage_read_authorized on storage.objects;
create policy materials_storage_read_authorized on storage.objects for select to authenticated using (
  bucket_id='study-materials' and (
    public.is_staff() or exists(select 1 from public.materials m where m.file_path=name and m.is_published and public.current_status()='approved')
  )
);

-- IMPORTANT: create the first admin only after signing up that account in Supabase Auth.
-- Then run this separately, replacing the UUID with that user's Auth UID:
-- update public.profiles set role='admin', status='approved' where id='AUTH-USER-UUID';
