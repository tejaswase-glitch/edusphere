// Recorded Video Centre: YouTube Unlisted embeds. Students watch inside EduSphere.
import { sb, state, $, esc, toast, fail, openModal, confirmDialog, ytId, subjectArt, niceDate } from './core.js';
import { empty, actions, loading } from './ui.js';
import { getSubjects, getCourses, subjectField, courseField } from './data.js';

const THUMB_BUCKET = 'lecture-thumbnails';
// Inside the signed-in app only: YouTube's automatic thumbnail is a fallback. Public pages never use it.
export const thumbFor = l => l.thumbnail_url || (l.video_id ? `https://i.ytimg.com/vi/${l.video_id}/hqdefault.jpg` : subjectArt(l.subject));
const thumbPath = url => { const m = String(url || '').match(new RegExp(`/object/public/${THUMB_BUCKET}/(.+)$`)); return m ? decodeURIComponent(m[1]) : null; };

export async function playLecture(l, { track = false, onClose } = {}) {
  let rec = null;
  if (track) {
    const { data } = await sb.from('lecture_progress').upsert({ user_id: state.user.id, lecture_id: l.id, last_watched_at: new Date().toISOString() }, { onConflict: 'user_id,lecture_id' }).select().maybeSingle();
    rec = data;
  }
  const d = openModal(`<h2 id="modalTitle">${esc(l.title)}</h2><p class="dlg-sub">${esc(l.subject || '')}${l.teacher_name ? ' · ' + esc(l.teacher_name) : ''}</p>
    <div class="player"><iframe title="${esc(l.title)}" src="https://www.youtube-nocookie.com/embed/${esc(l.video_id)}?rel=0&modestbranding=1" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
    ${l.description ? `<p>${esc(l.description)}</p>` : ''}
    ${track ? `<div class="row-end" style="justify-content:flex-start"><button class="btn ${rec?.completed ? 'btn-soft' : 'btn-green'}" id="markDone" type="button">${rec?.completed ? 'Completed - undo' : 'Mark as completed'}</button></div>` : ''}`, { xl: true });
  if (track) $('#markDone').onclick = async e => {
    const to = !rec?.completed;
    const { data, error } = await sb.from('lecture_progress').update({ completed: to, completed_at: to ? new Date().toISOString() : null, last_watched_at: new Date().toISOString() }).eq('user_id', state.user.id).eq('lecture_id', l.id).select().single();
    if (error) return fail(error); rec = data;
    e.target.textContent = to ? 'Completed - undo' : 'Mark as completed'; e.target.className = 'btn ' + (to ? 'btn-soft' : 'btn-green'); toast(to ? 'Marked as completed.' : 'Marked as not completed.', 'good');
  };
  d.addEventListener('close', () => { $('#modalBody').innerHTML = ''; onClose?.(); }, { once: true });
}

export async function lecturesView(el) {
  const staff = state.profile.role !== 'student', admin = state.profile.role === 'admin', me = state.user.id;
  const [subjects, courses] = await Promise.all([getSubjects(), staff ? getCourses() : []]);
  let editing = null, filter = '';

  const shell = () => {
    el.innerHTML = `<h1>Recorded Lectures</h1><p class="page-sub">${staff ? 'Publish YouTube Unlisted lessons for approved students.' : 'Watch lessons published by your teachers.'}</p>
    <div class="${staff ? 'grid-form' : ''}">${staff ? `<section class="card" id="lecFormCard"></section>` : ''}<section><div id="chips" class="chips"></div><div id="lecList"></div></section></div>`;
    if (staff) drawForm();
  };
  const drawForm = () => {
    const l = editing || {};
    $('#lecFormCard').innerHTML = `<h3>${editing ? 'Edit lecture' : 'Add recorded lecture'}</h3>
    <form id="lecForm" class="form" novalidate>
      <label>Title<input name="title" required maxlength="120" value="${esc(l.title || '')}"></label>
      ${subjectField(subjects, l.subject || '')}
      ${courseField(courses, l.course_id || '')}
      <label>Description<textarea name="description" maxlength="1000">${esc(l.description || '')}</textarea></label>
      <label>YouTube link or video ID<input name="video" required value="${esc(l.video_id || '')}" placeholder="https://youtu.be/xxxxxxxxxxx"></label>
      <label>Thumbnail image <small>(JPG/PNG/WebP, max 2 MB${l.thumbnail_url ? '; leave empty to keep the current one' : ''})</small><input name="thumb" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <label class="check"><input name="publish" type="checkbox"${l.is_published ? ' checked' : ''}> Published (visible to approved students)</label>
      <div class="note warn"><b>About privacy:</b> an Unlisted YouTube video can be watched by anyone who gets the link. EduSphere hides the link from visitors and pending students, but cannot stop an approved student from sharing it. EduSphere is not DRM.</div>
      <div class="actions"><button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Save lecture'}</button>${editing ? '<button class="btn btn-soft" type="button" data-act="cancelEdit">Cancel</button>' : ''}</div>
    </form>`;
    $('#lecForm', el).addEventListener('submit', save);
  };

  async function save(e) {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form), btn = e.submitter;
    const id = ytId(f.get('video')); if (!id) return toast('Enter a valid YouTube link or 11-character video ID.', 'bad');
    if (!String(f.get('title')).trim() || !String(f.get('subject')).trim()) return toast('Title and subject are required.', 'bad');
    const file = f.get('thumb'); let thumbnail_url = editing?.thumbnail_url || null, oldThumb = null;
    btn.disabled = true;
    try {
      if (file && file.size) {
        if (file.size > 2 * 1024 * 1024) return toast('Thumbnail is larger than 2 MB.', 'bad');
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Thumbnail must be JPG, PNG or WebP.', 'bad');
        const path = `${me}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: upErr } = await sb.storage.from(THUMB_BUCKET).upload(path, file, { contentType: file.type });
        if (upErr) return fail(upErr);
        oldThumb = thumbPath(thumbnail_url); thumbnail_url = sb.storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl;
      }
      const row = { title: String(f.get('title')).trim(), subject: String(f.get('subject')).trim(), description: String(f.get('description')).trim(), video_id: id, thumbnail_url, course_id: f.get('course_id') || null, is_published: !!f.get('publish') };
      const { error } = editing
        ? await sb.from('recorded_lectures').update(row).eq('id', editing.id)
        : await sb.from('recorded_lectures').insert({ ...row, teacher_name: state.profile.full_name, created_by: me });
      if (error) return fail(error);
      if (oldThumb) sb.storage.from(THUMB_BUCKET).remove([oldThumb]);
      toast(editing ? 'Lecture updated.' : 'Lecture saved.', 'good'); editing = null; drawForm(); await load();
    } finally { btn.disabled = false; }
  }

  let rows = [];
  async function load() {
    loading($('#lecList'));
    const { data, error } = await sb.from('recorded_lectures').select('id,title,subject,description,video_id,thumbnail_url,teacher_name,is_published,created_by,course_id,created_at').order('created_at', { ascending: false });
    if (error) { $('#lecList').innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    rows = data; draw();
  }
  function draw() {
    const subs = [...new Set(rows.map(r => r.subject).filter(Boolean))].sort();
    $('#chips').innerHTML = subs.length ? ['All', ...subs].map(s => `<button class="chip" type="button" data-act="filter" data-s="${esc(s === 'All' ? '' : s)}" aria-pressed="${(s === 'All' ? '' : s) === filter}">${esc(s)}</button>`).join('') : '';
    const list = rows.filter(r => !filter || r.subject === filter);
    $('#lecList').innerHTML = list.length ? `<div class="lec-grid">${list.map(l => {
      const own = admin || l.created_by === me;
      return `<article class="lec"><button class="tn" type="button" data-act="watch" data-id="${esc(l.id)}" aria-label="Watch ${esc(l.title)}"><img src="${esc(thumbFor(l))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${subjectArt(l.subject)}'"></button>
      <div class="bd"><h3>${esc(l.title)}</h3><small>${esc(l.subject || '')}${l.teacher_name ? ' · ' + esc(l.teacher_name) : ''}</small>${staff ? `<span>${l.is_published ? '<span class="badge ok">Published</span>' : '<span class="badge mute">Unpublished</span>'}</span>` : ''}</div>
      <div class="actions"><button class="btn btn-primary btn-sm" type="button" data-act="watch" data-id="${esc(l.id)}">Watch</button>${staff && own ? `<button class="btn btn-soft btn-sm" type="button" data-act="edit" data-id="${esc(l.id)}">Edit</button><button class="btn btn-soft btn-sm" type="button" data-act="toggle" data-id="${esc(l.id)}">${l.is_published ? 'Unpublish' : 'Publish'}</button><button class="btn btn-outline-danger btn-sm" type="button" data-act="del" data-id="${esc(l.id)}">Delete</button>` : ''}</div></article>`;
    }).join('')}</div>` : empty(staff ? 'No lectures yet. Add your first one with the form.' : 'No lectures are published yet.');
  }

  shell(); await load();
  actions(el, {
    filter: ({ s }) => { filter = s; draw(); },
    watch: ({ id }) => playLecture(rows.find(r => r.id === id), { track: !staff }),
    edit: ({ id }) => { editing = rows.find(r => r.id === id); drawForm(); $('#lecFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    cancelEdit: () => { editing = null; drawForm(); },
    toggle: async ({ id }) => {
      const l = rows.find(r => r.id === id);
      const { data, error } = await sb.from('recorded_lectures').update({ is_published: !l.is_published }).eq('id', id).select('id');
      if (error) return fail(error); if (!data?.length) return toast('You are not allowed to change this lecture.', 'bad');
      toast(l.is_published ? 'Unpublished.' : 'Published.', 'good'); await load();
    },
    del: async ({ id }) => {
      const l = rows.find(r => r.id === id);
      if (!await confirmDialog({ title: 'Delete this lecture permanently?', text: `"${l.title}" will be removed for everyone, including students. This is recorded in the audit log and cannot be undone.`, confirm: 'Delete permanently' })) return;
      // The database policy decides. If it refuses, zero rows come back.
      const { data, error } = await sb.from('recorded_lectures').delete().eq('id', id).select('id');
      if (error) return fail(error);
      if (!data?.length) return toast('You are not allowed to delete this lecture.', 'bad');
      const tp = thumbPath(l.thumbnail_url); if (tp) sb.storage.from(THUMB_BUCKET).remove([tp]);
      toast('Lecture deleted.', 'good'); if (editing?.id === id) { editing = null; drawForm(); } await load();
    },
  });
}
