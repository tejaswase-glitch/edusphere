// EduSphere course playlists. Videos use the same YouTube Unlisted format as Recorded Lectures.
import { sb, state, $, esc, toast, fail, confirmDialog, ytId, subjectArt, openModal } from './core.js';
import { empty, actions, loading, options } from './ui.js';
import { getCourses } from './data.js';

const BUCKET = 'lecture-thumbnails';
const MAX_IMAGE = 2 * 1024 * 1024;
const imagePath = (uid, file) => `${uid}/playlists/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

async function uploadThumb(file, uid) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WEBP thumbnail.');
  if (file.size > MAX_IMAGE) throw new Error('Thumbnail must be 2 MB or smaller.');
  const path = imagePath(uid, file);
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600' });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const ytThumb = id => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

export async function playlistsView(el) {
  const role = state.profile.role;
  const staff = role !== 'student';
  const admin = role === 'admin';
  const me = state.user.id;
  const courses = staff ? await getCourses() : [];
  let playlists = [], selected = null, videos = [], existingLectures = [];
  let addMode = '';

  el.innerHTML = `<h1>Course Playlists</h1>
    <p class="page-sub">${staff ? 'Organize your recorded YouTube lessons into course playlists.' : 'Watch recorded lessons grouped into playlists.'}</p>
    ${staff ? '<section class="card" id="playlistCreateCard"></section>' : ''}
    <section id="playlistList"></section><section id="playlistDetail"></section>`;

  if (staff) drawPlaylistForm();

  function drawPlaylistForm() {
    const card = $('#playlistCreateCard', el);
    if (!card) return;
    card.innerHTML = `<h3>Create a playlist</h3>
      <form id="playlistForm" class="form">
        <label>Playlist title<input name="title" required maxlength="120" placeholder="e.g. Anatomy - Unit 1"></label>
        <label>Course<select name="course_id" required>${options(courses.filter(c => c.is_active).map(c => ({value:c.id,label:c.title})), '', 'Choose course')}</select></label>
        <label>Description<textarea name="description" maxlength="600"></textarea></label>
        <label>Playlist thumbnail <small>JPG/PNG/WEBP · max 2 MB</small><input name="thumb" type="file" accept="image/jpeg,image/png,image/webp" required></label>
        <label class="check"><input name="publish" type="checkbox" checked> Publish to approved students</label>
        <button class="btn btn-primary" type="submit">Create playlist</button>
      </form>`;
    $('#playlistForm', el).addEventListener('submit', savePlaylist);
  }

  async function savePlaylist(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form), btn = e.submitter;
    btn.disabled = true;
    try {
      const thumbnail_url = await uploadThumb(form.elements.thumb.files[0], me);
      const row = { title: String(f.get('title') || '').trim(), course_id: f.get('course_id'), description: String(f.get('description') || '').trim(), thumbnail_url, is_published: !!f.get('publish'), created_by: me };
      if (!row.title || !row.course_id) throw new Error('Enter a title and choose a course.');
      const { data, error } = await sb.from('course_playlists').insert(row).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You are not allowed to create a playlist for this course.');
      toast('Playlist created.', 'good');
      form.reset();
      await loadPlaylists();
    } catch (err) { fail(err); }
    finally { btn.disabled = false; }
  }

  async function loadPlaylists() {
    loading($('#playlistList', el));
    const { data, error } = await sb.from('course_playlists')
      .select('id,course_id,title,description,thumbnail_url,created_by,is_published,created_at,courses(title)')
      .order('created_at', { ascending: false });
    if (error) { $('#playlistList', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    playlists = data || [];
    $('#playlistList', el).innerHTML = playlists.length
      ? `<div class="course-grid">${playlists.map(p => `<article class="course-card" data-act="openPlaylist" data-id="${esc(p.id)}" style="cursor:pointer">
          <img src="${esc(p.thumbnail_url || subjectArt(p.courses?.title))}" alt="" loading="lazy">
          <div><h3>${esc(p.title)}</h3><p>${esc(p.courses?.title || 'Course')}</p>
            <p>${esc(p.description || '')}</p>
            <div class="actions">${staff && (admin || p.created_by === me) ? `<button class="btn btn-outline-danger btn-sm" type="button" data-act="deletePlaylist" data-id="${esc(p.id)}">Delete</button>` : '<span class="fine">Tap to open playlist →</span>'}
            </div></div></article>`).join('')}</div>`
      : empty('No playlists have been created yet.');
  }

  async function openPlaylist(id) {
    selected = playlists.find(p => p.id === id);
    if (!selected) return;
    addMode = '';
    $('#playlistDetail', el).innerHTML = '<section class="card"><p>Loading playlist videos…</p></section>';
    const { data, error } = await sb.from('playlist_videos').select('*').eq('playlist_id', id).order('sort_order').order('created_at');
    if (error) { $('#playlistDetail', el).innerHTML = `<div class="note warn">${esc(error.message)}</div>`; return; }
    videos = data || [];
    drawDetail();
    $('#playlistDetail', el).scrollIntoView({behavior:'smooth', block:'start'});
  }

  async function loadExistingLectures() {
    // RLS already limits teachers to their own lectures plus published lectures;
    // admins can see all. Do not add a client-side owner filter here.
    const q = sb.from('recorded_lectures')
      .select('id,title,subject,description,video_id,thumbnail_url,is_published,created_by,created_at')
      .order('created_at', {ascending:false});
    const { data, error } = await q;
    if (error) throw error;
    existingLectures = (data || []).filter(l => !videos.some(v => v.video_id === l.video_id));
  }

  function drawDetail() {
    if (!selected) return;
    const own = admin || selected.created_by === me;
    const visibleVideos = videos.filter(v => staff ? (own || v.is_published) : v.is_published);
    const addPanel = staff && own ? `
      <div class="actions" style="margin:14px 0"><button class="btn btn-primary" type="button" data-act="showAddOptions">＋ Add Video</button></div>
      ${addMode === 'options' ? `<div class="card" style="margin:12px 0"><h3>Add a video</h3><div class="actions">
        <button class="btn btn-soft" type="button" data-act="chooseExisting">Add Existing Video</button>
        <button class="btn btn-soft" type="button" data-act="chooseNew">Add New Video</button>
        <button class="btn btn-soft" type="button" data-act="cancelAdd">Cancel</button></div></div>` : ''}
      ${addMode === 'existing' ? existingPanel() : ''}
      ${addMode === 'new' ? newVideoPanel() : ''}
    ` : '';
    $('#playlistDetail', el).innerHTML = `<section class="card" style="margin-top:18px">
      <div class="row" style="align-items:center;gap:14px"><div class="main"><h2>${esc(selected.title)}</h2><p class="page-sub">${esc(selected.description || '')}</p></div>
      <button class="btn btn-soft btn-sm" type="button" data-act="closePlaylist">Close</button></div>
      ${addPanel}
      <h3 style="margin-top:18px">Videos (${visibleVideos.length})</h3>
      ${visibleVideos.length ? `<div class="lec-grid">${visibleVideos.map(v => `<article class="lec">
        <button class="tn" type="button" data-act="watchPlaylistVideo" data-id="${esc(v.id)}"><img src="${esc(v.thumbnail_url || ytThumb(v.video_id))}" alt="" loading="lazy"></button>
        <div class="bd"><h3>${esc(v.title)}</h3><small>${esc(v.description || '')}</small></div>
        <div class="actions"><button class="btn btn-primary btn-sm" type="button" data-act="watchPlaylistVideo" data-id="${esc(v.id)}">Watch</button>
        ${staff && own ? `<button class="btn btn-outline-danger btn-sm" type="button" data-act="removePlaylistVideo" data-id="${esc(v.id)}">Remove</button>` : ''}</div>
      </article>`).join('')}</div>` : empty('No videos have been added to this playlist yet.')}</section>`;
  }

  function existingPanel() {
    return `<div class="card" style="margin:12px 0"><h3>Add Existing Video</h3>
      <p class="page-sub">Choose a lecture already saved in EduSphere’s Recorded Lectures. Its existing YouTube video and thumbnail will appear in this playlist.</p>
      <form id="existingLectureForm" class="form">
        <label>Recorded lecture<select name="lecture_id" required>${options(existingLectures.map(l => ({value:l.id,label:l.title + (l.subject ? ' · ' + l.subject : '')})), '', 'Choose an existing lecture')}</select></label>
        <div class="actions"><button class="btn btn-primary" type="submit" ${existingLectures.length ? '' : 'disabled'}>Add selected video</button><button class="btn btn-soft" type="button" data-act="cancelAdd">Cancel</button></div><p class="fine" data-existing-status role="status" aria-live="polite"></p>
        ${existingLectures.length ? '' : '<small>No unused recorded lectures are available for this playlist.</small>'}
      </form></div>`;
  }

  function newVideoPanel() {
    return `<div class="card" style="margin:12px 0"><h3>Add New Video</h3>
      <p class="page-sub">Use the same YouTube Unlisted link method as Recorded Lectures. Add a separate thumbnail for this video.</p>
      <form id="newPlaylistVideoForm" class="form">
        <label>Video title<input name="title" required maxlength="120"></label>
        <label>YouTube link or video ID<input name="video" required placeholder="https://youtu.be/xxxxxxxxxxx"></label>
        <label>Description<textarea name="description" maxlength="1000"></textarea></label>
        <label>Video thumbnail <small>JPG/PNG/WEBP · max 2 MB</small><input name="thumb" type="file" accept="image/jpeg,image/png,image/webp" required></label>
        <label class="check"><input name="publish" type="checkbox" checked> Publish this video to approved students</label>
        <div class="actions"><button class="btn btn-primary" type="submit">Save video in playlist</button><button class="btn btn-soft" type="button" data-act="cancelAdd">Cancel</button></div>
      </form></div>`;
  }

  async function addExisting(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-existing-status]');
    const id = String(new FormData(form).get('lecture_id') || '');
    const lecture = existingLectures.find(l => l.id === id);
    if (!lecture) {
      if (status) status.textContent = 'Please choose a recorded lecture first.';
      return toast('Choose an existing recorded lecture.', 'bad');
    }
    if (!selected || !selected.id) return toast('Please reopen the playlist and try again.', 'bad');
    if (videos.some(v => v.video_id === lecture.video_id)) {
      if (status) status.textContent = 'This video is already in the playlist.';
      return toast('This video is already in the playlist.', 'bad');
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Adding video…'; }
    if (status) status.textContent = 'Saving video to this playlist…';
    try {
      const { data, error } = await sb.from('playlist_videos').insert({
        playlist_id: selected.id, created_by: me, sort_order: videos.length,
        title: lecture.title, description: lecture.description || '', video_id: lecture.video_id,
        thumbnail_url: lecture.thumbnail_url || null, is_published: !!lecture.is_published
      }).select('id').single();
      if (error) throw error;
      if (!data?.id) throw new Error('The database did not confirm that the playlist video was saved.');
      toast('Existing Recorded Lecture added to playlist.', 'good');
      addMode = '';
      await openPlaylist(selected.id);
    } catch (err) {
      const message = err?.message || String(err);
      if (status) status.textContent = 'Could not add video: ' + message;
      fail(err, 'Could not add this recorded lecture to the playlist.');
    } finally {
      if (btn && form.isConnected) { btn.disabled = false; btn.textContent = 'Add selected video'; }
    }
  }

  async function addNew(e) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const videoId = ytId(f.get('video'));
    if (!videoId) return toast('Enter a valid YouTube link or 11-character video ID.', 'bad');
    const title = String(f.get('title') || '').trim();
    if (!title) return toast('Enter a video title.', 'bad');
    const btn = e.submitter; btn.disabled = true;
    try {
      const thumbnail_url = await uploadThumb(form.elements.thumb.files[0], me);
      const { data, error } = await sb.from('playlist_videos').insert({
        playlist_id: selected.id, created_by: me, sort_order: videos.length,
        title, description: String(f.get('description') || '').trim(), video_id: videoId,
        thumbnail_url, is_published: !!f.get('publish')
      }).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You are not allowed to add a video to this playlist.');
      toast('New video added to playlist.', 'good');
      await openPlaylist(selected.id);
    } catch (err) { fail(err); }
    finally { btn.disabled = false; }
  }

  function watchVideo(id) {
    const v = videos.find(x => x.id === id);
    if (!v) return;
    openModal(`<h2 id="modalTitle">${esc(v.title)}</h2>
      <div class="actions" style="justify-content:flex-end"><button class="btn btn-soft btn-sm" id="playlistExpand" type="button">⛶ Full screen</button></div>
      <div class="player playlist-player"><iframe title="${esc(v.title)}" src="https://www.youtube-nocookie.com/embed/${esc(v.video_id)}?rel=0&modestbranding=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen webkitallowfullscreen mozallowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      ${v.description ? `<p>${esc(v.description)}</p>` : ''}`, {xl:true});
    const player = document.querySelector('#modalBody .playlist-player');
    const expand = document.querySelector('#playlistExpand');
    expand?.addEventListener('click', () => {
      const full = player.classList.toggle('playlist-player-fullscreen');
      expand.classList.toggle('playlist-expand-fixed', full);
      expand.textContent = full ? '✕ Exit full screen' : '⛶ Full screen';
    });
  }

  await loadPlaylists();
  actions(el, {
    openPlaylist: ({id}) => openPlaylist(id),
    closePlaylist: () => { selected = null; videos = []; $('#playlistDetail', el).innerHTML = ''; },
    showAddOptions: () => { addMode = 'options'; drawDetail(); },
    chooseExisting: async () => {
      addMode = 'existing'; existingLectures = []; drawDetail();
      const panel = $('#playlistDetail', el);
      const hint = document.createElement('p'); hint.className = 'page-sub'; hint.textContent = 'Loading available recorded lectures…';
      const form = panel.querySelector('#existingLectureForm');
      if (form) form.before(hint);
      try { await loadExistingLectures(); drawDetail(); }
      catch (err) { hint.textContent = err?.message || 'Could not load recorded lectures.'; hint.className = 'note warn'; }
    },
    chooseNew: () => { addMode = 'new'; drawDetail(); },
    cancelAdd: () => { addMode = ''; drawDetail(); },
    watchPlaylistVideo: ({id}) => watchVideo(id),
    removePlaylistVideo: async ({id}) => {
      if (!await confirmDialog({title:'Remove this video from the playlist?', text:'The original Recorded Lecture will remain in EduSphere.', confirm:'Remove video'})) return;
      const {error} = await sb.from('playlist_videos').delete().eq('id', id);
      if (error) return fail(error);
      toast('Video removed from playlist.', 'good');
      await openPlaylist(selected.id);
    },
    deletePlaylist: async ({id}) => {
      const p = playlists.find(x => x.id === id);
      if (!await confirmDialog({title:'Delete this playlist?', text:`"${p?.title || 'Playlist'}" and its playlist entries will be deleted. Original Recorded Lectures will remain unchanged.`, confirm:'Delete playlist'})) return;
      const {error} = await sb.from('course_playlists').delete().eq('id', id);
      if (error) return fail(error);
      if (selected?.id === id) { selected = null; $('#playlistDetail', el).innerHTML = ''; }
      toast('Playlist deleted.', 'good');
      await loadPlaylists();
    }
  });

  el.addEventListener('submit', e => {
    if (e.target.id === 'existingLectureForm') { e.preventDefault(); addExisting(e); }
    if (e.target.id === 'newPlaylistVideoForm') { e.preventDefault(); addNew(e); }
  });

}
