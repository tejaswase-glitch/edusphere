# Supabase setup (existing project jupcjqbvnrafadlkbqns)

I could not access your project, so nothing here was run. Review SQL before running. Take a backup first.

## A. Inspect the live schema (read-only)
```sql
select table_name from information_schema.tables where table_schema='public' order by 1;
select table_name, column_name, data_type from information_schema.columns where table_schema='public' order by 1, ordinal_position;
select tablename, policyname, cmd, roles from pg_policies where schemaname in ('public','storage') order by 1,2;
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal order by 2;
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1;
select id, public, file_size_limit from storage.buckets;
-- auth users that never got a profile (the "missing registrations" symptom):
select u.id,u.email,u.created_at from auth.users u left join public.profiles p on p.id=u.id where p.id is null;
```
Compare with `supabase-schema.original.sql` + `001`. `002` needs: enum `account_status`, table `profiles(email, subject)`, `recorded_lectures`, functions `is_admin()`, `is_staff()`, `is_approved()` (all created by `001`), and stops with a message if `001` is missing.

## B. Run the migrations (SQL Editor, in order)
1. `supabase/migrations/001_upgrade.sql` - repairs `handle_new_user()` + trigger, **backfills missing profiles as pending students**, adds role/status guard, `set_account_status()`, `recorded_lectures`, `public_lectures` view.
2. `supabase/migrations/002_complete_platform.sql` - subjects, ownership policies, audit log + triggers, progress table, storage policies, anon revoke.
Both are idempotent and non-destructive (no DROP TABLE, no deletes, existing enum values untouched; policies that are replaced are listed in `BUG_FIX_REPORT.md`).
**Check after running:** the first query in section A again, and `select * from public.audit_log limit 1;` (should return no error).

## C. Admin account
Your existing admin keeps working only if its profile has `role='admin'` and `status='approved'`. Check: `select email, role, status from public.profiles where role='admin';`. If wrong:
`update public.profiles set role='admin', status='approved' where email='YOUR@EMAIL';`

## D. Edge Function
```
npm i -g supabase
supabase login
supabase link --project-ref jupcjqbvnrafadlkbqns
supabase functions deploy admin-users
supabase secrets set ALLOWED_REDIRECT_ORIGINS=https://tejaswase-glitch.github.io
```
Test: sign in as Admin > Teachers > create. A non-admin calling it gets 403.

## E. Auth settings
- Authentication > URL Configuration: Site URL `https://tejaswase-glitch.github.io/edusphere/`; add the same under Redirect URLs.
- Email: decide whether "Confirm email" is on. If on, students must confirm email **and** be approved.
- SMTP: configure custom SMTP; the built-in sender is very limited (a few emails per hour), which blocks teacher invitations.

## F. Storage (created by 002)
- `study-materials` private, 50 MB per file, allowed: PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, PNG/JPG/WebP/GIF, TXT. Teachers write only to their own `<user id>/` folder; admin anywhere; students read only published files via 90-second signed links.
- `lecture-thumbnails` **public** (thumbnails appear on the homepage), 2 MB, PNG/JPG/WebP.
