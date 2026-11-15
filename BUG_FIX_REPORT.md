# BUG_FIX_REPORT

**Read this first.** I could not connect to your live Supabase project or website (no network, no credentials), so nothing below was verified against your real database. "Tested" means: tested in headless Chromium against a **mock** backend (`tests/mock-supabase.js`), or checked by reading the files. SQL was reviewed by reading and **never executed**. Statuses follow your scale; a fix that is implemented but not proven live is **PARTIALLY FIXED**, not FIXED.

Sources inspected: `EduSphere_Client_Ready_MVP-2.zip` (v1, "orig1") and `EduSphere_Fully_Upgraded_Final.zip` (v2, "orig2", includes migration `001_upgrade.sql` and Edge Function). v2 was used as the base. `config.js` had a placeholder anon key; it still does (you must paste your public key).

---
## 1. New student registrations missing from the Admin list
- **Affected:** `supabase-schema.sql` `handle_new_user()` / trigger `on_auth_user_created`; `app.js` `signUp` metadata and Admin list query; live DB state.
- **Finding (honest):** in both uploaded ZIPs the signup metadata keys (`full_name, phone, student_id, course, academic_year`) **already match** the trigger. So a field-name mismatch is **not** provable from the files. The files do show risks that produce exactly your symptom: (a) the trigger/backfill only exists if the SQL was actually run on the live DB - v2's `001` contains a *backfill for signups that never got a profile*, which means such signups existed; (b) v1's Admin list showed only `pending` and no email, so rows were hard to identify; (c) `emailRedirectTo: location.origin` dropped the `/edusphere/` path.
- **Fix implemented:** signup metadata unchanged and verified to match; `001` trigger (adds `email`, never fails on conflict) + backfill kept; Admin **Students** page lists *all* students grouped Pending/Approved/Rejected/Suspended with email/phone/course and search; real errors are shown; redirect uses origin+path; pending signups are signed out immediately. New read-only `supabase/diagnostics/check_registration.sql` finds profile-less signups, missing trigger, and metadata keys on your live DB.
- **Tested:** mock backend - registration creates a pending profile with all five fields, appears on Admin dashboard and Students list. **Not tested live.**
- **Status: PARTIALLY FIXED** (code fixed and mock-tested; live root cause unconfirmed - run the diagnostics, then `001`).

## 2. Profile / trigger insertion problems
- **Affected:** `handle_new_user()`, `profiles`.
- **Root cause:** same as #1; additionally v1 profiles had no `email` column.
- **Fix:** `001` (kept, unmodified) + `002` guard that stops with a clear message if `001` has not been run.
- **Tested:** mock only. **Status: PARTIALLY FIXED / live NOT TESTED.**

## 3. Admin approval not updating correctly / function-name mismatch
- **Affected:** `set_student_status()` (v1, students only, no audit) vs `set_account_status()` (v2 `001`, students+teachers). v1 frontend called the former; v2 calls both.
- **Root cause:** two overlapping functions; neither wrote an audit record.
- **Fix:** frontend now calls only `set_account_status`; `002` redefines it (Admin-only check, restricts to student/teacher rows, writes `audit_log`). `set_student_status` is left in your DB untouched (not destructive); it is Admin-only and can be dropped later.
- **Tested:** mock - approve, reject, suspend, reactivate update status and audit. **Live NOT TESTED. Status: PARTIALLY FIXED.**

## 4. Admin login regression risk
- **Affected:** `js/auth.js`.
- **Fix/approach:** auth flow kept identical in kind (`signInWithPassword`, then read `profiles` role/status). No change to your auth users or admin profile. Admin portal now also verifies the chosen portal matches the real role.
- **Tested:** mock admin login + wrong-portal refusal. **Not tested with your real admin account. Status: NOT TESTED (live).**

## 5. Teacher account creation and authorization
- **Affected:** Edge Function `admin-users`; no frontend set-password page.
- **Root causes:** (a) teachers were invited by email but the site had **no screen to set a password** from the email link, so they could not complete setup; (b) function accepted any `redirectTo`; (c) no rollback if profile insert failed; (d) no audit.
- **Fix:** function re-verifies the caller is an *approved admin in the database*, validates input, optional `ALLOWED_REDIRECT_ORIGINS`, rolls back the auth user if the profile insert fails, writes audit; site handles `PASSWORD_RECOVERY` with a Set-new-password dialog. Teachers cannot self-register (no public path) and cannot change their role (trigger `guard_profile_update` from `001`).
- **Tested:** mock - create/edit/suspend/activate, recovery dialog sets password and signs out. **Function not deployed, not run. Status: PARTIALLY FIXED.**

## 6/7. Missing or incorrect deletion permissions
- **Affected:** v1 policies `materials_staff_delete`, `classes_staff_delete` = `is_staff()` (any teacher could delete anyone's material); `materials_storage_staff_delete/update/upload` = any staff for any file; v1/v2 UI had **no delete buttons**. v2 `001` fixed the *table* policies for materials and lectures but left the **Storage** policies staff-wide.
- **Fix:** `002` ownership-based Storage policies (own `uid/` folder or admin), `guard_owner_immutable` trigger, tightened read policies; UI delete with confirmation for materials and lectures, shown only to owner/admin; UI treats a 0-row result as "not allowed". Classes and courses are Admin-delete-only; teachers *cancel* classes.
- **Tested:** mock - owner delete, other teacher sees no button, direct delete of another teacher's row returns 0 rows (**mock RLS, not your database**), admin deletes any. **Status: PARTIALLY FIXED** (SQL not executed; live RLS NOT TESTED).

## 8. Missing deletion audit history
- **Fix:** `audit_log` (item id, type, title, uploader in `details`, deleter id/name/role, timestamp). AFTER DELETE triggers on materials, lectures, classes, courses; `write_audit()` execute revoked from all users; table has no insert/update/delete policy and privileges revoked, Admin read-only. Status changes and teacher actions also logged. Admin **Audit Log** page.
- **Tested:** mock - rows appear with deleter name. **Status: PARTIALLY FIXED** (live NOT TESTED).

## 9. Missing recorded lecture management
- **Affected:** v2 had the `recorded_lectures` table but no complete management UI/delete/thumbnail upload.
- **Fix:** dedicated Recorded Lectures page: add/edit/publish/unpublish/delete, YouTube link-or-ID parsing, subject, course, thumbnail upload (public `lecture-thumbnails` bucket), embedded player for students, privacy warning shown to staff.
- **Tested:** mock incl. invalid link refusal and playback iframe `src`. Real YouTube playback NOT TESTED. **Status: PARTIALLY FIXED.**

## 10. Public exposure of private / unlisted content
- **Inspected:** `public_lectures` view (`001`) already selects only id, title, subject, 160-char description, thumbnail, teacher name - **no video ID**. Meet links are only in `live_classes`.
- **Fix:** homepage reads only that view; `002` revokes all direct table privileges from `anon`; automated test confirms the public DOM contains neither the video ID nor a Meet URL. Known gap: thumbnails live in a public bucket by design.
- **Status: PARTIALLY FIXED** (mock-tested; confirm live by fetching `/rest/v1/materials` and `/rest/v1/live_classes` with only the anon key - expect `[]` or permission error).

## 11. Live class editing / rescheduling / cancellation
- **Affected:** v1 could only create and list classes (no status, no edit; Join button for everything). v2 added `status` but read policy let every staff user see all classes.
- **Fix:** Edit/reschedule, Mark completed, Cancel (confirmation; history kept; no delete for teachers). `002` adds `rescheduled_at`, `original_starts_at`, `cancelled_at`, a trigger that stamps them, blocks reopening a cancelled class for non-admins. Join shown only for `scheduled`. Meet URL validated (`https://meet.google.com/...`). Times shown in the viewer's local timezone via `toLocaleString`.
- **Tested:** mock - create, reschedule ("Rescheduled" + original time), cancel (no Join), student sees updates. **Limitation:** cancelled classes' link is still readable by approved students at DB level. **Status: PARTIALLY FIXED.**

## 12. Student dashboard empty / incorrect data
- **Root cause:** v1 overview was static text; no progress data existed.
- **Fix:** new `lecture_progress` table; dashboard shows real counts (lectures, completed, %, materials), Continue Learning, My Courses, next live class, recent activity. Empty states are honest.
- **Tested:** mock incl. mark-completed flow. **Status: PARTIALLY FIXED.**

## 13. Session restoration and logout
- **Inspected:** v1/v2 already restored sessions and re-checked status. 
- **Changes:** dashboard and homepage are now separate views toggled by one flag, so logout cannot leave duplicate login sections; sidebar/state cleared on logout; re-check on tab focus and every 5 minutes; denied (pending/rejected/suspended) users are signed out so no session persists; `storageKey` fixed.
- **Tested:** mock - restore after "browser restart" (saved storage state), suspended-while-signed-in is signed out, single homepage after logout. **Status: PARTIALLY FIXED** (real browser restart NOT TESTED).

## 14. Mobile responsiveness and recording limitations
- **Fix:** responsive shell (off-canvas sidebar, 2-column stats), checked for horizontal overflow on every page of all three roles at 390 and 768 px and the homepage at 360/390/768 in Chromium emulation. Recorder detects missing `getDisplayMedia` and shows the Android screen-recorder fallback and limitation notes.
- **Not tested:** real Android/Samsung devices; real screen capture (API stubbed). **Status: PARTIALLY FIXED.**

## 15. Other defects found in the uploaded project
| Problem | Fix | Status |
|---|---|---|
| Any authenticated user (incl. pending) could read active courses; teachers could read other teachers' drafts of materials and classes | tightened read policies in `002` | PARTIALLY FIXED (live NOT TESTED) |
| Anyone with the anon key had default table grants | `revoke ... from anon` in `002` | PARTIALLY FIXED |
| Ownership columns (`uploaded_by`, `created_by`) editable | immutable trigger | PARTIALLY FIXED |
| Courses editable by any teacher | owner-or-admin policy | PARTIALLY FIXED |
| Study-material types: legacy DOC/PPT/XLS not allowed by bucket | added to bucket mime list; UI accepts them | PARTIALLY FIXED |
| No subjects management | `subjects` table + Admin UI | PARTIALLY FIXED |
| Certificates feature | **NOT FIXED**: no feature exists; homepage card says "Coming soon" | NOT FIXED |
| PWA absent | manifest, icons, service worker | PARTIALLY FIXED (installability on a real phone NOT TESTED) |
