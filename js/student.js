// Student dashboard (screenshot design) + shared profile page.
import { sb, state, $, esc, toast, fail, niceDate, relTime, firstName, subjectArt } from './core.js';
import { svg, empty, actions } from './ui.js';
import { playLecture, thumbFor } from './lectures.js';

export async function studentDashboard(el, { go }) {
  const me = state.user.id, nowIso = new Date(Date.now() - 3600e3).toISOString();
  const [lec, prog, courses, cls, mats] = await Promise.all([
    sb.from('recorded_lectures').select('id,title,subject,thumbnail_url,video_id,teacher_name,created_at').eq('is_published', true).order('created_at', { ascending: false }),
    sb.from('lecture_progress').select('lecture_id,last_watched_at,completed').eq('user_id', me).order('last_watched_at', { ascending: false }),
    sb.from('courses').select('id,title,subject,description').eq('is_active', true).order('title').limit(6),
    sb.from('live_classes').select('id,title,subject,starts_at,meeting_url,provider,meeting_room,status,rescheduled_at').eq('status', 'scheduled').gte('starts_at', nowIso).order('starts_at').limit(1),
    sb.from('materials').select('id', { count: 'exact', head: true }).eq('is_published', true),
  ]);
  for (const r of [lec, prog, courses, cls, mats]) if (r.error) throw r.error;
  const L = lec.data, byId = Object.fromEntries(L.map(l => [l.id, l]));
  const P = prog.data.filter(p => byId[p.lecture_id]);
  const done = P.filter(p => p.completed).length, pct = L.length ? Math.round(done / L.length * 100) : 0;
  const resume = P.find(p => !p.completed), cont = resume ? byId[resume.lecture_id] : L.find(l => !P.some(p => p.lecture_id === l.id));
  const next = cls.data[0];

  el.innerHTML = `
  <section class="welcome"><div><h1>Hello, ${esc(firstName(state.profile.full_name))}! <span aria-hidden="true">👋</span></h1><p>Keep learning and achieve your goals!</p></div><img src="assets/banner.svg" alt="" width="260" height="139"></section>
  <section class="stats" aria-label="Learning statistics">
    <div class="stat"><span class="ic">${svg('play', 24)}</span><div><b>${L.length}</b><span>Lectures</span></div></div>
    <div class="stat"><span class="ic">${svg('check', 24)}</span><div><b>${done}</b><span>Completed</span></div></div>
    <div class="stat"><span class="ic">${svg('trophy', 24)}</span><div><b>${pct}%</b><span>Progress</span></div></div>
    <div class="stat"><span class="ic">${svg('doc', 22)}</span><div><b>${mats.count ?? 0}</b><span>Study materials</span></div></div>
  </section>
  <div class="sec-head"><h2>Continue Learning</h2><button class="link" data-act="lectures" type="button">View All</button></div>
  ${cont ? `<article class="card continue"><img src="${esc(thumbFor(cont))}" alt="" loading="lazy" onerror="this.src='${subjectArt(cont.subject)}'"><div><h3>${esc(cont.subject || cont.title)}</h3><p>${esc(cont.title)}</p>${resume ? `<p>Last watched ${esc(relTime(resume.last_watched_at))}</p>` : '<p>Not started yet</p>'}<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Overall progress"><i style="width:${pct}%"></i></div><small class="hint">${pct}% of all lectures completed</small></div><button class="btn btn-primary" data-act="resume" data-id="${esc(cont.id)}" type="button">${resume ? 'Resume' : 'Start'}</button></article>` : empty('No lectures are published yet. New lectures will appear here.')}
  <div class="sec-head"><h2>My Courses</h2><button class="link" data-act="courses" type="button">View All</button></div>
  ${courses.data.length ? `<div class="course-grid">${courses.data.map(c => `<article class="course-card"><img src="${subjectArt(c.subject || c.title)}" alt="" loading="lazy"><div><h3>${esc(c.title)}</h3><p>${esc(c.subject || c.description || '')}</p></div></article>`).join('')}</div>` : empty('No courses have been added yet.')}
  <div class="grid-2" style="margin-top:22px">
    <section class="card"><div class="sec-head" style="margin-top:0"><h3 style="margin:0">Upcoming Live Class</h3><button class="link" data-act="classes" type="button">View All</button></div>
      ${next ? `<div class="mini"><span class="ic">${svg('live', 28)}</span><div><b>${esc(next.title)}</b><small>${esc(next.subject || '')}${next.subject ? ' · ' : ''}${niceDate(next.starts_at)}${next.rescheduled_at ? ' · Rescheduled' : ''}</small><div style="margin-top:8px"><button class="btn btn-primary btn-sm" data-act="classes" type="button">Open Live Class in EduSphere</button></div></div></div>` : empty('No upcoming live classes.')}</section>
    <section class="card"><h3>Recent Activity</h3>
      ${P.length ? `<ul class="activity">${P.slice(0, 4).map(p => `<li><span class="dot">${svg(p.completed ? 'check' : 'play', 18)}</span><div><b>${p.completed ? 'Completed' : 'Watched'}: ${esc(byId[p.lecture_id].title)}</b><small>${esc(relTime(p.last_watched_at))}</small></div></li>`).join('')}</ul>` : empty('Your activity will appear here after you watch a lecture.')}</section>
  </div>`;
  actions(el, {
    lectures: () => go('lectures'), courses: () => go('courses'), classes: () => go('classes'),
    resume: ({ id }) => playLecture(byId[id], { track: true, onClose: () => go('dashboard') }),
  });
}

export async function profileView(el) {
  const p = state.profile, student = p.role === 'student';
  el.innerHTML = `<h1>My Profile</h1><p class="page-sub">Your account details. Role and status can only be changed by the Admin.</p>
  <div class="grid-2">
   <section class="card"><h3>Details</h3><form id="pf" class="form" novalidate>
     <label>Full name<input name="full_name" required maxlength="100" value="${esc(p.full_name)}"></label>
     <label>Mobile number<input name="phone" type="tel" value="${esc(p.phone || '')}" maxlength="20"></label>
     ${student ? `<label>Student ID<input name="student_id" maxlength="40" value="${esc(p.student_id || '')}"></label>
     <label>Course<input name="course" maxlength="60" value="${esc(p.course || '')}"></label>
     <label>Year / semester<input name="academic_year" maxlength="40" value="${esc(p.academic_year || '')}"></label>` : ''}
     <label>Email<input value="${esc(p.email || state.user.email || '')}" disabled></label>
     <p class="hint">Role: <b>${esc(p.role)}</b> · Status: <b>${esc(p.status)}</b></p>
     <button class="btn btn-primary" type="submit">Save changes</button></form></section>
   <section class="card"><h3>Change password</h3><form id="pw" class="form" novalidate>
     <label>New password<input name="p1" type="password" minlength="8" autocomplete="new-password" required></label>
     <label>Repeat new password<input name="p2" type="password" minlength="8" autocomplete="new-password" required></label>
     <button class="btn btn-soft" type="submit">Update password</button></form></section></div>`;
  $('#pf', el).addEventListener('submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget));
    if (!f.full_name.trim()) return toast('Name is required.', 'bad');
    const row = { full_name: f.full_name.trim(), phone: (f.phone || '').trim() };
    if (student) Object.assign(row, { student_id: (f.student_id || '').trim() || null, course: (f.course || '').trim() || null, academic_year: (f.academic_year || '').trim() || null });
    const { data, error } = await sb.from('profiles').update(row).eq('id', p.id).select().single();
    if (error) return fail(error);
    state.profile = data; $('#whoName').textContent = ' ' + data.full_name; toast('Profile saved.', 'good');
  });
  $('#pw', el).addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget), a = String(f.get('p1')), b = String(f.get('p2'));
    if (a.length < 8) return toast('Use at least 8 characters.', 'bad');
    if (a !== b) return toast('The passwords do not match.', 'bad');
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return fail(error); e.target.reset(); toast('Password updated.', 'good');
  });
}
