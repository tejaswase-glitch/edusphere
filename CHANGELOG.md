# Changelog

## 3.0.0 - complete platform (this release)
**Added**
- New homepage and student dashboard (navy sidebar, gradient banner, real stats) following the approved screenshots; new Admin and Teacher dashboards with the same shell.
- Admin: statistics, Students (approve/reject/suspend/reactivate + search), Teachers (create via Edge Function, details, edit, reset password, suspend/activate), Courses & Subjects, all content, Audit Log.
- Teacher: own courses, materials, YouTube-Unlisted lectures (thumbnail upload), Google Meet classes (edit/reschedule/cancel with history), screen + microphone recorder.
- Ownership-based delete (teacher = own, admin = any) with confirmation, enforced by RLS + Storage policies, plus `audit_log`.
- Student progress table (`lecture_progress`) powering Continue Learning, Completed, Progress and Recent Activity.
- Password-setup / reset dialog (teacher invitations could not set a password before).
- PWA: manifest, icons, service worker (installable on Android).
- Migration `002_complete_platform.sql`; hardened Edge Function `admin-users`.
- Tests: `tests/static-check.mjs`, `tests/e2e.mjs` (mock backend).
**Changed**
- Single-file `app.js` replaced by ES modules in `js/`. Tabs replaced by sidebar navigation.
- Sign-up redirect now uses origin + path (works under `/edusphere/`).
- Pending accounts are signed out immediately after sign-up.
- Storage, materials, classes, courses and subjects policies tightened (see `BUG_FIX_REPORT.md`).
- Meet links must be `https://meet.google.com/...` (client-side).
**Removed**
- Nothing deleted from your database. Old files are kept in `backup/`.

## 2.0 (previous upgrade) / 1.0 (client-ready MVP)
See `backup/`.
- Added: supabase/diagnostics/check_registration.sql (read-only checks), BUG_FIX_REPORT.md, TESTING_REPORT.md.
