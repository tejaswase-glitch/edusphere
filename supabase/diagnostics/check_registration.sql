-- READ-ONLY diagnostics. Run each block in Supabase SQL Editor and compare with docs/BUG_FIX notes.
-- 1) Is the signup trigger installed on auth.users?
select tgname, tgenabled from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- 2) Signups that have NO profile row (these never show in the Admin list). Migration 001 backfills them.
select u.id, u.email, u.created_at, u.raw_user_meta_data from auth.users u left join public.profiles p on p.id = u.id where p.id is null order by u.created_at desc;
-- 3) Which metadata keys do real signups carry? (must be full_name, phone, student_id, course, academic_year)
select distinct jsonb_object_keys(raw_user_meta_data) as key from auth.users;
-- 4) Current profile status counts
select role, status, count(*) from public.profiles group by 1,2 order by 1,2;
-- 5) Do both status functions exist?
select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname in ('set_student_status','set_account_status','handle_new_user','is_admin','is_staff','is_approved','current_status');
-- 6) Enum labels (must be pending, approved, rejected, suspended)
select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typname in ('account_status','app_role') order by 1, e.enumsortorder;
-- 7) Policies on profiles
select policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename='profiles';
-- 8) Storage buckets
select id, public, file_size_limit, allowed_mime_types from storage.buckets;
