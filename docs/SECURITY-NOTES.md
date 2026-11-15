# Security notes (what is enforced where)

| Rule | Enforced by |
|---|---|
| Only approved users read learning content | RLS `select` policies use `is_approved()` / `is_admin()` (migration 002) |
| Anonymous visitors read no tables | `revoke all ... from anon`; only the `public_lectures` view (no video id/links) |
| Students cannot change role/status | trigger `guard_profile_update` + column-level grants (001) |
| Only Admin changes status | `set_account_status()` RPC checks `is_admin()` and writes an audit row |
| Teacher edits/deletes only own materials, lectures, classes, courses | RLS update/delete policies `uploaded_by/created_by = auth.uid()`; admin = all |
| Ownership cannot be reassigned | trigger `guard_owner_immutable` |
| Storage: teacher writes/deletes only inside own `uid/` folder; admin any | `storage.objects` policies |
| Materials downloadable only if published + approved (or owner/admin) | storage select policy + 90-second signed URLs |
| Deletion audit | AFTER DELETE triggers -> `audit_log` (admin read only, nobody can insert directly) |
| Teachers created only by Admin | Edge Function checks the caller is an approved admin in the DB; service_role stays server side |
| Passwords | never stored by the site; Supabase Auth handles them |
| Cancelled classes keep history | no teacher delete policy on `live_classes`; cancel = status change |

Frontend checks (hidden buttons, disabled forms) are convenience only. A refused delete returns **0 rows**; the UI reports "not allowed".

## Test the backend directly (do this on your live project)
In the browser console on your site while signed in as Teacher B (use the site's own client is not exposed, so use the REST API with Teacher B's access token) try: `DELETE /rest/v1/materials?id=eq.<Teacher A's material id>` and expect an empty result `[]` with the row still present.
