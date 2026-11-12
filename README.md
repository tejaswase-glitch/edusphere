# EduSphere — client-ready MVP foundation

This project preserves the supplied EduSphere homepage design and adds a Supabase-backed portal foundation.

## Included
- Original homepage look and responsive layout.
- Supabase email/password authentication.
- Student self-registration with `pending` approval status.
- Admin approval/rejection of student accounts.
- Admin/teacher course creation.
- Teacher/admin upload of private PDF/document learning materials.
- Student access to published materials using short-lived signed URLs.
- Teacher/admin scheduling of Google Meet or Zoom links.
- Approved students can view upcoming classes and open the meeting link.
- Supabase RLS policies and private Storage bucket.

## Before testing
1. Create a Supabase project.
2. In Supabase SQL Editor, run all of `supabase-schema.sql`.
3. In Supabase Project Settings → API, copy the Project URL and anon/publishable key.
4. Paste those two public values into `config.js`. Never paste the `service_role` key into browser code.
5. In Supabase Authentication → URL Configuration, set the Site URL to your eventual Cloudflare Pages URL and add local/test URLs to Redirect URLs.
6. Turn off public signups only if the client wants invite-only onboarding. For the included student self-registration flow, keep signups enabled and require email confirmation according to the client's policy.
7. Create the first admin account through the website's student registration flow (or Supabase Auth). Confirm the email if confirmation is enabled. In Supabase → Authentication → Users, copy that user's UUID. Run the final commented SQL statement in `supabase-schema.sql`, replacing `AUTH-USER-UUID`, to set that account to `admin` and `approved`.
8. Create teacher accounts in Supabase Authentication → Users (invite/create user), then set their profile role and status from the SQL Editor:
   `update public.profiles set role='teacher', status='approved' where id='TEACHER-AUTH-UUID';`
9. Deploy the folder to Cloudflare Pages (Direct Upload or connect the GitHub repository). Use the project root as the build output; no build command is required.

## Local preview
Because browser modules and auth redirects work best over HTTP, run a local static server from this folder, for example:
`python -m http.server 8000`
Then open `http://localhost:8000`.

## Security notes
- The browser uses only the Supabase anon/publishable key. It is designed to be public.
- Never expose a Supabase `service_role` key, database password, or Cloudflare API token in HTML/JS.
- Admin and teacher roles are assigned manually by a trusted project owner in Supabase; public registration always creates a pending student.
- Supabase Auth must have email confirmation / SMTP configured appropriately for production. The default Supabase email service is rate-limited and is not a reliable client production mail service.
- Configure a custom SMTP provider before launch if reliable account emails/password resets are required.
- Use a custom domain and configure Supabase Auth Site URL / redirect allow-list before client handover.
- This is an MVP learning portal. It does not yet include native video hosting, payments, attendance, gradebook, messaging, or quiz authoring.

## Operational checklist before handover
- Test with separate admin, teacher, pending student, approved student and rejected student accounts.
- Verify pending/rejected students cannot access class links or files.
- Verify a student cannot upload files, create classes, approve accounts, or change their role.
- Verify a teacher cannot approve accounts or change user roles.
- Verify storage bucket remains private.
- Configure backups, custom SMTP, domain, privacy policy, terms, and client-owned billing/contact details.
