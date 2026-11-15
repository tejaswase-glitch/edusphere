-- EduSphere 001 upgrade. Incremental and idempotent: safe to run on the existing project. Run once in SQL Editor.
-- 0) DIAGNOSTIC (optional, run first): profiles missing for existing auth users
-- select u.id,u.email from auth.users u left join public.profiles p on p.id=u.id where p.id is null;

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists subject text;

-- 1) Reliable profile trigger (+ email) and BACKFILL of any signup that never got a profile.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email,full_name,phone,student_id,course,academic_year,role,status)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.raw_user_meta_data->>'phone',''),
    nullif(new.raw_user_meta_data->>'student_id',''),nullif(new.raw_user_meta_data->>'course',''),nullif(new.raw_user_meta_data->>'academic_year',''),'student','pending')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.profiles(id,email,full_name,phone,student_id,course,academic_year,role,status)
select u.id,u.email,coalesce(u.raw_user_meta_data->>'full_name',''),coalesce(u.raw_user_meta_data->>'phone',''),
  nullif(u.raw_user_meta_data->>'student_id',''),nullif(u.raw_user_meta_data->>'course',''),nullif(u.raw_user_meta_data->>'academic_year',''),'student','pending'
from auth.users u where not exists(select 1 from public.profiles p where p.id=u.id);
update public.profiles p set email=u.email from auth.users u where u.id=p.id and p.email is null;

-- 2) Role/status can never be changed by the user themselves (only admin, or server-side service role where auth.uid() is null).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and (new.role<>old.role or new.status<>old.status or new.id<>old.id) then
    raise exception 'Not allowed to change role or status';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles for each row execute procedure public.guard_profile_update();

-- Admin may change status of students AND teachers via RPC (never admins).
create or replace function public.set_account_status(p_user_id uuid, p_status public.account_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an approved admin can change account status'; end if;
  update public.profiles set status=p_status where id=p_user_id and role in ('student','teacher');
  if not found then raise exception 'Account not found'; end if;
end $$;
grant execute on function public.set_account_status(uuid, public.account_status) to authenticated;
create or replace function public.is_approved() returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and status='approved') $$;
grant execute on function public.is_approved() to authenticated;

-- 3) Materials: subject column; teachers edit only their own, admin all.
alter table public.materials add column if not exists subject text default '';
drop policy if exists materials_staff_update on public.materials;
create policy materials_staff_update on public.materials for update to authenticated using (public.is_admin() or (public.is_staff() and uploaded_by=auth.uid())) with check (public.is_admin() or (public.is_staff() and uploaded_by=auth.uid()));
drop policy if exists materials_staff_delete on public.materials;
create policy materials_staff_delete on public.materials for delete to authenticated using (public.is_admin() or (public.is_staff() and uploaded_by=auth.uid()));

-- 4) Live classes: status (scheduled/cancelled/completed), teacher name, updated_at; never hard-deleted by teachers.
alter table public.live_classes add column if not exists status text not null default 'scheduled';
alter table public.live_classes add column if not exists teacher_name text default '';
alter table public.live_classes add column if not exists updated_at timestamptz not null default now();
do $$ begin alter table public.live_classes add constraint live_classes_status_chk check (status in ('scheduled','cancelled','completed')); exception when duplicate_object then null; end $$;
drop policy if exists classes_staff_update on public.live_classes;
create policy classes_staff_update on public.live_classes for update to authenticated using (public.is_admin() or (public.is_staff() and created_by=auth.uid())) with check (public.is_admin() or (public.is_staff() and created_by=auth.uid()));
drop policy if exists classes_staff_delete on public.live_classes;
create policy classes_staff_delete on public.live_classes for delete to authenticated using (public.is_admin());
drop policy if exists classes_read_published_or_staff on public.live_classes;
create policy classes_read_published_or_staff on public.live_classes for select to authenticated using ((is_published and public.current_status()='approved') or public.is_staff());

-- 5) Recorded lectures. Stores only the YouTube video ID (full URLs are never stored or shown publicly).
create table if not exists public.recorded_lectures(
  id uuid primary key default gen_random_uuid(),
  title text not null, subject text not null default '', description text default '',
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  thumbnail_url text, teacher_name text default '',
  created_by uuid not null references auth.users(id),
  is_published boolean not null default false, created_at timestamptz not null default now());
alter table public.recorded_lectures enable row level security;
drop policy if exists lectures_read on public.recorded_lectures;
create policy lectures_read on public.recorded_lectures for select to authenticated using ((is_published and public.current_status()='approved') or public.is_admin() or (public.is_staff() and created_by=auth.uid()));
drop policy if exists lectures_insert on public.recorded_lectures;
create policy lectures_insert on public.recorded_lectures for insert to authenticated with check (public.is_staff() and created_by=auth.uid());
drop policy if exists lectures_update on public.recorded_lectures;
create policy lectures_update on public.recorded_lectures for update to authenticated using (public.is_admin() or (public.is_staff() and created_by=auth.uid())) with check (public.is_admin() or (public.is_staff() and created_by=auth.uid()));
drop policy if exists lectures_delete on public.recorded_lectures;
create policy lectures_delete on public.recorded_lectures for delete to authenticated using (public.is_admin() or (public.is_staff() and created_by=auth.uid()));

-- 6) Public-safe preview: no video id, no URLs except an explicit thumbnail, no student data.
create or replace view public.public_lectures as
  select id,title,subject,left(description,160) as description,thumbnail_url,teacher_name from public.recorded_lectures where is_published;
grant select on public.public_lectures to anon, authenticated;
