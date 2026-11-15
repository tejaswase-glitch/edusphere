# Admin manual
1. Homepage > **Admin Login** (the same Supabase admin account as before; its profile must be role `admin`, status `approved`).
2. **Dashboard**: counts and a queue of students waiting for approval.
3. **Students**: Pending / Approved / Rejected / Suspended groups, search. Approve, Reject, Suspend, Reactivate (rejecting or suspending asks for confirmation). A signed-in student whose status changes is signed out at the next status check (every 5 minutes or when they return to the tab).
4. **Teachers**: create by name + email (+ subject). The teacher receives an email to set a password. Details, Edit, Reset password, Suspend / Activate. There is no public teacher sign-up.
5. **Courses & Subjects**: create/edit/activate/delete courses; add/hide/delete subjects (they feed every dropdown).
6. **Study Materials / Recorded Lectures / Live Classes**: you see all items including drafts. You can delete any material or lecture (confirmation + audit entry). You can edit or cancel any class and schedule your own.
7. **Audit Log**: last 300 deletions, status changes and teacher actions: what, who, role, when.
Messages: every action shows a green (success) or red (error) message.
