// Live classes: Google Meet links plus embedded Jitsi rooms.
import { sb, state, $, esc, toast, fail, confirmDialog, niceDate, localInput, isMeetUrl } from './core.js';
import { empty, actions, loading } from './ui.js';
import { getSubjects, getCourses, subjectField, courseField } from './data.js';

const label = c => c.status === 'cancelled' ? ['Cancelled', 'bad'] : c.status === 'completed' ? ['Completed', 'mute'] : c.rescheduled_at ? ['Rescheduled', 'warn'] : ['Scheduled', 'ok'];
let jitsiLoader = null;
function loadJitsi() {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (!jitsiLoader) jitsiLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://meet.jit.si/external_api.js';
    s.async = true;
    s.onload = () => window.JitsiMeetExternalAPI ? resolve() : reject(new Error('Jitsi could not be loaded.'));
    s.onerror = () => reject(new Error('Could not load Jitsi. Check your internet connection.'));
    document.head.appendChild(s);
  });
  return jitsiLoader;
}
function makeRoom() {
  const bytes = new Uint8Array(18);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'edusphere-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function classesView(el) {
  const staff = state.profile.role !== 'student', admin = state.profile.role === 'admin', me = state.user.id;
  const [subjects, courses] = await Promise.all([getSubjects(), staff ? getCourses() : []]);
  let editing = null, rows = [], jitsiApi = null;

  el.innerHTML = '<h1>Live Classes</h1><p class="page-sub">' +
    (staff ? 'Schedule classes using Google Meet or an embedded Jitsi room.' : 'Join your scheduled live classes here.') +
    '</p><div id="jitsiStage" class="card" hidden style="margin-bottom:18px;padding:12px">' +
    '<div class="actions" style="justify-content:space-between;align-items:center"><b id="jitsiTitle">Live class</b><button class="btn btn-soft btn-sm" type="button" data-act="leaveJitsi">Leave class</button></div>' +
    '<p class="hint" style="margin:6px 0 10px">Allow camera and microphone only when prompted. Use the Leave class button when finished.</p>' +
    '<div id="jitsiFrame" style="width:100%;height:min(72vh,680px);min-height:420px;background:#111;border-radius:12px;overflow:hidden"></div></div>' +
    '<div class="' + (staff ? 'grid-form' : '') + '">' +
    (staff ? '<section class="card" id="clsCard"></section>' : '') +
    '<section><div id="clsList"></div></section></div>';

  const closeJitsi = () => {
    const stage = $('#jitsiStage', el);
    if (document.fullscreenElement === stage) document.exitFullscreen?.().catch(() => {});
    stage.classList.remove('jitsi-stage-expanded');
    if (jitsiApi) { try { jitsiApi.dispose(); } catch {} jitsiApi = null; }
    stage.hidden = true;
    $('#jitsiFrame', el).innerHTML = '';
  };
  async function expandJitsi() {
    const stage = $('#jitsiStage', el);
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else stage.classList.toggle('jitsi-stage-expanded');
    } catch {
      stage.classList.toggle('jitsi-stage-expanded');
    }
    const b = $('[data-act="expandJitsi"]', stage);
    if (b) b.textContent = document.fullscreenElement === stage || stage.classList.contains('jitsi-stage-expanded') ? 'Exit full screen' : 'Full screen';
  }
  const drawForm = () => {
    if (!staff) return;
    const c = editing || {}, provider = c.provider === 'jitsi' ? 'jitsi' : 'Google Meet';
    $('#clsCard', el).innerHTML = '<h3>' + (editing ? 'Edit / reschedule class' : 'Schedule a live class') + '</h3>' +
      '<form id="clsForm" class="form" novalidate>' +
      '<label>Class title<input name="title" required maxlength="120" value="' + esc(c.title || '') + '"></label>' +
      subjectField(subjects, c.subject || '') + courseField(courses, c.course_id || '') +
      '<label>Description<textarea name="description" maxlength="800">' + esc(c.description || '') + '</textarea></label>' +
      '<label>Date and time<input name="starts_at" type="datetime-local" required value="' + (c.starts_at ? localInput(c.starts_at) : '') + '"></label>' +
      '<label>Meeting platform<select name="provider"><option value="Google Meet"' + (provider === 'Google Meet' ? ' selected' : '') + '>Google Meet</option><option value="jitsi"' + (provider === 'jitsi' ? ' selected' : '') + '>Jitsi (opens inside EduSphere)</option></select></label>' +
      '<label id="meetUrlField"' + (provider === 'jitsi' ? ' hidden' : '') + '>Google Meet link<input name="meeting_url" type="url" placeholder="https://meet.google.com/abc-defg-hij" value="' + (provider === 'Google Meet' ? esc(c.meeting_url || '') : '') + '"></label>' +
      '<div id="jitsiInfo" class="note"' + (provider !== 'jitsi' ? ' hidden' : '') + '><b>Jitsi room:</b> ' + (c.meeting_room ? esc(c.meeting_room) : 'A unique room will be generated when you schedule.') + '<br>Jitsi uses its public meeting service. Do not use it for confidential classes without reviewing its privacy and service terms.</div>' +
      '<div class="note"><b>Google Meet safety:</b> Approved students can see the link, but may forward it. Use host controls to admit participants.</div>' +
      '<div class="actions"><button class="btn btn-primary" type="submit">' + (editing ? 'Save changes' : 'Schedule class') + '</button>' +
      (editing ? '<button class="btn btn-soft" type="button" data-act="cancelEdit">Stop editing</button>' : '') + '</div></form>';
    const form = $('#clsForm', el);
    form.elements.provider.addEventListener('change', () => {
      const j = form.elements.provider.value === 'jitsi';
      $('#meetUrlField', form).hidden = j;
      $('#jitsiInfo', form).hidden = !j;
    });
    form.addEventListener('submit', save);
  };

  async function save(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)), btn = e.submitter;
    const d = new Date(f.starts_at), provider = f.provider === 'jitsi' ? 'jitsi' : 'Google Meet';
    if (!f.title.trim() || !f.subject.trim()) return toast('Title and subject are required.', 'bad');
    if (Number.isNaN(d.getTime())) return toast('Choose a valid date and time.', 'bad');
    if (!editing && d < new Date()) return toast('Choose a future date and time.', 'bad');
    if (provider === 'Google Meet' && !isMeetUrl(f.meeting_url)) return toast('Use a valid Google Meet link starting with https://meet.google.com/', 'bad');
    const room = provider === 'jitsi' ? (editing?.provider === 'jitsi' ? (editing.meeting_room || String(editing.meeting_url || '').split('/').pop()) : makeRoom()) : null;
    const meetingUrl = provider === 'jitsi' ? 'https://meet.jit.si/' + encodeURIComponent(room) : f.meeting_url.trim();
    const row = { title: f.title.trim(), subject: f.subject.trim(), description: (f.description || '').trim(), meeting_url: meetingUrl, provider, meeting_room: room, starts_at: d.toISOString(), course_id: f.course_id || null, updated_at: new Date().toISOString() };
    btn.disabled = true;
    try {
      let res;
      if (editing) res = await sb.from('live_classes').update(row).eq('id', editing.id).select('id');
      else res = await sb.from('live_classes').insert({ ...row, status: 'scheduled', teacher_name: state.profile.full_name, created_by: me, is_published: true }).select('id');
      if (res.error) return fail(res.error);
      if (!res.data?.length) return toast('You are not allowed to change this class.', 'bad');
      toast(editing ? 'Class updated. Students will see the new schedule.' : 'Class scheduled.', 'good');
      editing = null; drawForm(); await load();
    } finally { btn.disabled = false; }
  }

  async function joinJitsi(c) {
    closeJitsi();
    $('#jitsiTitle', el).textContent = c.title;
    $('#jitsiStage', el).hidden = false;
    $('#jitsiStage', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      await loadJitsi();
      const room = c.meeting_room || String(c.meeting_url || '').split('/').pop();
      if (!room) throw new Error('This Jitsi class has no room name. Ask the teacher to reschedule it.');
      jitsiApi = new window.JitsiMeetExternalAPI('meet.jit.si', {
        roomName: room,
        parentNode: $('#jitsiFrame', el),
        width: '100%',
        height: '100%',
        userInfo: { displayName: state.profile.full_name || 'EduSphere participant' },
        configOverwrite: {
          prejoinPageEnabled: true,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          toolbarButtons: ['microphone', 'camera', 'desktop', 'chat', 'participants-pane', 'raisehand', 'tileview', 'fullscreen', 'settings', 'hangup', 'select-background', 'videoquality']
        },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false, SHOW_JITSI_WATERMARK: false }
      });
      jitsiApi.addListener('readyToClose', closeJitsi);
    } catch (err) { closeJitsi(); toast(err.message || 'Could not open the Jitsi class.', 'bad'); }
  }

  async function load() {
    loading($('#clsList', el));
    let q = sb.from('live_classes').select('id,title,subject,description,meeting_url,provider,meeting_room,starts_at,status,teacher_name,created_by,course_id,rescheduled_at,original_starts_at,courses(title)').order('starts_at', { ascending: true });
    if (!admin) q = q.gte('starts_at', new Date(Date.now() - 7 * 86400e3).toISOString());
    const { data, error } = await q;
    if (error) { $('#clsList', el).innerHTML = '<div class="note warn">' + esc(error.message) + '</div>'; return; }
    rows = data || []; draw();
  }
  function draw() {
    const now = Date.now(), up = rows.filter(c => c.status === 'scheduled' && new Date(c.starts_at) >= now - 3600e3);
    const card = c => {
      const [t, k] = label(c), own = admin || c.created_by === me, active = c.status === 'scheduled';
      const jitsi = c.provider === 'jitsi';
      const join = active ? (jitsi
        ? '<button class="btn btn-primary btn-sm" data-act="join" data-id="' + esc(c.id) + '" type="button">Join inside EduSphere</button>'
        : '<a class="btn btn-primary btn-sm" href="' + esc(c.meeting_url) + '" target="_blank" rel="noopener noreferrer">Join Google Meet</a>') : '';
      return '<div class="row"><div class="main"><b>' + esc(c.title) + '</b><small>' + esc([c.subject, c.courses?.title, c.teacher_name, jitsi ? 'Jitsi' : 'Google Meet'].filter(Boolean).join(' · ')) + '</small><small>' + niceDate(c.starts_at) + (c.rescheduled_at && c.original_starts_at ? ' (was ' + niceDate(c.original_starts_at) + ')' : '') + '</small>' + (c.description ? '<small>' + esc(c.description) + '</small>' : '') + '</div>' +
        '<span class="badge ' + k + '">' + t + '</span><div class="actions">' + join +
        (staff && own && active ? '<button class="btn btn-soft btn-sm" data-act="edit" data-id="' + esc(c.id) + '" type="button">Edit / reschedule</button><button class="btn btn-soft btn-sm" data-act="done" data-id="' + esc(c.id) + '" type="button">Mark completed</button><button class="btn btn-outline-danger btn-sm" data-act="cancel" data-id="' + esc(c.id) + '" type="button">Cancel class</button>' : '') +
        '</div></div>';
    };
    $('#clsList', el).innerHTML = '<h3 class="subhead" style="margin-top:0">Upcoming</h3>' + (up.length ? '<div class="list">' + up.map(card).join('') + '</div>' : empty('No upcoming classes.'));
  }
  const setStatus = async (id, st, msg) => {
    const { data, error } = await sb.from('live_classes').update({ status: st, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return toast('You are not allowed to change this class.', 'bad');
    toast(msg, 'good'); await load();
  };
  drawForm(); await load();
  actions(el, {
    join: ({ id }) => { const c = rows.find(r => r.id === id); if (c) return joinJitsi(c); },
    leaveJitsi: closeJitsi,
    expandJitsi,
    edit: ({ id }) => { editing = rows.find(r => r.id === id); drawForm(); $('#clsCard', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    cancelEdit: () => { editing = null; drawForm(); },
    cancel: async ({ id }) => { if (await confirmDialog({ title: 'Cancel this class?', text: 'Students will see it as cancelled and the Join button will disappear. The record is kept in the history.', confirm: 'Cancel class' })) await setStatus(id, 'cancelled', 'Class cancelled.'); },
    done: ({ id }) => setStatus(id, 'completed', 'Marked as completed.')
  });
  el.addEventListener('DOMNodeRemoved', closeJitsi, { once: true });
}
