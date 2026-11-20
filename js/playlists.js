// Course playlists with an individual thumbnail for every video.
import { sb, state, $, esc, toast, fail, confirmDialog, ytId, subjectArt } from './core.js';
import { empty, actions, loading } from './ui.js';
import { getCourses } from './data.js';
const BUCKET='lecture-thumbnails', MAX=2*1024*1024;
const imagePath=(uid,file)=>`${uid}/playlists/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
async function upload(file,uid){
 if(!file)return null;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose JPG, PNG or WEBP.');
 if(file.size>MAX)throw new Error('Image must be 2 MB or smaller.');
 const path=imagePath(uid,file),{error}=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type,cacheControl:'3600'});
 if(error)throw error; return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
export async function playlistsView(el){
 const staff=state.profile.role!=='student',admin=state.profile.role==='admin',me=state.user.id;
 let courses=[],playlists=[],videos=[],selected=null,editing=null,videoEditing=null;
 courses=staff?await getCourses():[];
 el.innerHTML=`<h1>Course Playlists</h1><p class="page-sub">${staff?'Organize recorded lessons into playlists under your courses.':'Watch recorded lessons grouped by course.'}</p>
 ${staff?`<section class="card" id="plFormCard"></section>`:''}<section><div id="plList"></div><div id="plDetail"></div></section>`;
 function form(){
  const p=editing||{};
  $('#plFormCard').innerHTML=`<h3>${editing?'Edit playlist':'Create playlist'}</h3><form id="plForm" class="form">
   <label>Playlist title<input name="title" required maxlength="120" value="${esc(p.title||'')}"></label>
   <label>Course<select name="course_id" required><option value="">Choose course</option>${courses.filter(c=>c.is_active||c.id===p.course_id).map(c=>`<option value="${c.id}" ${c.id===p.course_id?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label>
   <label>Description<textarea name="description" maxlength="600">${esc(p.description||'')}</textarea></label>
   <label>Playlist thumbnail <small>JPG/PNG/WEBP, max 2 MB</small><input name="thumb" type="file" accept="image/jpeg,image/png,image/webp"></label>
   <label class="check"><input name="publish" type="checkbox" ${p.is_published?'checked':''}> Publish playlist to approved students</label>
   <div class="actions"><button class="btn btn-primary" type="submit"> ${editing?'Save playlist':'Create playlist'}</button>${editing?'<button class="btn btn-soft" type="button" data-act="cancel">Cancel</button>':''}</div></form>`;
  $('#plForm').onsubmit=savePlaylist;
 }
 async function savePlaylist(e){
  e.preventDefault();const f=new FormData(e.currentTarget),btn=e.submitter;btn.disabled=true;
  try{
   const thumb=await upload(e.currentTarget.elements.thumb.files[0],me);
   const row={title:String(f.get('title')).trim(),course_id:f.get('course_id'),description:String(f.get('description')||'').trim(),is_published:!!f.get('publish'),...(thumb?{thumbnail_url:thumb}:{})};
   const res=editing?await sb.from('course_playlists').update(row).eq('id',editing.id).select('id'):await sb.from('course_playlists').insert({...row,created_by:me}).select('id');
   if(res.error)throw res.error;if(!res.data?.length)throw new Error('You cannot manage this playlist or selected course.');
   toast(editing?'Playlist updated.':'Playlist created.','good');editing=null;form();await load();
  }catch(err){fail(err);}finally{btn.disabled=false;}
 }
 async function load(){
  loading($('#plList'));const {data,error}=await sb.from('course_playlists').select('id,course_id,title,description,thumbnail_url,created_by,is_published,created_at,courses(title)').order('created_at',{ascending:false});
  if(error){$('#plList').innerHTML=`<div class="note warn">${esc(error.message)}</div>`;return;}
  playlists=data||[];draw();
 }
 function draw(){
  $('#plList').innerHTML=playlists.length?`<div class="playlist-grid">${playlists.map(p=>`<article class="playlist-card"><img src="${esc(p.thumbnail_url||subjectArt(p.courses?.title))}" alt="" loading="lazy"><div class="bd"><h3>${esc(p.title)}</h3><small>${esc(p.courses?.title||'Course')} · ${p.is_published?'Published':'Draft'}</small><p>${esc(p.description||'')}</p><div class="actions"><button class="btn btn-primary btn-sm" data-act="open" data-id="${p.id}">Open playlist</button>${staff&&(admin||p.created_by===me)?`<button class="btn btn-soft btn-sm" data-act="edit" data-id="${p.id}">Edit</button><button class="btn btn-outline-danger btn-sm" data-act="del" data-id="${p.id}">Delete</button>`:''}</div></div></article>`).join('')}</div>`:empty('No playlists have been published yet.');
 }
 async function open(id){
  selected=playlists.find(p=>p.id===id);if(!selected)return;
  const {data,error}=await sb.from('playlist_videos').select('*').eq('playlist_id',id).order('sort_order').order('created_at');
  if(error){fail(error);return;}videos=data||[];
  drawDetail();
 }
 function drawDetail(){
  const own=admin||selected.created_by===me;
  $('#plDetail').innerHTML=`<section class="card" style="margin-top:18px"><h2>${esc(selected.title)}</h2><p class="page-sub">${esc(selected.description||'')}</p>
  ${staff&&own?`<h3>${videoEditing?'Edit video':'Add a video to this playlist'}</h3><form id="vidForm" class="form">
   <label>Video title<input name="title" required maxlength="120" value="${esc(videoEditing?.title||'')}"></label>
   <label>YouTube link or video ID<input name="video" required value="${esc(videoEditing?.video_id||'')}" placeholder="YouTube link"></label>
   <label>Video thumbnail <small>Separate image for this video · JPG/PNG/WEBP · max 2 MB</small><input name="thumb" type="file" accept="image/jpeg,image/png,image/webp"></label>
   <label>Description<textarea name="description" maxlength="600">${esc(videoEditing?.description||'')}</textarea></label>
   <label class="check"><input name="publish" type="checkbox" ${videoEditing?videoEditing.is_published?'checked':'':'checked'}> Publish this video</label>
   <div class="actions"><button class="btn btn-primary" type="submit">${videoEditing?'Save video':'Add video'}</button>${videoEditing?'<button class="btn btn-soft" type="button" data-act="cancelVideo">Cancel</button>':''}</div></form>`:''}
  <div class="playlist-videos" style="margin-top:16px">${videos.length?videos.filter(v=>staff||v.is_published).map((v,i)=>`<article class="playlist-video"><img src="${esc(v.thumbnail_url||'https://i.ytimg.com/vi/'+v.video_id+'/hqdefault.jpg')}" alt=""><div><b>${esc(v.title)}</b><small>${v.is_published?'Published':'Draft'}</small><div class="actions"><button class="btn btn-primary btn-sm" data-act="watchVideo" data-id="${v.id}">Watch</button>${staff&&own?`<button class="btn btn-soft btn-sm" data-act="editVideo" data-id="${v.id}">Edit</button><button class="btn btn-outline-danger btn-sm" data-act="delVideo" data-id="${v.id}">Delete</button>`:''}</div></div></article>`).join(''):empty('No videos in this playlist yet.')}</div></section>`;
  const vf=$('#vidForm');if(vf)vf.onsubmit=saveVideo;
 }
 async function saveVideo(e){
  e.preventDefault();const f=new FormData(e.currentTarget),id=ytId(f.get('video'));if(!id)return toast('Enter a valid YouTube link or video ID.','bad');
  const btn=e.submitter;btn.disabled=true;
  try{
   const thumb=await upload(e.currentTarget.elements.thumb.files[0],me);
   const row={title:String(f.get('title')).trim(),video_id:id,description:String(f.get('description')||'').trim(),is_published:!!f.get('publish'),...(thumb?{thumbnail_url:thumb}:{})};
   const res=videoEditing?await sb.from('playlist_videos').update(row).eq('id',videoEditing.id).select('id'):await sb.from('playlist_videos').insert({...row,playlist_id:selected.id,created_by:me,sort_order:videos.length}).select('id');
   if(res.error)throw res.error;if(!res.data?.length)throw new Error('You cannot change this video.');
   toast(videoEditing?'Video updated.':'Video added.','good');videoEditing=null;await open(selected.id);
  }catch(err){fail(err);}finally{btn.disabled=false;}
 }
 if(staff)form();await load();
 actions(el,{
  cancel:()=>{editing=null;form();},
  cancelVideo:()=>{videoEditing=null;drawDetail();},
  open:({id})=>open(id),
  edit:({id})=>{editing=playlists.find(x=>x.id===id);form();el.scrollIntoView({behavior:'smooth'});},
  del:async({id})=>{const p=playlists.find(x=>x.id===id);if(!await confirmDialog({title:'Delete playlist?',text:'This permanently deletes its playlist videos too.',confirm:'Delete playlist'}))return;const {error}=await sb.from('course_playlists').delete().eq('id',id);if(error)return fail(error);selected=null;$('#plDetail').innerHTML='';await load();},
  editVideo:({id})=>{videoEditing=videos.find(v=>v.id===id);drawDetail();},
  delVideo:async({id})=>{if(!await confirmDialog({title:'Delete video?',text:'This removes the video from this playlist.',confirm:'Delete video'}))return;const {error}=await sb.from('playlist_videos').delete().eq('id',id);if(error)return fail(error);await open(selected.id);},
  watchVideo:({id})=>{const v=videos.find(x=>x.id===id);if(!v)return;const d=document.createElement('dialog');d.className='dlg dlg-xl';d.innerHTML=`<button class="dlg-x" type="button">×</button><h2>${esc(v.title)}</h2><div class="player"><iframe title="${esc(v.title)}" src="https://www.youtube-nocookie.com/embed/${esc(v.video_id)}?rel=0&modestbranding=1" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div><p>${esc(v.description||'')}</p>`;document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();}
 });
}
