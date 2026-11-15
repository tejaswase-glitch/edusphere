# TESTING_REPORT

**Environment:** no network and no access to your Supabase project or live site. Backend replaced by an in-browser **mock** (`tests/mock-supabase.js`) emulating Auth, tables with simplified RLS, Storage and the Edge Function. Browser: headless Chromium (Playwright). Run: `node tests/static-check.mjs` and `node tests/e2e.mjs` (raw: `tests/e2e-results.txt`, screenshots in `tests/screenshots/`).
**Result of the automated run: static checks 7/7 passed; end-to-end 35/35 passed - against the mock.** The mock proves the website code and UI logic. It does **not** prove your real Supabase RLS, triggers, Storage policies or Edge Function. Anything touching those is at best PARTIAL below.

Status key: PASS = tested successfully; FAIL = tested and failed; NOT TESTED = needs your credentials/device/manual action; PARTIAL = part works/tested, limits remain.

| # | Item | Status | Detail |
|---|---|---|---|
| 1 | Existing Admin login | PARTIAL | Mock admin login + wrong-portal refusal PASS. Your real admin account NOT TESTED. |
| 2 | Student registration | PARTIAL | Form, validation, no leftover session PASS (mock). Real Auth/email confirmation NOT TESTED. |
| 3 | New profile creation | PARTIAL | Mock trigger emulation creates pending/student profile with all 5 fields. Real `handle_new_user()` NOT TESTED. |
| 4 | Pending student appears in Admin list | PARTIAL | PASS on Admin dashboard queue and Students page (mock). Live NOT TESTED. |
| 5 | Admin approval | PARTIAL | approve, reject, suspend, reactivate PASS (mock) incl. confirmation. Real RPC NOT TESTED. |
| 6 | Rejected / suspended / pending restrictions | PARTIAL | All three denied at login, no session kept (mock); suspended-while-signed-in is signed out on re-check. Real RLS NOT TESTED. |
| 7 | Approved student login | PASS (mock) / live NOT TESTED | |
| 8 | Session restoration | PARTIAL | Restored from saved storage state in a new browser context. Real browser restart NOT TESTED. |
| 9 | Logout | PASS (mock) | Homepage visible, dashboard hidden, one login group, sidebar cleared, no open dialog. |
| 10 | Teacher creation by Admin | PARTIAL | UI flow, edit, suspend, activate PASS against mock function. **Edge Function never deployed or run.** NOT TESTED live. |
| 11 | Teacher login | PASS (mock) | Teacher sidebar excludes admin pages. |
| 12 | Teacher authorization boundaries | PARTIAL | UI hides admin pages and others' delete buttons (PASS). Real RLS NOT TESTED. |
| 13 | Study material upload and download | PARTIAL | Upload, type check, storage row+file (mock) PASS; "Open" requests a signed URL (mock). Real Storage upload/download and 50 MB behaviour NOT TESTED. |
| 14 | Teacher deletes own content | PASS (mock) | Confirmation (cancel keeps item), row and file removed, audit row. Live NOT TESTED. |
| 15 | Teacher blocked from deleting another teacher's content | PARTIAL | UI button absent (PASS). Direct API delete returned 0 rows - **against the mock's RLS emulation only**. Real policies NOT TESTED; test steps in `docs/SECURITY-NOTES.md`. |
| 16 | Admin deletes any content | PASS (mock) / live NOT TESTED | |
| 17 | Audit history | PARTIAL | Shows deleter, item, time (mock). Real triggers NOT TESTED; "audit rows cannot be edited" is enforced only in SQL (NOT TESTED). |
| 18 | Recorded lecture creation and playback | PARTIAL | Create/validate/publish and embed `src` = youtube-nocookie + ID PASS. Real YouTube playback NOT TESTED. |
| 19 | Private content not exposed publicly | PARTIAL | Public DOM has no video ID, Meet URL or embed (PASS, mock data). Live anon API check NOT TESTED. |
| 20 | Live class creation | PASS (mock); non-Meet URL refused | Live NOT TESTED. |
| 21 | Live class editing and rescheduling | PASS (mock) | "Rescheduled" badge, student sees it. |
| 22 | Live class cancellation | PASS (mock) | Join hidden for student, record kept. |
| 23 | Recording on desktop | PARTIAL | Consent gate, no camera request, timer, status, stop, WebM download, hand-off to Recorded Lectures PASS **with stubbed capture APIs**. Real picker, audio quality NOT TESTED. |
| 24 | Recording limitations / Android fallback | NOT TESTED | Fallback message exists in code; not run on an Android device. |
| 25 | Mobile layout | PARTIAL | No horizontal overflow on every page of all roles at 390 and 768; homepage at 360/390/768; sidebar opens/closes. Chromium emulation only; real Samsung/Android NOT TESTED. |
| 26 | Password-setup dialog | PASS (mock) | Mismatch refused, saves, signs out. Real email link NOT TESTED. |
| 27 | PWA | PARTIAL | Manifest valid, icons load, service worker activates on localhost. Install prompt on Android NOT TESTED. |
| 28 | Static checks | PASS | 16 index references, CSS urls, 37 JS imports, manifest, SW precache, every `data-act` has a handler, no secret-like strings. |

## What you must test on your live project (nothing here was run against it)
1. Run the diagnostics SQL, migrations `001` then `002`, deploy `admin-users`, paste the anon key.
2. Admin login with your real admin account.
3. Register a student -> appears Pending -> approve -> student logs in; reject/suspend a second test student.
4. Anon check (no login): `GET {SUPABASE_URL}/rest/v1/materials`, `/live_classes`, `/recorded_lectures`, `/profiles` with only the anon key -> must be `[]` or an error; `/public_lectures` may return rows without any `video_id`.
5. Two teachers: B must not be able to delete or overwrite A's material/lecture/file (UI and REST).
6. Upload a PDF, then download as a student; confirm an unpublished file is not downloadable.
7. Teacher create + invitation email + set password.
8. Play a real Unlisted YouTube video in the embed; open a real Meet link.
9. Screen recording on desktop Chrome; Android Chrome fallback; install as PWA on Android.
