// Authentication: login, student registration, password recovery, session restore + status re-check.
import { sb, configured, sdkError, state, $, $$, toast, fail } from './core.js';
import { mountPortal, unmountPortal } from './portal.js';

let selectedRole = 'student';
let revalTimer = null;
const REVALIDATE_MS = 5 * 60 * 1000;

const showMsg = (id, text, ok = false) => { const el = $(id); el.textContent = text; el.className = 'form-msg' + (ok ? ' ok' : ''); el.hidden = !text; };
const ready = () => {
  if (sb) return true;
  toast(sdkError ? 'Could not load the Supabase library. Check your internet connection.' : 'Add your Supabase anon key in config.js first.', 'bad');
  return false;
};

export function openLogin(role) {
  if (role) setRole(role);
  $('#registerDlg').close?.(); showMsg('#loginMsg', '');
  const d = $('#loginDlg'); if (!d.open) d.showModal();
  $('#loginForm [name=email]').focus();
}
export function openRegister() {
  $('#loginDlg').close?.(); showMsg('#regMsg', '');
  const d = $('#registerDlg'); if (!d.open) d.showModal();
}
function setRole(role) {
  selectedRole = role;
  $$('#roleTabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.role === role));
  $('#loginRegisterLine').hidden = role !== 'student';
  $('#loginSub').textContent = { admin: 'Admin portal: manage students, teachers and content.', teacher: 'Teacher portal: accounts are created by the Admin.', student: 'Student portal: available after the Admin approves your registration.' }[role];
}

async function fetchProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Your account profile was not found. Please contact the administrator.');
  return data;
}

const DENY = {
  pending: 'Your registration is waiting for Admin approval. Please check back later.',
  rejected: 'Your registration request was not approved. Please contact the administrator.',
  suspended: 'Your account is suspended. Please contact the administrator.',
};

// Returns true if the user was let in.
async function enter(user, { enforceRole = null, quiet = false } = {}) {
  let profile;
  try { profile = await fetchProfile(user.id); }
  catch (e) { await sb.auth.signOut(); if (!quiet) fail(e, 'Could not load your account.'); return false; }
  if (profile.status !== 'approved') {
    await sb.auth.signOut();
    toast(DENY[profile.status] || 'Your account is not active.', 'bad');
    return false;
  }
  if (enforceRole && profile.role !== enforceRole) {
    await sb.auth.signOut();
    toast(`This account is not a ${enforceRole} account. Choose the correct login.`, 'bad');
    return false;
  }
  state.user = user; state.profile = profile;
  $('#loginDlg').close?.(); $('#registerDlg').close?.(); $('#recoverDlg').close?.();
  mountPortal();
  startRevalidate();
  return true;
}

export function leave(message) {
  clearInterval(revalTimer); revalTimer = null;
  unmountPortal();
  state.user = null; state.profile = null;
  if (message) toast(message);
}

async function revalidate() {
  if (!state.profile || !sb) return;
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return leave('Your session has ended. Please sign in again.');
    const p = await fetchProfile(user.id);
    if (p.status !== 'approved' || p.role !== state.profile.role) {
      await sb.auth.signOut(); leave('Your account access has changed. Please sign in again.');
    } else state.profile = p;
  } catch (e) {
    // Network hiccups must not log people out; real denials are handled above.
    console.warn('Status re-check skipped:', e?.message);
  }
}
function startRevalidate() { clearInterval(revalTimer); revalTimer = setInterval(revalidate, REVALIDATE_MS); }

export async function logout() {
  try { await sb?.auth.signOut(); } catch { /* ignore */ }
  leave('Signed out successfully.');
}

export function initAuth() {
  $('#setupNotice').hidden = configured && !!sb;
  setRole('student');
  $$('#roleTabs button').forEach(b => b.addEventListener('click', () => setRole(b.dataset.role)));

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!ready()) return;
    const f = new FormData(e.currentTarget), btn = e.submitter; showMsg('#loginMsg', '');
    const email = String(f.get('email')).trim(), password = String(f.get('password'));
    if (!email || !password) return showMsg('#loginMsg', 'Enter your email and password.');
    btn.disabled = true;
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return showMsg('#loginMsg', /invalid login/i.test(error.message) ? 'Email or password is incorrect.' : /confirm/i.test(error.message) ? 'Please confirm your email first (check your inbox).' : error.message);
      const ok = await enter(data.user, { enforceRole: selectedRole });
      if (ok) { e.target.reset(); toast('You are successfully logged in!', 'good'); }
    } catch (err) { showMsg('#loginMsg', err.message || 'Sign-in failed.'); }
    finally { btn.disabled = false; }
  });

  $('#forgotBtn').addEventListener('click', async () => {
    if (!ready()) return;
    const email = String($('#loginForm [name=email]').value).trim();
    if (!email) return showMsg('#loginMsg', 'Type your email above, then press "Forgot password?" again.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    showMsg('#loginMsg', error ? error.message : 'If this email has an account, a reset link has been sent.', !error);
  });

  $('#registerForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!ready()) return;
    const form = e.currentTarget; showMsg('#regMsg', '');
    if (!form.reportValidity()) return;
    const f = new FormData(form), btn = e.submitter; btn.disabled = true;
    try {
      // Field names here MUST match the handle_new_user() trigger: full_name, phone, student_id, course, academic_year
      const { data, error } = await sb.auth.signUp({
        email: String(f.get('email')).trim(), password: String(f.get('password')),
        options: {
          emailRedirectTo: location.origin + location.pathname,
          data: { full_name: String(f.get('full_name')).trim(), phone: String(f.get('phone')).trim(), student_id: String(f.get('student_id')).trim(), course: String(f.get('course')), academic_year: String(f.get('academic_year')) },
        },
      });
      if (error) return showMsg('#regMsg', error.message);
      if (data.session) await sb.auth.signOut(); // pending accounts must not stay signed in
      form.reset(); $('#registerDlg').close();
      toast('Registration submitted. You can sign in after the Admin approves your account.', 'good');
    } catch (err) { showMsg('#regMsg', err.message || 'Registration failed.'); }
    finally { btn.disabled = false; }
  });

  $('#recoverForm').addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const p1 = String(f.get('password')), p2 = String(f.get('password2'));
    if (p1.length < 8) return showMsg('#recMsg', 'Use at least 8 characters.');
    if (p1 !== p2) return showMsg('#recMsg', 'The two passwords do not match.');
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return showMsg('#recMsg', error.message);
    e.target.reset(); $('#recoverDlg').close();
    await sb.auth.signOut(); // make the person sign in normally so role + status are checked
    toast('Password saved. Please sign in.', 'good'); openLogin();
  });

  if (!sb) return;
  sb.auth.onAuthStateChange(ev => {
    if (ev === 'PASSWORD_RECOVERY') { setTimeout(() => { $('#loginDlg').close?.(); $('#recoverDlg').showModal(); }, 0); }
    if (ev === 'SIGNED_OUT' && state.profile) leave();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revalidate(); });

  // Restore a saved session after the browser was closed and re-opened, then re-check status.
  (async () => {
    if (/type=recovery/.test(location.hash)) return; // handled by PASSWORD_RECOVERY
    const { data } = await sb.auth.getSession();
    if (data?.session) {
      const ok = await enter(data.session.user, { quiet: true });
      if (!ok) { /* message already shown */ }
    }
  })();
}
