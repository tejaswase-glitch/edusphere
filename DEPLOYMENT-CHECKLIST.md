# EduSphere launch checklist

## Supabase setup
- [ ] Create the production Supabase project in the client's own account.
- [ ] Select a region appropriate for the client and its users.
- [ ] Run `supabase-schema.sql` in SQL Editor and confirm no errors.
- [ ] Configure Auth Site URL and redirect allow-list for localhost and production domain.
- [ ] Configure email confirmation and a production SMTP provider.
- [ ] Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`.
- [ ] Create first admin Auth user and promote its profile using the documented SQL statement.
- [ ] Invite teacher accounts and assign teacher role using the documented SQL statement.

## Cloudflare Pages
- [ ] Push the project folder to a client-owned GitHub repository.
- [ ] Create a Cloudflare Pages project connected to that repository (or Direct Upload).
- [ ] Framework preset: None; build command: blank; output directory: `.` (project root).
- [ ] Add the client's custom domain and complete DNS setup.
- [ ] Confirm HTTPS and test the live domain.

## Acceptance tests
- [ ] Student signup inserts a `pending` student profile.
- [ ] Email confirmation flow works.
- [ ] Pending and rejected students cannot enter the portal.
- [ ] Admin can approve/reject students; teacher cannot.
- [ ] Admin and teacher can create courses and upload permitted file types.
- [ ] Students can access only published materials and approved classes.
- [ ] Storage bucket is private; signed links expire.
- [ ] Student cannot create a course, upload a file, schedule a class, or change their role/status.
- [ ] Teacher cannot approve students or assign admin privileges.
- [ ] Mobile, tablet and desktop layouts are checked.
- [ ] Client receives admin handover, recovery contact, backup and operating instructions.

## Client decisions still required before production
- Legal entity/contact details for footer and privacy policy.
- Whether student self-registration remains open or changes to invitation-only.
- Approved file types, maximum file size, retention policy and who may publish materials.
- Course enrolment rules (current MVP exposes all active courses/materials to approved students).
- Whether teachers should see only their own classes/materials (current MVP allows approved teachers to manage shared teaching content).
