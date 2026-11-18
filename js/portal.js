// Signed-in shell: sidebar, topbar and role based view routing.
import { state, $, $$, esc, initials, closeModal } from './core.js';
import { svg, errBox, loading } from './ui.js';
import { studentDashboard, profileView } from './student.js';
import { adminDashboard, teacherDashboard, studentsView, teachersView, auditView } from './admin.js?v=20261119-provider-fix3';
import { coursesView } from './courses.js';
import { lecturesView } from './lectures.js';
import { materialsView } from './materials.js';
import { classesView } from './classes.js?v=20261119-jitsi';
import { recorderView, stopRecording, isRecording } from './recorder.js';

const NAV = {
  student: [['dashboard', 'Dashboard', 'home'], ['courses', 'My Courses', 'book'], ['classes', 'Live Classes', 'live'], ['lectures', 'Recorded Lectures', 'play'], ['materials', 'Study Materials', 'doc'], ['profile', 'My Profile', 'user']],
  teacher: [['dashboard', 'Dashboard', 'home'], ['courses', 'My Courses', 'book'], ['materials', 'Study Materials', 'doc'], ['lectures', 'Recorded Lectures', 'play'], ['classes', 'Live Classes', 'live'], ['recorder', 'Record Screen', 'rec'], ['profile', 'My Profile', 'user']],
  admin: [['dashboard', 'Dashboard', 'home'], ['students', 'Students', 'users'], ['teachers', 'Teachers', 'user'], ['courses', 'Courses & Subjects', 'book'], ['materials', 'Study Materials', 'doc'], ['lectures', 'Recorded Lectures', 'play'], ['classes', 'Live Classes', 'live'], ['audit', 'Audit Log', 'list'], ['profile', 'My Profile', 'shield']],
};
const VIEWS = {
  dashboard: () => ({ student: studentDashboard, teacher: teacherDashboardLite, admin: adminDashboard })[state.profile.role],
  students: () => studentsView, teachers: () => teachersView, audit: () => auditView,
  courses: () => coursesView, lectures: () => lecturesView, materials: () => materialsView,
  classes: () => classesView, recorder: () => recorderView, profile: () => profileView,
};

// Teacher dashboard: real counts of their own content + shortcuts.
const teacherDashboardLite = (el, ctx) => teacherDashboard(el, ctx);

let token = 0, current = null;
const sidebar = () => $('#sidebar');

export function mountPortal() {
  const p = state.profile;
  document.body.dataset.view = 'app';
  $('#site').hidden = false; $('#app').hidden = false;
  $('#avatar').textContent = initials(p.full_name);
  $('#whoName').textContent = ' ' + (p.full_name || p.role);
  $('#sideNav').innerHTML = NAV[p.role].map(([id, label, ic]) => `<button type="button" data-nav="${id}">${svg(ic, 22)}<span>${esc(label)}</span></button>`).join('');
  go('dashboard');
  window.scrollTo(0, 0);
}

export function unmountPortal() {
  token++; if (isRecording()) stopRecording(true);
  closeModal(); $('#confirmDlg').open && $('#confirmDlg').close();
  closeSidebar();
  $('#view').innerHTML = ''; $('#sideNav').innerHTML = ''; $('#whoName').textContent = ''; $('#avatar').textContent = '';
  document.body.dataset.view = 'site'; $('#app').hidden = true;
  window.scrollTo(0, 0);
}

export async function go(id) {
  if (!state.profile) return;
  if (current === 'recorder' && id !== 'recorder' && isRecording() && !confirm('A recording is in progress. Leave this page and stop recording?')) return;
  if (current === 'recorder' && id !== 'recorder') stopRecording(true);
  current = id; const my = ++token;
  $$('#sideNav button').forEach(b => { if (b.dataset.nav === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  closeSidebar();
  const el = $('#view');
  // fresh node each time so old event listeners disappear
  const fresh = el.cloneNode(false); el.replaceWith(fresh);
  loading(fresh);
  try {
    const render = VIEWS[id]?.();
    if (!render) throw new Error('This page is not available for your role.');
    await render(fresh, { go });
    if (my !== token) return;
  } catch (e) {
    if (my === token) fresh.innerHTML = errBox(e);
  }
  fresh.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function openSidebar() { sidebar().classList.add('open'); $('#scrim').hidden = false; $('#hamb').setAttribute('aria-expanded', 'true'); }
export function closeSidebar() { sidebar().classList.remove('open'); $('#scrim').hidden = true; $('#hamb').setAttribute('aria-expanded', 'false'); }

export function initPortal() {
  $('#sideNav').addEventListener('click', e => { const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav); });
  $('#sideBrand').addEventListener('click', e => { e.preventDefault(); go('dashboard'); });
  $('#hamb').addEventListener('click', () => sidebar().classList.contains('open') ? closeSidebar() : openSidebar());
  $('#scrim').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
}
