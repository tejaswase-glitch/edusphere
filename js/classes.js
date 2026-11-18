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
    '</p><div id="jitsiStage" class="card jitsi-stage" hidden>' +
    '<div class="jitsi-stage-head"><div><b id="jitsiTitle">Live class</b><small>EduSphere live classroom</small></div><div class="actions"><button class="btn btn-soft btn-sm" type="button" data-act="expandJitsi">Full screen</button><button class="btn btn-danger btn-sm" type="button" data-act="leaveJitsi">Leave class</button></div></div>' +
    '<p class="hint jitsi-hint">Use the Jitsi toolbar for microphone, camera, chat, participants, screen sharing and tile view. Allow camera and microphone when prompted.</p>' +
    '<div id="jitsiFrame" class="jitsi-frame"></div></div>' +
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
