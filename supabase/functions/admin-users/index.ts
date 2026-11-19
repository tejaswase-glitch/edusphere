// EduSphere Edge Function: admin-users
// Deploy: supabase functions deploy admin-users
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// The service_role key lives ONLY here (server side) - never in the website files.
// Optional secret: ALLOWED_REDIRECT_ORIGINS="https://yourname.github.io" (comma separated)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const clean = (v: unknown, max = 120) => String(v ?? '').trim().slice(0, max);

function redirectOk(r: unknown): string | undefined {
  if (!r) return undefined;
  try {
    const u = new URL(String(r));
    const allowed = (Deno.env.get('ALLOWED_REDIRECT_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.length || !allowed.includes(u.origin)) return undefined;
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return undefined;
    return u.toString();
  } catch { return undefined; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) Who is calling? Verify the JWT with Supabase Auth.
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    // 2) Is the caller an approved admin? (checked in the database, not trusted from the browser)
    const admin = createClient(url, svc, { auth: { persistSession: false } });
    const { data: me } = await admin.from('profiles').select('role,status,full_name').eq('id', user.id).single();
    if (!me || me.role !== 'admin' || me.status !== 'approved') return json({ error: 'Admin only' }, 403);

    const audit = (action: string, id: string, title: string, details: Record<string, unknown> = {}) =>
      admin.from('audit_log').insert({
        action, entity_type: 'teacher', entity_id: id, entity_title: title,
        performed_by: user.id, performer_name: me.full_name || 'admin', performer_role: 'admin', details,
      });

    const b = await req.json();
    const redirectTo = redirectOk(b.redirectTo);

    if (b.action === 'create_teacher') {
      const email = clean(b.email, 200).toLowerCase();
      const full_name = clean(b.full_name, 100);
      if (!emailOk(email) || !full_name) return json({ error: 'Name and a valid email are required' }, 400);
      const pw = crypto.randomUUID() + crypto.randomUUID() + 'Aa1!'; // random, never shown or stored by us
      const { data, error } = await admin.auth.admin.createUser({
        email, password: pw, email_confirm: true, user_metadata: { full_name },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: e2 } = await admin.from('profiles').upsert({
        id: data.user.id, email, full_name, subject: clean(b.subject, 100), phone: clean(b.phone, 20),
        role: 'teacher', status: 'approved',
      });
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
      const { error: e3 } = await caller.auth.resetPasswordForEmail(email, { redirectTo });
      await audit('created', data.user.id, full_name, { email });
      return json({ ok: true, id: data.user.id, emailSent: !e3, note: e3 ? 'Teacher created, but the password email failed: ' + e3.message : 'Teacher created; a password-setup email was sent.' });
    }

    if (b.action === 'create_admin') {
      const email = clean(b.email, 200).toLowerCase();
      const full_name = clean(b.full_name, 100);
      if (!emailOk(email) || !full_name) return json({ error: 'Name and a valid email are required' }, 400);
      const pw = crypto.randomUUID() + crypto.randomUUID() + 'Aa1!';
      const { data, error } = await admin.auth.admin.createUser({
        email, password: pw, email_confirm: true, user_metadata: { full_name },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: profileError } = await admin.from('profiles').upsert({
        id: data.user.id, email, full_name, role: 'admin', status: 'approved',
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: profileError.message }, 400);
      }
      const { error: inviteError } = await caller.auth.resetPasswordForEmail(email, { redirectTo });
      await admin.from('audit_log').insert({
        action: 'created', entity_type: 'administrator', entity_id: data.user.id,
        entity_title: full_name, performed_by: user.id,
        performer_name: me.full_name || 'admin', performer_role: 'admin',
        details: { email, email_sent: !inviteError },
      });
      if (inviteError) {
        return json({ ok: true, id: data.user.id, emailSent: false, note: 'Administrator account created, but the password-setup email failed: ' + inviteError.message });
      }
      return json({ ok: true, id: data.user.id, emailSent: true, note: 'Administrator created. A password-setup email was sent.' });
    }

    if (b.action === 'update_teacher') {
      const full_name = clean(b.full_name, 100);
      if (!b.id || !full_name) return json({ error: 'Name is required' }, 400);
      const { error } = await admin.from('profiles')
        .update({ full_name, subject: clean(b.subject, 100), phone: clean(b.phone, 20) })
        .eq('id', b.id).eq('role', 'teacher');
      if (error) return json({ error: error.message }, 400);
      await audit('updated', b.id, full_name);
      return json({ ok: true });
    }

    if (b.action === 'reset_password') {
      const { data: t } = await admin.from('profiles').select('email,full_name').eq('id', b.id).eq('role', 'teacher').single();
      if (!t?.email) return json({ error: 'No email on file for this teacher' }, 400);
      const { error } = await caller.auth.resetPasswordForEmail(t.email, { redirectTo });
      if (error) return json({ error: error.message }, 400);
      await audit('password_reset_sent', b.id, t.full_name || '');
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
