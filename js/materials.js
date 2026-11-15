// Study materials: private Storage bucket, short-lived signed links, ownership-based delete.
import { sb, state, $, esc, toast, fail, confirmDialog, niceDate } from './core.js';
import { empty, actions, loading } from './ui.js';
import { getSubjects, getCourses, subjectField, courseField } from './data.js';

const BUCKET = 'study-materials', MAX = 50 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.txt';
const ICON = n => /\.pdf$/i.test(n) ? 'PDF' : /\.docx?$/i.test(n) ? 'DOC' : /\.pptx?$/i.test(n) ? 'PPT' : /\.xlsx?$/i.test(n) ? 'XLS' : /\.(png|jpe?g|webp|gif)$/i.test(n) ? 'IMG' : 'FILE';
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

export async function materialsView(el) {
  const staff = state.profile.role !== 'student', admin = state.profile.role === 'admin', me = state.user.id;
  const [subjects, courses] = await Promise.all([getSubjects(), staff ? getCourses() : []]);
  let rows = [], filter = '';
  el.innerHTML = `<h1>Study Materials</h1><p class="page-sub">${staff ? 'Upload PDF, Word, PowerPoint, Excel or image files.' : 'Notes and resources published by your teachers.'}</p>
  <div class="${staff ? 'grid-form' : ''}">${staff ? `<section class="card"><h3>Upload material</h3><form id="matForm" class="form" novalidate>
    <label>Title<input name="title" required maxlength="120"></label>
    ${subjectField(subjects)}${courseField(courses)}
    <label>Description<textarea name="description" maxlength="600"></textarea></label>
    <label>File <small>(PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, images; max 50 MB)</small><input name="file" type="file" accept="${ACCEPT}" required></label>
    <label class="check"><input name="publish" type="checkbox" checked> Publish now (visible to approved students)</label>
    <button class="btn btn-primary" type="submit">Upload material</button></form></section>` : ''}
  <section><div id="chips" class="chips"></div><div id="matList"></div></section></div>`;

  async function load() {
    loading($('#matList', el));
    const { data, error } = await sb.from('materials').select('id,title,description,subject,file_path,file_name,content_type,is_published,uploaded_by,created_at,courses(title)').order('created_at', { ascending: false });
    if (error) { $('#matList', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    rows = data; draw();
  }
  function draw() {
    const subs = [...new Set(rows.map(r => r.subject).filter(Boolean))].sort();
    $('#chips', el).innerHTML = subs.length ? ['All', ...subs].map(s => `<button class="chip" type="button" data-act="filter" data-s="${esc(s === 'All' ? '' : s)}" aria-pressed="${(s === 'All' ? '' : s) === filter}">${esc(s)}</button>`).join('') : '';
    const list = rows.filter(r => !filter || r.subject === filter);
    $('#matList', el).innerHTML = list.length ? `<div class="list">${list.map(m => {
      const own = admin || m.uploaded_by === me;
      return `<div class="row"><span class="badge info" aria-hidden="true">${ICON(m.file_name)}</span><div class="main"><b>${esc(m.title)}</b><small>${esc([m.subject, m.courses?.title, m.file_name].filter(Boolean).join(' · '))} · ${niceDate(m.created_at)}</small>${m.description ? `<small>${esc(m.description)}</small>` : ''}</div>
      ${staff ? (m.is_published ? '<span class="badge ok">Published</span>' : '<span class="badge mute">Draft</span>') : ''}
      <div class="actions"><button class="btn btn-primary btn-sm" type="button" data-act="open" data-id="${esc(m.id)}">Open / download</button>${staff && own ? `<button class="btn btn-soft btn-sm" type="button" data-act="toggle" data-id="${esc(m.id)}">${m.is_published ? 'Unpublish' : 'Publish'}</button><button class="btn btn-outline-danger btn-sm" type="button" data-act="del" data-id="${esc(m.id)}">Delete</button>` : ''}</div></div>`;
    }).join('')}</div>` : empty(staff ? 'No materials yet. Upload your first file with the form.' : 'No study materials are published yet.');
  }

  if (staff) $('#matForm', el).addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget, f = new FormData(form), file = f.get('file'), btn = e.submitter;
    if (!String(f.get('title')).trim() || !String(f.get('subject')).trim()) return toast('Title and subject are required.', 'bad');
    if (!file || !file.size) return toast('Choose a file first.', 'bad');
    if (file.size > MAX) return toast(`That file is ${fmtSize(file.size)}. The limit is 50 MB.`, 'bad');
    if (!new RegExp('\\.(' + ACCEPT.replace(/\./g, '').split(',').join('|') + ')$', 'i').test(file.name)) return toast('This file type is not allowed.', 'bad');
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const path = `${me}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upErr) return fail(upErr);
      const { error } = await sb.from('materials').insert({ title: String(f.get('title')).trim(), subject: String(f.get('subject')).trim(), description: String(f.get('description')).trim(), course_id: f.get('course_id') || null, file_path: path, file_name: file.name, content_type: file.type, uploaded_by: me, is_published: !!f.get('publish') });
      if (error) { await sb.storage.from(BUCKET).remove([path]); return fail(error); }
      toast('Material uploaded.', 'good'); form.reset(); await load();
    } finally { btn.disabled = false; btn.textContent = 'Upload material'; }
  });

  await load();
  actions(el, {
    filter: ({ s }) => { filter = s; draw(); },
    open: async ({ id }) => {
      const m = rows.find(r => r.id === id);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(m.file_path, 90, { download: false });
      if (error) return fail(error, 'Could not open this file.');
      const a = document.createElement('a'); a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.append(a); a.click(); a.remove();
    },
    toggle: async ({ id }) => {
      const m = rows.find(r => r.id === id);
      const { data, error } = await sb.from('materials').update({ is_published: !m.is_published }).eq('id', id).select('id');
      if (error) return fail(error); if (!data?.length) return toast('You are not allowed to change this material.', 'bad');
      toast(m.is_published ? 'Unpublished.' : 'Published.', 'good'); await load();
    },
    del: async ({ id }) => {
      const m = rows.find(r => r.id === id);
      if (!await confirmDialog({ title: 'Delete this material permanently?', text: `"${m.title}" and its file will be removed for everyone. This is recorded in the audit log and cannot be undone.`, confirm: 'Delete permanently' })) return;
      const { data, error } = await sb.from('materials').delete().eq('id', id).select('id'); // database policy decides; 0 rows = refused
      if (error) return fail(error);
      if (!data?.length) return toast('You are not allowed to delete this material.', 'bad');
      const { error: se } = await sb.storage.from(BUCKET).remove([m.file_path]);
      toast(se ? 'Material deleted, but its file could not be removed from storage.' : 'Material deleted.', se ? 'bad' : 'good'); await load();
    },
  });
}
