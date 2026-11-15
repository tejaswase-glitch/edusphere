// MOCK Supabase used ONLY by tests/e2e.mjs. It emulates a small part of Auth, PostgREST+RLS, Storage and
// Edge Functions in the browser so the UI can be exercised without network access.
// IMPORTANT: this is NOT real Supabase. It does not prove that your real RLS policies work.
const KEY = 'mockdb', SKEY = 'edusphere-auth';
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const seed = () => {
  const U = (id, email, password) => ({ id, email, password });
  const users = [U('u-admin', 'admin@test.dev', 'Admin#1234'), U('u-t1', 'teacher1@test.dev', 'Teach#1234'), U('u-t2', 'teacher2@test.dev', 'Teach#1234'),
    U('u-s1', 'student1@test.dev', 'Stud#12345'), U('u-s2', 'pending@test.dev', 'Stud#12345'), U('u-s3', 'rejected@test.dev', 'Stud#12345'), U('u-s4', 'suspended@test.dev', 'Stud#12345')];
  const P = (id, name, role, status, extra = {}) => ({ id, full_name: name, email: users.find(u => u.id === id).email, phone: '9999999999', role, status, student_id: null, course: null, academic_year: null, subject: null, created_at: now(), ...extra });
  return {
    users,
    profiles: [P('u-admin', 'Asha Admin', 'admin', 'approved'), P('u-t1', 'Tina Teacher', 'teacher', 'approved', { subject: 'Biology' }), P('u-t2', 'Tom Teacher', 'teacher', 'approved', { subject: 'Physics' }),
      P('u-s1', 'Rahul Kumar', 'student', 'approved', { course: 'GNM', academic_year: 'First Year' }), P('u-s2', 'Pia Pending', 'student', 'pending'), P('u-s3', 'Ravi Rejected', 'student', 'rejected'), P('u-s4', 'Sana Suspended', 'student', 'suspended')],
    subjects: ['Biology', 'Mathematics', 'Physics', 'Chemistry'].map(n => ({ id: uuid(), name: n, description: '', is_active: true })),
    courses: [], materials: [], recorded_lectures: [], live_classes: [], lecture_progress: [], audit_log: [], storage: {}, mail: [],
  };
};
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
const save = db => localStorage.setItem(KEY, JSON.stringify(db));
if (!localStorage.getItem(KEY)) save(seed());
const sess = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } };
const listeners = new Set();
const emit = (ev, s) => listeners.forEach(f => { try { f(ev, s); } catch (e) { console.error(e); } });

const ctxOf = db => {
  const s = sess(); const uid = s?.user?.id || null; const me = db.profiles.find(p => p.id === uid) || null;
  const approved = !!me && me.status === 'approved';
  return { uid, me, approved, admin: approved && me.role === 'admin', staff: approved && ['admin', 'teacher'].includes(me.role) };
};
const OWNER = { materials: 'uploaded_by', recorded_lectures: 'created_by', live_classes: 'created_by', courses: 'created_by' };
const rls = {
  profiles: { sel: (r, c) => r.id === c.uid || c.admin, upd: (r, c) => r.id === c.uid || c.admin },
  subjects: { sel: (r, c) => (r.is_active && c.approved) || c.admin, ins: (r, c) => c.admin, upd: (r, c) => c.admin, del: (r, c) => c.admin },
  courses: { sel: (r, c) => (r.is_active && c.approved) || c.admin || (c.staff && r.created_by === c.uid), ins: (r, c) => c.staff && r.created_by === c.uid, upd: (r, c) => c.admin || (c.staff && r.created_by === c.uid), del: (r, c) => c.admin },
  materials: { sel: (r, c) => (r.is_published && c.approved) || c.admin || (c.staff && r.uploaded_by === c.uid), ins: (r, c) => c.staff && r.uploaded_by === c.uid, upd: (r, c) => c.admin || (c.staff && r.uploaded_by === c.uid), del: (r, c) => c.admin || (c.staff && r.uploaded_by === c.uid) },
  recorded_lectures: { sel: (r, c) => (r.is_published && c.approved) || c.admin || (c.staff && r.created_by === c.uid), ins: (r, c) => c.staff && r.created_by === c.uid, upd: (r, c) => c.admin || (c.staff && r.created_by === c.uid), del: (r, c) => c.admin || (c.staff && r.created_by === c.uid) },
  live_classes: { sel: (r, c) => (r.is_published && c.approved) || c.admin || (c.staff && r.created_by === c.uid), ins: (r, c) => c.staff && r.created_by === c.uid, upd: (r, c) => c.admin || (c.staff && r.created_by === c.uid), del: (r, c) => c.admin },
  lecture_progress: { sel: (r, c) => r.user_id === c.uid, ins: (r, c) => r.user_id === c.uid && c.approved, upd: (r, c) => r.user_id === c.uid && c.approved },
  audit_log: { sel: (r, c) => c.admin },
};
const audit = (db, c, action, type, row, details = {}) => db.audit_log.push({ id: db.audit_log.length + 1, action, entity_type: type, entity_id: row.id, entity_title: row.title || row.full_name, performed_by: c.uid, performer_name: c.me?.full_name || 'system', performer_role: c.me?.role || 'system', details, created_at: now() });

class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.fl = []; this.ord = null; this.lim = null; this.ret = false; this.one = null; this.opts = {}; }
  select(cols, opts) { if (this.op === 'select') { this.cols = cols; this.opts = opts || {}; } else this.ret = true; return this; }
  insert(r) { this.op = 'insert'; this.row = r; return this; } update(r) { this.op = 'update'; this.row = r; return this; }
  delete() { this.op = 'delete'; return this; } upsert(r, o) { this.op = 'upsert'; this.row = r; this.conf = o?.onConflict; return this; }
  eq(c, v) { this.fl.push(r => r[c] === v); return this; } gte(c, v) { this.fl.push(r => r[c] >= v); return this; }
  order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; } limit(n) { this.lim = n; return this; }
  single() { this.one = 'single'; return this; } maybeSingle() { this.one = 'maybe'; return this; }
  then(a, b) { return Promise.resolve().then(() => this.run()).then(a, b); }
  run() {
    const db = load(), c = ctxOf(db), t = this.t;
    const err = m => ({ data: null, error: { message: m } });
    if (t === 'public_lectures') {
      const rows = db.recorded_lectures.filter(r => r.is_published).map(r => ({ id: r.id, title: r.title, subject: r.subject, description: (r.description || '').slice(0, 160), thumbnail_url: r.thumbnail_url, teacher_name: r.teacher_name }));
      return { data: rows.slice(0, this.lim || 99), error: null };
    }
    const pol = rls[t]; if (!pol) return err('relation "' + t + '" does not exist');
    const tbl = db[t];
    if (!c.uid) return { data: [], error: null }; // anon: no table access
    const visible = () => tbl.filter(r => pol.sel(r, c)).filter(r => this.fl.every(f => f(r)));
    const finish = rows => {
      let out = rows.map(r => ({ ...r }));
      if (this.ord) { const [k, asc] = this.ord; out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.lim) out = out.slice(0, this.lim);
      out.forEach(r => { if (/courses\(/.test(this.cols || '')) { const cr = db.courses.find(x => x.id === r.course_id); r.courses = cr ? { title: cr.title } : null; } });
      if (this.opts.count) return { data: this.opts.head ? null : out, count: rows.length, error: null };
      if (this.one) { if (out.length === 1) return { data: out[0], error: null }; if (this.one === 'maybe' && !out.length) return { data: null, error: null }; return err('JSON object requested, multiple (or no) rows returned'); }
      return { data: out, error: null };
    };
    if (this.op === 'select') return finish(visible());
    if (this.op === 'insert' || this.op === 'upsert') {
      const rowsIn = [].concat(this.row), made = [];
      for (const r0 of rowsIn) {
        const r = { id: uuid(), created_at: now(), ...r0 };
        if (this.op === 'upsert') { const key = (this.conf || 'id').split(','); const ex = tbl.find(x => key.every(k => x[k] === r[k])); if (ex) { if (!pol.upd(ex, c)) return err('new row violates row-level security policy'); Object.assign(ex, r0); made.push(ex); continue; } }
        if (!pol.ins || !pol.ins(r, c)) return err('new row violates row-level security policy for table "' + t + '"');
        if (t === 'live_classes') { r.status = r.status || 'scheduled'; r.is_published ??= true; }
        tbl.push(r); made.push(r);
      }
      save(db); return this.ret || this.one ? finish(made) : { data: null, error: null };
    }
    const target = visible().filter(r => (this.op === 'update' ? pol.upd : pol.del)?.(r, c)); // RLS: non-matching rows are silently skipped
    if (this.op === 'update') {
      for (const r of target) {
        const n = { ...r, ...this.row };
        if (t === 'profiles' && !c.admin && (n.role !== r.role || n.status !== r.status)) return err('Not allowed to change role or status');
        if (OWNER[t] && n[OWNER[t]] !== r[OWNER[t]]) return err('Ownership cannot be changed');
        if (t === 'live_classes') {
          if (n.starts_at !== r.starts_at) { n.rescheduled_at = now(); n.original_starts_at = r.original_starts_at || r.starts_at; }
          if (n.status === 'cancelled' && r.status !== 'cancelled') n.cancelled_at = now();
          if (r.status === 'cancelled' && n.status !== 'cancelled' && !c.admin) return err('A cancelled class cannot be reopened. Create a new class instead.');
        }
        Object.assign(r, n);
      }
      save(db); return this.ret || this.one ? finish(target) : { data: null, error: null };
    }
    if (this.op === 'delete') {
      for (const r of target) {
        tbl.splice(tbl.indexOf(r), 1);
        const ty = { materials: 'material', recorded_lectures: 'recorded_lecture', live_classes: 'live_class', courses: 'course' }[t];
        if (ty) audit(db, c, 'deleted', ty, r, { subject: r.subject, uploaded_by: r.uploaded_by || r.created_by });
        if (t === 'recorded_lectures') db.lecture_progress = db.lecture_progress.filter(p => p.lecture_id !== r.id);
      }
      save(db); return this.ret || this.one ? finish(target) : { data: null, error: null };
    }
  }
}
const folder = p => p.split('/')[0];
const client = {
  from: t => new Q(t),
  rpc: async (fn, a) => {
    const db = load(), c = ctxOf(db);
    if (fn !== 'set_account_status') return { data: null, error: { message: 'function ' + fn + ' not found' } };
    if (!c.admin) return { data: null, error: { message: 'Only an approved admin can change account status' } };
    const p = db.profiles.find(x => x.id === a.p_user_id && ['student', 'teacher'].includes(x.role));
    if (!p) return { data: null, error: { message: 'Account not found' } };
    const from = p.status; p.status = a.p_status; audit(db, c, 'status_' + a.p_status, p.role, p, { from, to: a.p_status }); save(db); return { data: null, error: null };
  },
  auth: {
    async signInWithPassword({ email, password }) {
      const db = load(), u = db.users.find(x => x.email === email && x.password === password);
      if (!u) return { data: null, error: { message: 'Invalid login credentials' } };
      const s = { user: { id: u.id, email: u.email } }; localStorage.setItem(SKEY, JSON.stringify(s)); emit('SIGNED_IN', s); return { data: { user: s.user, session: s }, error: null };
    },
    async signUp({ email, password, options }) {
      const db = load(); if (db.users.some(u => u.email === email)) return { data: null, error: { message: 'User already registered' } };
      const id = uuid(), m = options?.data || {};
      db.users.push({ id, email, password });
      // handle_new_user() trigger emulation: reads EXACTLY these metadata names
      db.profiles.push({ id, email, full_name: m.full_name || '', phone: m.phone || '', student_id: m.student_id || null, course: m.course || null, academic_year: m.academic_year || null, role: 'student', status: 'pending', created_at: now() });
      save(db); return { data: { user: { id, email }, session: null }, error: null };
    },
    async signOut() { localStorage.removeItem(SKEY); emit('SIGNED_OUT', null); return { error: null }; },
    async getSession() { const s = sess(); return { data: { session: s }, error: null }; },
    async getUser() { const s = sess(); return { data: { user: s?.user || null }, error: null }; },
    onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    async updateUser({ password }) { const s = sess(); if (!s) return { data: null, error: { message: 'Not signed in' } }; const db = load(); db.users.find(u => u.id === s.user.id).password = password; save(db); return { data: {}, error: null }; },
    async resetPasswordForEmail(email) { const db = load(); db.mail.push({ to: email, type: 'recovery' }); save(db); return { data: {}, error: null }; },
  },
  storage: {
    from: bucket => ({
      async upload(path, file) { const db = load(), c = ctxOf(db); if (!(c.staff && folder(path) === c.uid)) return { data: null, error: { message: 'new row violates row-level security policy' } }; db.storage[bucket + '/' + path] = file.size; save(db); return { data: { path }, error: null }; },
      async remove(paths) { const db = load(), c = ctxOf(db), done = []; for (const p of paths) if (db.storage[bucket + '/' + p] !== undefined && (c.admin || (c.staff && folder(p) === c.uid))) { delete db.storage[bucket + '/' + p]; done.push({ name: p }); } save(db); return { data: done, error: null }; },
      async createSignedUrl(path) { const db = load(), c = ctxOf(db); const m = db.materials.find(x => x.file_path === path); if (!(c.admin || (c.staff && folder(path) === c.uid) || (m && m.is_published && c.approved))) return { data: null, error: { message: 'Object not found' } }; return { data: { signedUrl: 'data:text/plain,signed-file' }, error: null }; },
      getPublicUrl: path => ({ data: { publicUrl: 'https://mock.supabase.co/storage/v1/object/public/' + bucket + '/' + path } }),
    }),
  },
  functions: {
    async invoke(name, { body }) {
      const db = load(), c = ctxOf(db); const resp = (m, s) => ({ json: async () => ({ error: m }), status: s });
      if (!c.admin) return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: resp('Admin only', 403) } };
      if (body.action === 'create_teacher') {
        if (db.users.some(u => u.email === body.email.toLowerCase())) return { data: { error: 'A user with this email address has already been registered' }, error: null };
        const id = uuid(); db.users.push({ id, email: body.email.toLowerCase(), password: crypto.randomUUID() });
        db.profiles.push({ id, email: body.email.toLowerCase(), full_name: body.full_name, phone: body.phone || '', subject: body.subject || '', role: 'teacher', status: 'approved', created_at: now() });
        db.mail.push({ to: body.email.toLowerCase(), type: 'recovery' }); audit(db, c, 'created', 'teacher', { id, title: body.full_name }); save(db);
        return { data: { ok: true, id, emailSent: true, note: 'Teacher created; a password-setup email was sent.' }, error: null };
      }
      if (body.action === 'update_teacher') { const p = db.profiles.find(x => x.id === body.id && x.role === 'teacher'); Object.assign(p, { full_name: body.full_name, subject: body.subject, phone: body.phone }); save(db); return { data: { ok: true }, error: null }; }
      if (body.action === 'reset_password') { db.mail.push({ type: 'recovery', id: body.id }); save(db); return { data: { ok: true }, error: null }; }
      return { data: { error: 'Unknown action' }, error: null };
    },
  },
  __helpers: { emitRecovery() { emit('PASSWORD_RECOVERY', null); } },
};
export const createClient = () => { window.__mock = client; return client; };
