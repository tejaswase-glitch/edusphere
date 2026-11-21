// Admin: dashboard, students, teachers, audit log.  Teacher: dashboard.
import { sb, state, $, esc, toast, fail, openModal, closeModal, confirmDialog, niceDate, relTime, firstName } from './core.js';
import { svg, empty, actions, loading } from './ui.js';

const count = async (table, build = q => q) => {
  const { count: n, error } = await build(sb.from(table).select('id', { count: 'exact', head: true }));
  if (error) throw error; return n ?? 0;
};
const stat = (ic, n, label) => `<div class="stat"><span class="ic">${svg(ic, 24)}</span><div><b>${n}</b><span>${esc(label)}</span></div></div>`;

export async function adminDashboard(el, { go }) {
  const now = new Date(Date.now() - 3600e3).toISOString();
  const [pending, approved, teachers, courses, mats, lecs, cls, pend] = await Promise.all([
    count('profiles', q => q.eq('role', 'student').eq('status', 'pending')),
    count('profiles', q => q.eq('role', 'student').eq('status', 'approved')),
    count('profiles', q => q.eq('role', 'teacher')),
    count('courses'), count('materials'), count('recorded_lectures'),
    count('live_classes', q => q.eq('status', 'scheduled').gte('starts_at', now)),
    sb.from('profiles').select('id,full_name,email,phone,course,academic_year,created_at').eq('role', 'student').eq('status', 'pending').order('created_at').limit(5),
  ]);
  if (pend.error) throw pend.error;
  el.innerHTML = `<section class="welcome"><div><h1>Hello, ${esc(firstName(state.profile.full_name))}! <span aria-hidden="true">👋</span></h1><p>Here is what is happening on EduSphere.</p></div><img src="assets/banner.svg" alt="" width="260" height="139"></section>
  <section class="stats" aria-label="Statistics">${stat('users', pending, 'Pending students')}${stat('check', approved, 'Approved students')}${stat('user', teachers, 'Teachers')}${stat('book', courses, 'Courses')}${stat('doc', mats, 'Study materials')}${stat('play', lecs, 'Recorded lectures')}${stat('live', cls, 'Upcoming classes')}</section>
  <div class="sec-head"><h2>Waiting for approval</h2><button class="link" type="button" data-act="students">View all students</button></div>
  <div class="list" id="pendBox">${pend.data.length ? pend.data.map(p => `<div class="row"><div class="main"><b>${esc(p.full_name || '(no name)')}</b><small>${esc([p.email, p.phone, p.course, p.academic_year].filter(Boolean).join(' · '))} · registered ${esc(relTime(p.created_at))}</small></div><div class="actions"><button class="btn btn-green btn-sm" data-act="set" data-id="${esc(p.id)}" data-to="approved" type="button">Approve</button><button class="btn btn-outline-danger btn-sm" data-act="set" data-id="${esc(p.id)}" data-to="rejected" type="button">Reject</button></div></div>`).join('') : empty('No students are waiting for approval.')}</div>`;
  actions(el, { students: () => go('students'), set: async ({ id, to }) => { if (await setStatus(id, to)) go('dashboard'); } });
}

export async function teacherDashboard(el, { go }) {
  const me = state.user.id, now = new Date(Date.now() - 3600e3).toISOString();
  const [lec, mat, crs, cls] = await Promise.all([
    count('recorded_lectures', q => q.eq('created_by', me)), count('materials', q => q.eq('uploaded_by', me)), count('courses', q => q.eq('created_by', me)),
    sb.from('live_classes').select('id,title,subject,starts_at,meeting_url,provider,meeting_room,status,rescheduled_at').eq('created_by', me).eq('status', 'scheduled').gte('starts_at', now).order('starts_at').limit(5),
  ]);
  if (cls.error) throw cls.error;
  el.innerHTML = `<section class="welcome"><div><h1>Hello, ${esc(firstName(state.profile.full_name))}! <span aria-hidden="true">👋</span></h1><p>Your teaching space${state.profile.subject ? ' · ' + esc(state.profile.subject) : ''}</p></div><img src="assets/banner.svg" alt="" width="260" height="139"></section>
  <section class="stats">${stat('play', lec, 'My lectures')}${stat('doc', mat, 'My materials')}${stat('book', crs, 'My courses')}${stat('live', cls.data.length, 'Upcoming classes')}</section>
  <div class="actions" style="margin-bottom:8px"><button class="btn btn-primary" data-act="go" data-to="lectures" type="button">Publish a lecture</button><button class="btn btn-soft" data-act="go" data-to="materials" type="button">Upload material</button><button class="btn btn-soft" data-act="go" data-to="classes" type="button">Schedule a class</button><button class="btn btn-soft" data-act="go" data-to="recorder" type="button">Record screen</button></div>
  <div class="sec-head"><h2>My upcoming classes</h2><button class="link" type="button" data-act="go" data-to="classes">Manage</button></div>
  <div class="list">${cls.data.length ? cls.data.map(c => `<div class="row"><div class="main"><b>${esc(c.title)}</b><small>${esc(c.subject || '')} · ${niceDate(c.starts_at)}${c.rescheduled_at ? ' · Rescheduled' : ''}</small></div>${(String(c.provider || '').toLowerCase().includes('jitsi') || String(c.meeting_url || '').toLowerCase().includes('meet.jit.si') || String(c.meeting_room || '').trim() !== '' || String(c.title || '').toLowerCase().includes('jitsi'))
      ? '<button class="btn btn-primary btn-sm" data-act="go" data-to="classes" type="button">Open Jitsi class</button>'
      : '<a class="btn btn-primary btn-sm" href="' + esc(c.meeting_url) + '" target="_blank" rel="noopener noreferrer">Start Google Meet</a>'}</div>`).join('') : empty('No upcoming classes. Schedule one from Live Classes.')}</div>`;
  actions(el, { go: ({ to }) => go(to) });
}

async function setStatus(id, to) {
  const { error } = await sb.rpc('set_account_status', { p_user_id: id, p_status: to });
  if (error) { fail(error); return false; }
  toast(`Account ${to}.`, 'good'); return true;
}

export async function studentsView(el) {
  let rows = [], q = '';
  el.innerHTML = `<h1>Students</h1><p class="page-sub">Approve, reject or suspend student accounts. Only approved students can open learning content.</p>
  <div class="chips"><input class="search" id="stuSearch" type="search" placeholder="Search name, email or phone" aria-label="Search students"></div><div id="stuBox"></div>`;
  async function load() {
    loading($('#stuBox', el));
    const { data, error } = await sb.from('profiles').select('id,full_name,email,phone,course,academic_year,student_id,status,created_at').eq('role', 'student').order('created_at', { ascending: false });
    if (error) { $('#stuBox', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    rows = data; draw();
  }
  function draw() {
    const m = r => !q || [r.full_name, r.email, r.phone, r.student_id].some(v => String(v || '').toLowerCase().includes(q));
    const btn = (id, to, text, cls) => `<button class="btn ${cls} btn-sm" data-act="set" data-id="${esc(id)}" data-to="${to}" type="button">${text}</button>`;
    $('#stuBox', el).innerHTML = ['pending', 'approved', 'rejected', 'suspended'].map(st => {
      const l = rows.filter(r => r.status === st && m(r));
      return `<div class="sec-head" style="margin:18px 0 8px"><h2 style="font-size:18px">${st[0].toUpperCase() + st.slice(1)} <span class="badge ${st === 'approved' ? 'ok' : st === 'pending' ? 'warn' : 'bad'}">${l.length}</span></h2></div>` +
        (l.length ? `<div class="list">${l.map(r => `<div class="row"><div class="main"><b>${esc(r.full_name || '(no name)')}</b><small>${esc([r.email, r.phone].filter(Boolean).join(' · '))}</small><small>${esc([r.course, r.academic_year, r.student_id && 'ID ' + r.student_id].filter(Boolean).join(' · ') || 'No academic details')} · registered ${esc(niceDate(r.created_at))}</small></div>
        <div class="actions">${st !== 'approved' ? btn(r.id, 'approved', st === 'suspended' ? 'Reactivate' : 'Approve', 'btn-green') : ''}${st === 'pending' ? btn(r.id, 'rejected', 'Reject', 'btn-outline-danger') : ''}${st === 'approved' ? btn(r.id, 'suspended', 'Suspend', 'btn-outline-danger') : ''}</div></div>`).join('')}</div>` : empty('None.'));
    }).join('');
  }
  await load();
  $('#stuSearch', el).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  actions(el, {
    set: async ({ id, to }) => {
      const r = rows.find(x => x.id === id);
      if (to !== 'approved' && !await confirmDialog({ title: `${to === 'rejected' ? 'Reject' : 'Suspend'} ${r.full_name || 'this student'}?`, text: to === 'rejected' ? 'They will not be able to sign in.' : 'They will be signed out at their next check and lose access to all learning content.', confirm: to === 'rejected' ? 'Reject' : 'Suspend' })) return;
      if (await setStatus(id, to)) await load();
    },
  });
}

async function adminFn(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body: { ...body, redirectTo: location.origin + location.pathname } });
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch { /* keep */ } throw new Error(/Failed to send|FunctionsFetch/i.test(m) ? 'Could not reach the admin-users Edge Function. Has it been deployed? See docs/SUPABASE-SETUP.md.' : m); }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function teachersView(el) {
  let rows = [];
  el.innerHTML = `<h1>Teachers</h1><p class="page-sub">Teacher accounts are created only here. The teacher receives an email to set their own password.</p>
  <div class="grid-form"><section class="card"><h3>Create teacher account</h3><form id="tForm" class="form" novalidate>
    <label>Full name<input name="full_name" required maxlength="100"></label><label>Email<input name="email" type="email" required autocomplete="off"></label>
    <label>Subject / department<input name="subject" maxlength="100"></label><label>Mobile number <small>(optional)</small><input name="phone" type="tel" maxlength="20"></label>
    <button class="btn btn-primary" type="submit">Create teacher</button>
    <p class="hint">Created by a secure Edge Function. No password is ever shown or stored by this website.</p></form></section>
  <section><div id="tBox"></div></section></div>`;
  async function load() {
    loading($('#tBox', el));
    const { data, error } = await sb.from('profiles').select('id,full_name,email,phone,subject,status,created_at').eq('role', 'teacher').order('full_name');
    if (error) { $('#tBox', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    rows = data;
    $('#tBox', el).innerHTML = rows.length ? `<div class="list">${rows.map(t => `<div class="row"><div class="main"><b>${esc(t.full_name)}</b><small>${esc([t.email, t.phone, t.subject].filter(Boolean).join(' · '))}</small></div><span class="badge ${t.status === 'approved' ? 'ok' : 'bad'}">${t.status === 'approved' ? 'Active' : esc(t.status)}</span>
      <div class="actions"><button class="btn btn-soft btn-sm" data-act="view" data-id="${esc(t.id)}" type="button">Details</button><button class="btn btn-soft btn-sm" data-act="edit" data-id="${esc(t.id)}" type="button">Edit</button><button class="btn btn-soft btn-sm" data-act="reset" data-id="${esc(t.id)}" type="button">Reset password</button>${t.status === 'approved' ? `<button class="btn btn-outline-danger btn-sm" data-act="tog" data-to="suspended" data-id="${esc(t.id)}" type="button">Suspend</button>` : `<button class="btn btn-green btn-sm" data-act="tog" data-to="approved" data-id="${esc(t.id)}" type="button">Activate</button>`}</div></div>`).join('')}</div>` : empty('No teachers yet. Create the first one.');
  }
  $('#tForm', el).addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)), btn = e.submitter;
    if (!f.full_name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return toast('Enter a name and a valid email.', 'bad');
    btn.disabled = true;
    try { const r = await adminFn({ action: 'create_teacher', full_name: f.full_name.trim(), email: f.email.trim(), subject: f.subject.trim(), phone: f.phone.trim() }); toast(r.note || 'Teacher created.', r.emailSent === false ? 'bad' : 'good'); e.target.reset(); await load(); }
    catch (err) { fail(err); } finally { btn.disabled = false; }
  });
  await load();
  actions(el, {
    view: ({ id }) => { const t = rows.find(x => x.id === id); openModal(`<h2 id="modalTitle">${esc(t.full_name)}</h2><dl style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:14px 0"><dt>Email</dt><dd style="margin:0">${esc(t.email || '-')}</dd><dt>Mobile</dt><dd style="margin:0">${esc(t.phone || '-')}</dd><dt>Subject</dt><dd style="margin:0">${esc(t.subject || '-')}</dd><dt>Status</dt><dd style="margin:0">${esc(t.status)}</dd><dt>Created</dt><dd style="margin:0">${esc(niceDate(t.created_at))}</dd></dl>`); },
    edit: ({ id }) => {
      const t = rows.find(x => x.id === id);
      openModal(`<h2 id="modalTitle">Edit teacher</h2><form id="tEdit" class="form" style="margin-top:14px" novalidate><label>Full name<input name="full_name" required maxlength="100" value="${esc(t.full_name)}"></label><label>Subject / department<input name="subject" maxlength="100" value="${esc(t.subject || '')}"></label><label>Mobile number<input name="phone" type="tel" maxlength="20" value="${esc(t.phone || '')}"></label><label>Email<input value="${esc(t.email || '')}" disabled></label><button class="btn btn-primary" type="submit">Save changes</button></form>`);
      $('#tEdit').addEventListener('submit', async e => {
        e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); if (!f.full_name.trim()) return toast('Name is required.', 'bad');
        try { await adminFn({ action: 'update_teacher', id: t.id, full_name: f.full_name.trim(), subject: f.subject.trim(), phone: f.phone.trim() }); closeModal(); toast('Teacher updated.', 'good'); await load(); } catch (err) { fail(err); }
      });
    },
    reset: async ({ id }) => { try { await adminFn({ action: 'reset_password', id }); toast('Password reset email sent.', 'good'); } catch (err) { fail(err); } },
    tog: async ({ id, to }) => {
      const t = rows.find(x => x.id === id);
      if (to === 'suspended' && !await confirmDialog({ title: `Suspend ${t.full_name}?`, text: 'They will lose access to the teacher portal. Their existing content stays.', confirm: 'Suspend' })) return;
      if (await setStatus(id, to)) await load();
    },
  });
}

const ACTION = { deleted: ['Deleted', 'bad'], status_approved: ['Approved', 'ok'], status_rejected: ['Rejected', 'bad'], status_suspended: ['Suspended', 'bad'], status_pending: ['Set pending', 'warn'], created: ['Created', 'ok'], updated: ['Updated', 'info'], password_reset_sent: ['Password reset sent', 'info'] };
const TYPE = { material: 'Study material', recorded_lecture: 'Recorded lecture', live_class: 'Live class', course: 'Course', student: 'Student', teacher: 'Teacher' };
export async function auditView(el) {
  el.innerHTML = '<h1>Audit Log</h1><p class="page-sub">Deletions, status changes and teacher account actions. Only Admins can read this. Newest 300 entries.</p><div id="aBox"></div>';
  loading($('#aBox', el));
  const { data, error } = await sb.from('audit_log').select('id,action,entity_type,entity_title,performer_name,performer_role,details,created_at').order('created_at', { ascending: false }).limit(300);
  if (error) { $('#aBox', el).innerHTML = `<div class="note warn">${esc(error.message)}. Run migration 002 if you have not.</div>`; return; }
  const extra = d => Object.entries(d || {}).filter(([k, v]) => v !== null && v !== '' && !['uploaded_by', 'created_by', 'file_path'].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ');
  $('#aBox', el).innerHTML = data.length ? `<div class="card table-wrap"><table><thead><tr><th>When</th><th>Action</th><th>Type</th><th>Item</th><th>Done by</th><th>Details</th></tr></thead><tbody>${data.map(r => { const [t, k] = ACTION[r.action] || [r.action, 'mute']; return `<tr><td>${esc(niceDate(r.created_at))}</td><td><span class="badge ${k}">${esc(t)}</span></td><td>${esc(TYPE[r.entity_type] || r.entity_type)}</td><td>${esc(r.entity_title || '')}</td><td>${esc(r.performer_name || '')}<br><small>${esc(r.performer_role || '')}</small></td><td><small>${esc(extra(r.details))}</small></td></tr>`; }).join('')}</tbody></table></div>` : empty('Nothing has been logged yet.');
}


export async function adminsView(el) {
  let rows = [];
  el.innerHTML = `<h1>Administrators</h1><p class="page-sub">Add another trusted administrator. They will receive an email to set their own password and will have full admin access.</p>
    <div class="grid-form"><section class="card"><h3>Add administrator</h3><form id="adminAddForm" class="form" novalidate>
      <label>Full name<input name="full_name" required maxlength="100" autocomplete="name"></label>
      <label>Email address<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
      <button class="btn btn-primary" type="submit">Add administrator</button>
      <p class="hint">A secure account is created. The new administrator sets their own password from the email link. Never share your own password.</p>
    </form></section><section><h3>Current administrators</h3><div id="adminList"></div></section></div>`;
  async function load() {
    loading($('#adminList', el));
    const { data, error } = await sb.from('profiles').select('id,full_name,email,status,created_at').eq('role','admin').order('created_at');
    if (error) { $('#adminList', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    rows = data || [];
    $('#adminList', el).innerHTML = rows.length ? `<div class="list">${rows.map(a => `<div class="row"><div class="main"><b>${esc(a.full_name || 'Administrator')}</b><small>${esc(a.email || '')} · ${esc(niceDate(a.created_at))}</small></div><span class="badge ${a.status === 'approved' ? 'ok' : 'bad'}">${a.status === 'approved' ? 'Active' : esc(a.status)}</span></div>`).join('')}</div>` : empty('No administrators found.');
  }
  $('#adminAddForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (!f.full_name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return toast('Enter a full name and valid email address.','bad');
    const btn = e.submitter; btn.disabled = true;
    try {
      const r = await adminFn({ action:'create_admin', full_name:f.full_name.trim(), email:f.email.trim(), redirectTo:location.origin + location.pathname });
      toast(r.note || 'Administrator created.', r.emailSent === false ? 'bad' : 'good'); e.currentTarget.reset(); await load();
    } catch (err) { fail(err); } finally { btn.disabled = false; }
  });
  await load();
}
