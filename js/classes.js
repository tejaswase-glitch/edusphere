// Google Meet live classes: schedule, edit/reschedule, cancel (history is kept), student join rules.
import { sb, state, $, esc, toast, fail, confirmDialog, niceDate, localInput, isMeetUrl } from './core.js';
import { empty, actions, loading } from './ui.js';
import { getSubjects, getCourses, subjectField, courseField } from './data.js';

const label = c => c.status === 'cancelled' ? ['Cancelled', 'bad'] : c.status === 'completed' ? ['Completed', 'mute'] : c.rescheduled_at ? ['Rescheduled', 'warn'] : ['Scheduled', 'ok'];

export async function classesView(el) {
  const staff = state.profile.role !== 'student', admin = state.profile.role === 'admin', me = state.user.id;
  const [subjects, courses] = await Promise.all([getSubjects(), staff ? getCourses() : []]);
  let editing = null, rows = [];

  el.innerHTML = `<h1>Live Classes</h1><p class="page-sub">${staff ? 'Schedule Google Meet classes. Cancelled classes stay in the history.' : 'Join your scheduled classes on Google Meet.'}</p>
  <div class="${staff ? 'grid-form' : ''}">${staff ? '<section class="card" id="clsCard"></section>' : ''}<section><div id="clsList"></div></section></div>`;

  const drawForm = () => {
    if (!staff) return; const c = editing || {};
    $('#clsCard', el).innerHTML = `<h3>${editing ? 'Edit / reschedule class' : 'Schedule a live class'}</h3><form id="clsForm" class="form" novalidate>
      <label>Class title<input name="title" required maxlength="120" value="${esc(c.title || '')}"></label>
      ${subjectField(subjects, c.subject || '')}${courseField(courses, c.course_id || '')}
      <label>Description<textarea name="description" maxlength="800">${esc(c.description || '')}</textarea></label>
      <label>Date and time<input name="starts_at" type="datetime-local" required value="${c.starts_at ? localInput(c.starts_at) : ''}"></label>
      <label>Google Meet link<input name="meeting_url" type="url" required placeholder="https://meet.google.com/abc-defg-hij" value="${esc(c.meeting_url || '')}"></label>
      <div class="note"><b>Please note:</b> EduSphere shows the Meet link only to approved students, but it cannot stop an approved student from forwarding it. Use Google Meet host controls (waiting room / admit people) for safety.</div>
      <div class="actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Schedule class'}</button>${editing ? '<button class="btn btn-soft" type="button" data-act="cancelEdit">Stop editing</button>' : ''}</div></form>`;
    $('#clsForm', el).addEventListener('submit', save);
  };
  async function save(e) {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)), btn = e.submitter;
    const d = new Date(f.starts_at);
    if (!f.title.trim() || !f.subject.trim()) return toast('Title and subject are required.', 'bad');
    if (Number.isNaN(d.getTime())) return toast('Choose a valid date and time.', 'bad');
    if (!editing && d < new Date()) return toast('Choose a future date and time.', 'bad');
    if (!isMeetUrl(f.meeting_url)) return toast('Use a Google Meet link that starts with https://meet.google.com/', 'bad');
    const row = { title: f.title.trim(), subject: f.subject.trim(), description: (f.description || '').trim(), meeting_url: f.meeting_url.trim(), provider: 'Google Meet', starts_at: d.toISOString(), course_id: f.course_id || null, updated_at: new Date().toISOString() };
    btn.disabled = true;
    try {
      let res;
      if (editing) res = await sb.from('live_classes').update(row).eq('id', editing.id).select('id');
      else res = await sb.from('live_classes').insert({ ...row, status: 'scheduled', teacher_name: state.profile.full_name, created_by: me, is_published: true }).select('id');
      if (res.error) return fail(res.error); if (!res.data?.length) return toast('You are not allowed to change this class.', 'bad');
      toast(editing ? 'Class updated. Students will see the new schedule.' : 'Class scheduled.', 'good'); editing = null; drawForm(); await load();
    } finally { btn.disabled = false; }
  }

  async function load() {
    loading($('#clsList', el));
    let q = sb.from('live_classes').select('id,title,subject,description,meeting_url,starts_at,status,teacher_name,created_by,course_id,rescheduled_at,original_starts_at,courses(title)').order('starts_at', { ascending: true });
    if (!admin) q = q.gte('starts_at', new Date(Date.now() - 7 * 86400e3).toISOString()); // last 7 days + future for students/teachers
    const { data, error } = await q;
    if (error) { $('#clsList', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    rows = data; draw();
  }
  function draw() {
    const now = Date.now(), up = rows.filter(c => c.status === 'scheduled' && new Date(c.starts_at) >= now - 3600e3), other = rows.filter(c => !up.includes(c)).reverse();
    const card = c => {
      const [t, k] = label(c), own = admin || c.created_by === me, active = c.status === 'scheduled';
      return `<div class="row"><div class="main"><b>${esc(c.title)}</b><small>${esc([c.subject, c.courses?.title, c.teacher_name].filter(Boolean).join(' · '))}</small><small>${niceDate(c.starts_at)}${c.rescheduled_at && c.original_starts_at ? ` (was ${niceDate(c.original_starts_at)})` : ''}</small>${c.description ? `<small>${esc(c.description)}</small>` : ''}</div>
      <span class="badge ${k}">${t}</span>
      <div class="actions">${active ? `<a class="btn btn-primary btn-sm" href="${esc(c.meeting_url)}" target="_blank" rel="noopener noreferrer">Join Google Meet</a>` : ''}
      ${staff && own && active ? `<button class="btn btn-soft btn-sm" data-act="edit" data-id="${esc(c.id)}" type="button">Edit / reschedule</button><button class="btn btn-soft btn-sm" data-act="done" data-id="${esc(c.id)}" type="button">Mark completed</button><button class="btn btn-outline-danger btn-sm" data-act="cancel" data-id="${esc(c.id)}" type="button">Cancel class</button>` : ''}</div></div>`;
    };
    $('#clsList', el).innerHTML = `<h3 class="subhead" style="margin-top:0">Upcoming</h3>${up.length ? `<div class="list">${up.map(card).join('')}</div>` : empty('No upcoming classes.')}
      ${other.length ? `<h3 class="subhead">Cancelled, completed and past</h3><div class="list">${other.map(card).join('')}</div>` : ''}`;
  }
  const setStatus = async (id, st, msg) => {
    const { data, error } = await sb.from('live_classes').update({ status: st, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) return fail(error); if (!data?.length) return toast('You are not allowed to change this class.', 'bad');
    toast(msg, 'good'); await load();
  };
  drawForm(); await load();
  actions(el, {
    edit: ({ id }) => { editing = rows.find(r => r.id === id); drawForm(); $('#clsCard', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    cancelEdit: () => { editing = null; drawForm(); },
    cancel: async ({ id }) => { if (await confirmDialog({ title: 'Cancel this class?', text: 'Students will see it as cancelled and the Join button will disappear. The record is kept in the history.', confirm: 'Cancel class' })) await setStatus(id, 'cancelled', 'Class cancelled.'); },
    done: ({ id }) => setStatus(id, 'completed', 'Marked as completed.'),
  });
}
