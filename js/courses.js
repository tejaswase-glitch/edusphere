// Courses (all roles) + subjects (admin). Teachers manage only their own courses.
import { sb, state, $, esc, toast, fail, confirmDialog, subjectArt } from './core.js';

async function uploadHomepageCardImage(file) {
  if (!file) return '';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Choose a JPG, PNG or WEBP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Image must be 2 MB or smaller.');
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const path = `homepage/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('lecture-thumbnails').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = sb.storage.from('lecture-thumbnails').getPublicUrl(path);
  return data.publicUrl;
}
import { empty, actions, loading } from './ui.js';
import { getSubjects } from './data.js?v=20261120-homepage-cards';
import { subjectField } from './data.js';

export async function coursesView(el) {
  const role = state.profile.role, staff = role !== 'student', admin = role === 'admin', me = state.user.id;
  let courses = [], subjects = [], editing = null;
  el.innerHTML = `<h1>${admin ? 'Courses & Subjects' : staff ? 'My Courses' : 'My Courses'}</h1><p class="page-sub">${staff ? 'Create and manage courses.' : 'Courses available to you.'}</p>
  <div class="${staff ? 'grid-form' : ''}">${staff ? '<section class="card" id="crsCard"></section>' : ''}<section><div id="crsList"></div>${admin ? '<div class="card" style="margin-top:16px" id="subCard"></div>' : ''}</section></div>`;

  const drawForm = () => {
    if (!staff) return; const c = editing || {};
    $('#crsCard', el).innerHTML = `<h3>${editing ? 'Edit course' : 'Create a course'}</h3><form id="crsForm" class="form" novalidate>
      <label>Course title<input name="title" required maxlength="100" value="${esc(c.title || '')}"></label>
      ${subjectField(subjects, c.subject || '').replace(' required', '')}
      <label>Description<textarea name="description" maxlength="600">${esc(c.description || '')}</textarea></label>
      <label class="check"><input name="is_active" type="checkbox"${editing ? (c.is_active ? ' checked' : '') : ' checked'}> Active (visible to approved students)</label>
      <div class="actions"><button class="btn btn-primary" type="submit">${editing ? 'Save course' : 'Create course'}</button>${editing ? '<button class="btn btn-soft" type="button" data-act="cancelEdit">Cancel</button>' : ''}</div></form>`;
    $('#crsForm', el).addEventListener('submit', async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); if (!f.title.trim()) return toast('Course title is required.', 'bad');
      const row = { title: f.title.trim(), subject: (f.subject || '').trim(), description: (f.description || '').trim(), is_active: !!f.is_active };
      const res = editing ? await sb.from('courses').update(row).eq('id', editing.id).select('id') : await sb.from('courses').insert({ ...row, created_by: me }).select('id');
      if (res.error) return fail(res.error); if (!res.data?.length) return toast('You are not allowed to change this course.', 'bad');
      toast(editing ? 'Course saved.' : 'Course created.', 'good'); editing = null; drawForm(); await load();
    });
  };
  async function load() {
    loading($('#crsList', el));
    const { data, error } = await sb.from('courses').select('id,title,subject,description,is_active,created_by').order('title');
    if (error) { $('#crsList', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    courses = data; subjects = await getSubjects(); drawList(); drawSubjects(); if (staff && !editing) drawForm();
  }
  function drawList() {
    $('#crsList', el).innerHTML = !courses.length ? empty(staff ? 'No courses yet. Create the first one.' : 'No courses have been added yet.')
      : staff ? `<div class="list">${courses.map(c => { const own = admin || c.created_by === me; return `<div class="row"><div class="main"><b>${esc(c.title)}</b><small>${esc([c.subject, c.description].filter(Boolean).join(' · '))}</small></div><span class="badge ${c.is_active ? 'ok' : 'mute'}">${c.is_active ? 'Active' : 'Inactive'}</span>${own ? `<div class="actions"><button class="btn btn-soft btn-sm" data-act="edit" data-id="${esc(c.id)}" type="button">Edit</button><button class="btn btn-soft btn-sm" data-act="toggle" data-id="${esc(c.id)}" type="button">${c.is_active ? 'Deactivate' : 'Activate'}</button>${admin ? `<button class="btn btn-outline-danger btn-sm" data-act="del" data-id="${esc(c.id)}" type="button">Delete</button>` : ''}</div>` : ''}</div>`; }).join('')}</div>`
      : `<div class="course-grid">${courses.map(c => `<article class="course-card"><img src="${subjectArt(c.subject || c.title)}" alt="" loading="lazy"><div><h3>${esc(c.title)}</h3><p>${esc(c.subject || '')}</p>${c.description ? `<p>${esc(c.description)}</p>` : ''}</div></article>`).join('')}</div>`;
  }
  function drawSubjects() {
    if (!admin) return;
    $('#subCard', el).innerHTML = `<h3>Manage Homepage Subject Cards</h3>
      <p class="hint">These settings control the Mathematics / Physics / Chemistry cards in the public homepage. This does not change Latest Lectures or live classes.</p>
      ${subjects.length ? `<div class="list">${subjects.map(s => `<div class="row" style="align-items:flex-start">
        <div class="main"><b>${esc(s.name)}</b><small>${esc(s.description || 'No description')}</small><small>Homepage: ${s.homepage_visible ? 'Visible' : 'Hidden'} · Order: ${Number(s.homepage_order || 0)}</small></div>
        <div class="actions"><button class="btn btn-soft btn-sm" data-act="subEdit" data-id="${esc(s.id)}" type="button">Customize</button>
        <button class="btn btn-soft btn-sm" data-act="homeToggle" data-id="${esc(s.id)}" type="button">${s.homepage_visible ? 'Hide from homepage' : 'Show on homepage'}</button>
        <button class="btn btn-outline-danger btn-sm" data-act="subDel" data-id="${esc(s.id)}" type="button">Delete</button></div></div>`).join('')}</div>` : empty('No subjects yet.')}
      <form id="subForm" class="form" style="margin-top:16px" novalidate>
        <h3>Add homepage card</h3>
        <label>Subject / card title<input name="name" required maxlength="60" placeholder="e.g. Biology"></label>
        <label>Short description<input name="description" maxlength="160" placeholder="e.g. Human anatomy and physiology"></label>
        <label>Upload card image from gallery <small>(optional · JPG, PNG or WEBP · max 2 MB)</small><input name="card_image" type="file" accept="image/jpeg,image/png,image/webp,image/*"></label>
        <label>Homepage position <input name="homepage_order" type="number" value="0" min="0" step="1"></label>
        <button class="btn btn-primary" type="submit">Add card</button>
      </form>`;
    $('#subForm', el).addEventListener('submit', async e => {
      e.preventDefault(); const form=e.currentTarget; const f=new FormData(form); const name=String(f.get('name')||'').trim(); if (!name) return;
      const file=form.elements.card_image.files?.[0]; let image='';
      try { if(file){ toast('Uploading card image…'); image=await uploadHomepageCardImage(file); } }
      catch(err){ return fail(err); }
      const { error } = await sb.from('subjects').insert({ name, description:String(f.get('description')||'').trim(), image_url:image, homepage_order:Number(f.get('homepage_order'))||0, homepage_visible:true, created_by:me });
      if (error) return fail(error, /duplicate/i.test(error.message) ? 'That subject already exists.' : undefined); toast('Homepage card added.', 'good'); await load();
    });
  }
  await load();
  actions(el, {
    edit: ({ id }) => { editing = courses.find(c => c.id === id); drawForm(); $('#crsCard', el).scrollIntoView({ behavior: 'smooth' }); },
    cancelEdit: () => { editing = null; drawForm(); },
    toggle: async ({ id }) => { const c = courses.find(x => x.id === id); const { data, error } = await sb.from('courses').update({ is_active: !c.is_active }).eq('id', id).select('id'); if (error) return fail(error); if (!data?.length) return toast('Not allowed.', 'bad'); await load(); },
    del: async ({ id }) => {
      const c = courses.find(x => x.id === id);
      if (!await confirmDialog({ title: 'Delete this course?', text: `"${c.title}" will be removed. Materials and classes linked to it stay, but lose the course link. This is recorded in the audit log.`, confirm: 'Delete course' })) return;
      const { data, error } = await sb.from('courses').delete().eq('id', id).select('id'); if (error) return fail(error); if (!data?.length) return toast('Not allowed.', 'bad'); toast('Course deleted.', 'good'); await load();
    },
    subEdit: async ({ id }) => {
      const s=subjects.find(x=>x.id===id);
      const name=prompt('Card title:',s.name); if(name===null)return;
      const description=prompt('Short description:',s.description||''); if(description===null)return;
      const order=prompt('Homepage position (0 appears first):',String(s.homepage_order||0)); if(order===null)return;
      const {error}=await sb.from('subjects').update({name:name.trim(),description:description.trim(),homepage_order:Number(order)||0}).eq('id',id);
      if(error)return fail(error);
      const picker=document.createElement('input'); picker.type='file'; picker.accept='image/*';
      picker.onchange=async()=>{
        const file=picker.files?.[0]; if(!file)return;
        try {
          const image_url=await uploadHomepageCardImage(file);
          const {error:saveError}=await sb.from('subjects').update({image_url}).eq('id',id);
          if(saveError)return fail(saveError);
          toast('Card details and image updated.','good'); await load();
        } catch(err){ return fail(err); }
      };
      toast('Card details saved. Choose a new image if you want to replace the current one.','good');
      picker.click();
      await load();
    },
    homeToggle: async ({ id }) => { const s=subjects.find(x=>x.id===id); const {error}=await sb.from('subjects').update({homepage_visible:!s.homepage_visible}).eq('id',id); if(error)return fail(error); toast(s.homepage_visible?'Card hidden from homepage.':'Card shown on homepage.','good'); await load(); },
    subToggle: async ({ id }) => { const s = subjects.find(x => x.id === id); const { error } = await sb.from('subjects').update({ is_active: !s.is_active }).eq('id', id); if (error) return fail(error); await load(); },
    subDel: async ({ id }) => {
      const s = subjects.find(x => x.id === id);
      if (!await confirmDialog({ title: 'Delete this subject?', text: `"${s.name}" will no longer be offered in forms. Existing lectures and materials keep their subject name.`, confirm: 'Delete subject' })) return;
      const { error } = await sb.from('subjects').delete().eq('id', id); if (error) return fail(error); toast('Subject deleted.', 'good'); await load();
    },
  });
}
