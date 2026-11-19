import { sb, state, $ } from './core.js';

const params = new URLSearchParams(location.search);
const classId = params.get('classId');
const status = (s) => { $('#roomStatus').textContent = s; };
let roomToastTimer = null;
const toast = (s) => { const el=$('#roomToast'); if(!el)return; el.textContent=s; el.classList.add('show'); clearTimeout(roomToastTimer); roomToastTimer=setTimeout(()=>el.classList.remove('show'),4000); };
let api = null, connection = null, room = null, recorder = null, streams = [], chunks = [], audioContext = null, objectUrl = null;
let localTracks = [], localAudioTrack = null, localVideoTrack = null, remoteTrackNodes = new Map();
let micStream = null, cameraStream = null, recordCanvas = null, recordFrame = 0, modeObserver = null, recordVideo = null, cameraFacing = 'environment';
let pdfDoc = null, pdfPage = 1, pdfChannel = null, pdfJs = null, isTeacher = false, currentPdfUrl = null, pendingPdfFile = null;
const incomingPdfTransfers = new Map();
let classEndedForStudents = false;
let pdfChannelReady = false;
let pdfChannelReadyPromise = null;
const participantNames = new Map();
function showClassEnded(){
  const shell=document.querySelector('.room-shell');
  if(shell){shell.innerHTML='<main class="ended-screen"><div class="ended-card"><h1>Class ended</h1><p>The teacher has ended this class. Thank you for joining EduSphere.</p></div></main>';}
}
function renderRoster(){
  const list=$('#participantList'); if(!list)return;
  const entries=[['You ('+(state.profile?.full_name||state.profile?.role||'Participant')+')',true],...Array.from(participantNames.entries()).map(([id,name])=>[name,false])];
  list.innerHTML=entries.map(([name,local])=>'<li>'+ (local?'● ':'') + name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '</li>').join('');
  $('#participantCount').textContent=String(entries.length);
}
function addChatMessage(name,message,own=false){
 const box=$('#chatMessages');if(!box)return;
 const item=document.createElement('p');item.className='chat-line'+(own?' own':'');
 const who=document.createElement('b');who.textContent=name+': ';
 const body=document.createElement('span');body.textContent=message;
 item.append(who,body);box.append(item);box.scrollTop=box.scrollHeight;
}
async function sendChat(){
 const input=$('#chatInput'),message=(input?.value||'').trim();if(!message||!pdfChannel)return;
 if(!pdfChannelReady){toast('Chat is connecting. Please try again in a moment.');return;}
 const payload={name:state.profile?.full_name||state.profile?.role||'Participant',message:message.slice(0,500),sentAt:Date.now()};
 try{const {error}=await pdfChannel.send({type:'broadcast',event:'class-chat',payload});if(error)throw error;addChatMessage(payload.name,payload.message,true);input.value='';}
 catch(e){toast('Chat message could not be sent. Check the class connection.');}
}
async function enableStudentMic(){
 if(isTeacher||!room)return;
 try{
  if(localAudioTrack){
   if(localAudioTrack.isMuted()){await localAudioTrack.unmute();$('#enableMic').textContent='Mute microphone';status('Your microphone is on.');}
   else{await localAudioTrack.mute();$('#enableMic').textContent='Turn microphone on';status('Your microphone is muted.');}
   return;
  }
  const tracks=await JitsiMeetJS.createLocalTracks({devices:['audio']});localAudioTrack=tracks.find(t=>t.getType()==='audio');if(!localAudioTrack)throw new Error('Microphone unavailable.');await room.addTrack(localAudioTrack);localTracks.push(localAudioTrack);$('#enableMic').textContent='Mute microphone';status('Your microphone is on. The teacher and class can hear you.');
 }catch(e){toast('Could not enable microphone: '+(e.message||e));}
}

const pdfStatus = (s) => { $('#pdfStatus').textContent = s; };
async function loadPdfJs() {
  if (pdfJs) return pdfJs;
  pdfJs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfJs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  return pdfJs;
}
async function showPdf(url, name, page = 1) {
  try {
    pdfStatus('Loading PDF…');
    const lib = await loadPdfJs();
    pdfDoc = await lib.getDocument({url}).promise;
    currentPdfUrl = url;
    $('#pdfViewer').classList.add('active');
    document.querySelector('.room-shell')?.classList.add('pdf-active');
    $('#pdfName').textContent = name || 'Class PDF';
    await renderPdfPage(Math.min(Math.max(1, Number(page) || 1), pdfDoc.numPages));
    pdfStatus('PDF is being presented in this class.');
  } catch (e) { pdfStatus('Could not open PDF: ' + (e.message || 'unknown error')); }
}
async function renderPdfPage(n) {
  if (!pdfDoc) return;
  pdfPage = Math.min(Math.max(1, n), pdfDoc.numPages);
  const page = await pdfDoc.getPage(pdfPage);
  const wrap = $('.pdf-canvas-wrap');
  const availableWidth = Math.max(240, wrap.clientWidth - 12);
  const base = page.getViewport({scale:1});
  // Fit the PDF to the full available screen width; long portrait pages scroll vertically.
  // Render at device pixel ratio for sharper text on high-density phone screens.
  const cssScale = Math.max(.25, availableWidth / base.width);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({scale:cssScale * dpr});
  const canvas = $('#pdfCanvas'), ctx = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
  canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
  canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
  wrap.scrollTop = 0;
  await page.render({canvasContext:ctx,viewport}).promise;
  $('#pdfPage').textContent = 'Page ' + pdfPage + ' / ' + pdfDoc.numPages;
  $('#pdfPrev').disabled = pdfPage <= 1; $('#pdfNext').disabled = pdfPage >= pdfDoc.numPages;
}

function pdfBytesToBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000){binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));}return btoa(binary);}
function pdfBase64ToBytes(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++){bytes[i]=binary.charCodeAt(i);}return bytes;}
async function sharePdfTemporarily(file){
 if(!room)throw new Error('The live class is not connected yet.');
 if(file.size>5*1024*1024)throw new Error('Temporary PDF sharing is limited to 5 MB. Save larger PDFs manually.');
 pendingPdfFile=file;$('#pdfSave').classList.remove('hidden');$('#pdfSave').disabled=false;$('#pdfSave').textContent='Save to EduSphere';
 await showPdf(URL.createObjectURL(file),file.name,1);
 const id=crypto.randomUUID(),bytes=new Uint8Array(await file.arrayBuffer()),chunkSize=12000,total=Math.ceil(bytes.length/chunkSize);
 room.sendEndpointMessage('',{eduspherePdf:'start',id:id,name:file.name,size:file.size,total:total});
 for(let index=0;index<total;index++){const chunk=bytes.subarray(index*chunkSize,Math.min(bytes.length,(index+1)*chunkSize));room.sendEndpointMessage('',{eduspherePdf:'chunk',id:id,index:index,data:pdfBytesToBase64(chunk)});await new Promise(resolve=>setTimeout(resolve,40));}
 room.sendEndpointMessage('',{eduspherePdf:'end',id:id});pdfStatus('Shared temporarily. Not saved to EduSphere.');
}
async function savePendingPdf(){
 if(!pendingPdfFile)return pdfStatus('No PDF selected to save.');
 const file=pendingPdfFile,button=$('#pdfSave');button.disabled=true;button.textContent='Saving…';
 try{
  const path=state.user.id+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const up=await sb.storage.from('study-materials').upload(path,file,{contentType:'application/pdf',upsert:false});if(up.error)throw up.error;
  const row=await sb.from('materials').insert({title:file.name.replace(/\.pdf$/i,''),subject:'Live class',description:'Shared during live class',file_path:path,file_name:file.name,content_type:'application/pdf',uploaded_by:state.user.id,is_published:true});
  if(row.error){await sb.storage.from('study-materials').remove([path]);throw row.error;}
  button.textContent='Saved ✓';pdfStatus('PDF saved to EduSphere study materials.');
 }catch(e){button.disabled=false;button.textContent='Save to EduSphere';pdfStatus('Could not save PDF: '+(e.message||e));}
}
async function sendPdfState(event, payload) {
  if (!pdfChannel) return;
  const {error} = await pdfChannel.send({type:'broadcast',event,payload});
  if (error) pdfStatus('Could not sync PDF with students. Check connection.');
}


function pdfMode() { return $('#pdfViewer').classList.contains('active') && $('#pdfCanvas').width > 0; }
async function ensureCamera() {
  const sourceTrack = localVideoTrack?.getTrack?.();
  if (!sourceTrack || sourceTrack.readyState !== 'live' || localVideoTrack.isMuted()) throw new Error('The classroom camera is off or unavailable. Turn the classroom camera on and retry.');
  // Keep a MediaStream wrapper for track validation only. Do not attach the
  // Jitsi-owned camera track to a second video element: Android Chrome can
  // reject that second video source with "Could not start video source".
  if (!cameraStream || !cameraStream.getVideoTracks().some(t=>t.readyState==='live')) {
    cameraStream = new MediaStream([sourceTrack]);
  }
  return cameraStream;
}

function stopTracks() {
  // localPreview belongs to the live Jitsi classroom; never remove it.
  recordVideo=null;
  if (recordFrame) cancelAnimationFrame(recordFrame);
  recordFrame=0;
  if (modeObserver) modeObserver.disconnect();
  modeObserver=null;
  // These streams wrap Jitsi-owned tracks. Never stop them here: Jitsi must
  // keep the teacher camera and microphone alive after recording ends.
  streams=[];
  micStream=null; cameraStream=null;
  if (audioContext) { audioContext.close().catch(()=>{}); audioContext=null; }
}
function finishRecording() {
  const mime = recorder?.mimeType || 'video/webm';
  const blob = new Blob(chunks, {type:mime});
  $('#recordStart').disabled = false;
  $('#recordStart').textContent = '● Start Recording';
  $('#recordStop').disabled = true;
  $('#recordStop').textContent = 'Stop & Save';
  $('#recordStop').classList.add('hidden');
  stopTracks();
  if (!blob.size) {
    status('Recording stopped, but no video data was captured. Please try a short 10-second test again.');
    toast('No video file was created. Check microphone permission and try again.');
    return;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'edusphere-lecture-' + new Date().toISOString().slice(0,16).replace(/[:T]/g,'-') + '.webm';
  a.textContent = '⬇ Download Lecture Video';
  a.setAttribute('role','button');
  a.style.cssText = 'display:block;width:max-content;max-width:100%;margin:12px auto;padding:14px 18px;border-radius:10px;background:#e8f4ed;color:#174c31;font-size:16px;font-weight:800;text-decoration:none;text-align:center';
  $('#roomToast').replaceChildren(document.createTextNode('Video ready (' + (blob.size/1024/1024).toFixed(2) + ' MB). Tap below to save it to your phone.'), a);
  status('Recording stopped and video finalized. Tap Download Lecture Video below. Find the saved file in Chrome Downloads.');
}
async function startRecording() {
  if (!confirm('Record the teacher microphone and teaching view only (PDF slides or whiteboard camera)? Student audio/video will not be included. Make sure everyone has consented.')) return;
  $('#recordStart').disabled=true; $('#recordStart').textContent='Starting…';
  status('Consent accepted. Checking recording support…');
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    $('#recordStart').disabled=false; $('#recordStart').textContent='● Start Recording';
    status('Recording is not supported in this browser. Open this classroom in the latest Chrome browser.'); return;
  }
  let video=null;
  try {
    status('Preparing the shared Jitsi microphone and camera tracks…');
    if (!localAudioTrack || !localVideoTrack) throw new Error('The shared classroom camera and microphone are not ready. Rejoin the class and allow both permissions.');
    const sourceAudioTrack = localAudioTrack.getTrack();
    if (!sourceAudioTrack || sourceAudioTrack.readyState !== 'live') throw new Error('The classroom microphone track is unavailable. Rejoin the class and allow microphone access.');
    // Reuse the teacher's Jitsi microphone track; remote student tracks are never added.
    micStream = new MediaStream([sourceAudioTrack]);
    if (!pdfMode()) await ensureCamera();
    // Draw from the existing Jitsi preview element. Android Chrome may fail
    // when the same camera track is attached to a second video element.
    video=$('#localPreview');
    recordVideo=video;
    if(!pdfMode()){
      if(video.readyState<2) await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('The live classroom preview has not produced video frames. Check that your camera is on.')),6000);
        const ready=()=>{clearTimeout(timer);resolve();};
        video.addEventListener('loadeddata',ready,{once:true});
        video.addEventListener('playing',ready,{once:true});
        if(video.readyState>=2) ready();
      });
      if(!video.videoWidth||!video.videoHeight) throw new Error('The live classroom camera preview has no video frames. Turn your camera on and retry.');
    }
    recordCanvas=document.createElement('canvas'); recordCanvas.width=1280; recordCanvas.height=720;
    const ctx=recordCanvas.getContext('2d');
    const drawTeachingFrame=()=>{
      const W=1280,H=720; ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
      if(pdfMode()){
        const source=$('#pdfCanvas');
        if(source.width>0&&source.height>0){
          const wrap=$('.pdf-canvas-wrap');
          const viewW=Math.max(1,wrap.clientWidth), viewH=Math.max(1,wrap.clientHeight);
          const ratioX=source.width/viewW, ratioY=source.height/Math.max(1,parseFloat(source.style.height)||source.height);
          const cropW=Math.min(source.width,viewW*ratioX), cropH=Math.min(source.height,viewH*ratioY);
          const sx=Math.max(0,(source.width-cropW)/2), sy=Math.min(Math.max(0,wrap.scrollTop*ratioY),Math.max(0,source.height-cropH));
          ctx.drawImage(source,sx,sy,cropW,cropH,0,0,W,H);
        }
      } else if(video.readyState>=2&&video.videoWidth){
        const scale=Math.max(W/video.videoWidth,H/video.videoHeight),sw=W/scale,sh=H/scale,sx=(video.videoWidth-sw)/2,sy=(video.videoHeight-sh)/2;
        ctx.drawImage(video,sx,sy,sw,sh,0,0,W,H);
      } else {
        ctx.fillStyle='#263858';ctx.font='bold 32px system-ui';ctx.textAlign='center';
        ctx.fillText('Waiting for whiteboard camera…',W/2,H/2);
      }
    };
    const paint=()=>{
      drawTeachingFrame();
      // Do not toggle source-track enabled state here: that would mute the live
      // classroom for students while recording a PDF. The canvas alone changes view.
      recordFrame=requestAnimationFrame(paint);
    };
    // Android Chrome may reject MediaRecorder.start() if canvas.captureStream()
    // has not produced a frame yet. Draw synchronously before creating the stream.
    drawTeachingFrame();
    const canvasStream=recordCanvas.captureStream(30);
    const canvasVideoTrack=canvasStream.getVideoTracks()[0];
    if(!canvasVideoTrack || canvasVideoTrack.readyState!=='live') throw new Error('The browser could not create a live recording video track. Update Chrome and retry.');
    const output=new MediaStream([canvasVideoTrack,...micStream.getAudioTracks()]);
    if(output.getVideoTracks().length!==1 || output.getAudioTracks().length!==1) throw new Error('The recording stream is incomplete. Check camera and microphone permissions.');
    chunks=[];
    const mimeCandidates=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
    const supportedMimes=mimeCandidates.filter(t=>MediaRecorder.isTypeSupported(t));
    const recorderOptions=[...supportedMimes.map(mimeType=>({mimeType,videoBitsPerSecond:4500000,audioBitsPerSecond:160000})),{videoBitsPerSecond:4500000,audioBitsPerSecond:160000},{}];
    let startError=null;
    for(const options of recorderOptions){
      try{
        recorder=new MediaRecorder(output,options);
        recorder.ondataavailable=e=>{if(e.data && e.data.size)chunks.push(e.data);};
        recorder.onerror=e=>{status('Recorder error: ' + (e?.error?.message || 'The browser could not encode this video.'));};
        recorder.onstop=()=>{finishRecording();};
        recorder.start(1000);
        startError=null;
        break;
      }catch(err){startError=err;recorder=null;}
    }
    if(startError) throw new Error('Android browser could not start the video encoder ('+(startError.message||'unsupported video source')+'). Try updating Chrome.'); 
    paint();
    modeObserver=new MutationObserver(async()=>{
      if(!pdfMode()&&!cameraStream&&recorder?.state==='recording'){
        try { await ensureCamera(); }
        catch(e){toast('Camera access was not allowed. PDF recording can continue, but whiteboard mode needs camera permission.');}
      }
    });
    modeObserver.observe($('#pdfViewer'),{attributes:true,attributeFilter:['class']});
    $('#recordStart').disabled=true; $('#recordStart').textContent='● Recording'; $('#recordStop').disabled=false; $('#recordStop').classList.remove('hidden');
    $('#recordStop').classList.remove('hidden');
    $('#switchCamera')?.classList.add('hidden');
    status(pdfMode()?'RECORDING: PDF slides + teacher microphone. Close the PDF to switch to the whiteboard camera.':'RECORDING: whiteboard camera + teacher microphone. Open a PDF to switch to slide recording.');
  } catch(e) {
    recordVideo=null; stopTracks();
    const reason=e?.message || String(e);
    status('Recording did not start: ' + reason);
    toast('Recording did not start: ' + reason);
    $('#recordStart').disabled=false;
    $('#recordStop').classList.add('hidden');
  }
}
function stopRecording() {
  if (!recorder || recorder.state === 'inactive') {
    status('No active recording was found. Start a new recording first.');
    return;
  }
  $('#recordStop').disabled = true;
  $('#recordStop').textContent = 'Saving…';
  status('Stopping recording and preparing your video… Please wait.');
  try { if (recorder.state === 'recording') recorder.requestData(); recorder.stop(); }
  catch(e) {
    $('#recordStop').disabled = false;
    $('#recordStop').textContent = 'Stop & Save';
    status('Could not stop recording: ' + (e?.message || String(e)));
  }
}

function bindLeaveButton() {
  const button = $('#leaveRoom');
  if (!button || button.dataset.bound === 'yes') return;
  button.dataset.bound = 'yes';
  button.addEventListener('click', async () => {
    if (button.dataset.leaving === 'yes') return;
    if (recorder?.state === 'recording' && !confirm('A recording is running. Stop it before leaving? Your video must finish processing before you leave.')) return;
    button.dataset.leaving = 'yes';
    button.disabled = true;
    button.textContent = 'Leaving…';
    const destination = new URL('./', location.href).href;
    const finish = () => { location.replace(destination); };
    if (recorder?.state === 'recording') {
      recorder.addEventListener('stop', finish, {once:true});
      stopRecording();
      setTimeout(finish, 1800);
    } else {
      try { await room?.leave(); } catch {} try { connection?.disconnect(); } catch {}
      finish();
    }
  });
}
async function init() {
  bindLeaveButton();
  if (!sb || !classId) { status('Cannot open class. Sign in through EduSphere and try again.'); return; }
  const {data:{session}} = await sb.auth.getSession();
  if (!session) { status('Your session expired. Sign in to EduSphere again.'); return; }
  state.user = session.user;
  const {data:profile,error:profileError} = await sb.from('profiles').select('id,full_name,role,status').eq('id',session.user.id).single();
  if (profileError || !profile || profile.status !== 'approved') { status('Your EduSphere account is not approved.'); return; }
  state.profile = profile;
  const {data:c,error} = await sb.from('live_classes').select('id,title,subject,course_id,provider,status,created_by,is_published').eq('id',classId).maybeSingle();
  if (error || !c || c.provider !== 'jitsi') { status('This class is unavailable.'); return; }
  if (c.status !== 'scheduled') { if (c.status === 'completed' || c.status === 'ended') { status('This class has ended.'); showClassEnded(); } else status('This class is unavailable.'); return; }
  const teacher = profile.role === 'admin' || (profile.role === 'teacher' && c.created_by === profile.id);
  isTeacher = teacher;
  if(!teacher){['pdfPrev','pdfNext','pdfClose'].forEach(id=>$('#'+id)?.classList.add('hidden'));}
  if (profile.role === 'student' && !c.is_published) { status('This class is not published for students.'); return; }
  if(!teacher){$('#recordNote').classList.add('hidden');$('#localPreview')?.closest('.participant-tile')?.classList.add('hidden');$('#toggleCamera')?.classList.add('hidden');$('#switchCamera')?.classList.add('hidden');$('#toggleMic')?.classList.add('hidden');}
  $('#roomTitle').textContent = c.title || 'EduSphere Live Classroom';
  $('#roomUser').textContent = (profile.full_name || profile.role) + ' · ' + profile.role;
  if (teacher) {
    $('#pdfUploadLabel').classList.remove('hidden');
    $('#recordStart').classList.remove('hidden');
    $('#endForStudents').classList.remove('hidden');
    $('#recordNote').classList.add('hidden');
  } else $('#recordNote').classList.add('hidden');
  $('#recordStart').addEventListener('click',startRecording);
  $('#recordStop').addEventListener('click',stopRecording);
  $('#pdfFile').addEventListener('change',async e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){pdfStatus('Please choose a PDF file.');return;}
    if(file.size>50*1024*1024){pdfStatus('PDF must be 50 MB or smaller.');return;}
    try{pdfStatus('Sharing PDF temporarily…');await sharePdfTemporarily(file);await sendPdfState('pdf-presentation',{name:file.name,page:1,closed:false,temporary:true});}
    catch(err){pdfStatus(err.message||'Could not share PDF.');}finally{e.target.value='';}
  });
  $('#pdfSave').addEventListener('click',savePendingPdf);
  $('#pdfPrev').addEventListener('click',async()=>{if(pdfDoc){await renderPdfPage(pdfPage-1);if(isTeacher)await sendPdfState('pdf-page',{page:pdfPage});}});
  $('#pdfNext').addEventListener('click',async()=>{if(pdfDoc){await renderPdfPage(pdfPage+1);if(isTeacher)await sendPdfState('pdf-page',{page:pdfPage});}});
  $('#pdfViewer').addEventListener('click',e=>e.stopPropagation());
  $('#pdfClose').textContent='← Back to Camera';$('#pdfSave').classList.add('hidden');$('#pdfSave').disabled=false;$('#pdfSave').textContent='Save to EduSphere';
  $('#pdfClose').addEventListener('click',async()=>{
    $('#pdfViewer').classList.remove('active');document.querySelector('.room-shell')?.classList.remove('pdf-active');pdfDoc=null;
    if(isTeacher) await sendPdfState('pdf-presentation',{closed:true});
  });
  pdfChannel = sb.channel('class-pdf-' + classId,{config:{broadcast:{self:false}}});
  pdfChannel.on('broadcast',{event:'pdf-presentation'},({payload})=>{if(!isTeacher){if(payload?.closed){$('#pdfViewer').classList.remove('active');pdfDoc=null;}else if(payload?.url) showPdf(payload.url,payload.name,payload.page);}});
  pdfChannel.on('broadcast',{event:'pdf-page'},({payload})=>{if(!isTeacher && pdfDoc) renderPdfPage(payload.page);});
  pdfChannel.on('broadcast',{event:'class-chat'},({payload})=>{if(payload?.message)addChatMessage(payload.name||'Participant',String(payload.message).slice(0,500));});
  pdfChannel.on('broadcast',{event:'class-ended'},()=>{if(!isTeacher){status('The teacher has ended this class.');try{room?.leave();}catch{}try{connection?.disconnect();}catch{}showClassEnded();}});
  pdfChannel.on('broadcast',{event:'pdf-presentation'},({payload})=>{if(!isTeacher&&payload?.closed){$('#pdfViewer').classList.remove('active');pdfDoc=null;}});
  pdfChannelReadyPromise = new Promise(resolve=>{
    pdfChannel.subscribe((channelStatus)=>{
      pdfChannelReady = channelStatus === 'SUBSCRIBED';
      if(pdfChannelReady) resolve(true);
      if(channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT' || channelStatus === 'CLOSED') resolve(false);
    });
    setTimeout(()=>resolve(pdfChannelReady),8000);
  });

  $('#recordStop').addEventListener('click',stopRecording);
  $('#chatSend')?.addEventListener('click',sendChat);
  $('#chatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendChat();}});
  $('#enableMic')?.addEventListener('click',enableStudentMic);
  $('#menuToggle')?.addEventListener('click',()=>{const menu=$('#controlMenu');const opening=!menu?.classList.contains('open');if(opening){$('#chatPanel')?.classList.add('hidden');$('#rosterPanel')?.classList.add('hidden');}menu?.classList.toggle('open',opening);$('#menuToggle')?.setAttribute('aria-expanded',opening?'true':'false');});
  $('#showChat')?.addEventListener('click',()=>{const p=$('#chatPanel');const opening=p?.classList.contains('hidden');$('#rosterPanel')?.classList.add('hidden');p?.classList.toggle('hidden');if(opening)setTimeout(()=>$('#chatInput')?.focus(),80);});
  $('#closeChat')?.addEventListener('click',()=>{$('#chatPanel')?.classList.add('hidden');});
  $('#showRoster')?.addEventListener('click',()=>{const p=$('#rosterPanel');const opening=p?.classList.contains('hidden');$('#chatPanel')?.classList.add('hidden');p?.classList.toggle('hidden');});
  document.addEventListener('click',e=>{
    if(!e.target.closest('.menu-wrap')){$('#controlMenu')?.classList.remove('open');$('#menuToggle')?.setAttribute('aria-expanded','false');}
    const action=e.target.closest('#controlMenu button, #controlMenu label');
    if(action && action.id!=='menuToggle' && !e.target.closest('#pdfUploadLabel')) { $('#controlMenu')?.classList.remove('open');$('#menuToggle')?.setAttribute('aria-expanded','false'); }
  });
  $('#endForStudents')?.addEventListener('click',async()=>{
    if(!isTeacher)return;
    if(!confirm('End this class for all students? You will remain in the classroom to finish and save your recording.'))return;
    $('#endForStudents').disabled=true;$('#endForStudents').textContent='Ending…';
    try{
      const {data:ended,error}=await sb.from('live_classes').update({status:'completed'}).eq('id',classId).eq('created_by',state.user.id).eq('status','scheduled').select('id').maybeSingle();
      if(error)throw error;
      if(!ended)throw new Error('Supabase did not confirm the class update. Check teacher permissions and class status.');
      const ready = await Promise.race([pdfChannelReadyPromise || Promise.resolve(pdfChannelReady),new Promise(resolve=>setTimeout(()=>resolve(false),8000))]);
      if(!ready)throw new Error('Class status was updated, but the student notification channel is not connected. Keep this page open and retry notification.');
      const {error:broadcastError}=await pdfChannel.send({type:'broadcast',event:'class-ended',payload:{ended:true}});
      if(broadcastError)throw broadcastError;
    }catch(e){$('#endForStudents').disabled=false;$('#endForStudents').textContent='End Class for Students';toast('Could not end the class: '+(e.message||e));return;}
    $('#endForStudents').textContent='Class ended for students';
    status('Class ended for students. You are still in the classroom. Stop & Save your recording, wait for the video-ready message, then Leave Class.');
    toast('Students have been dismissed. New students cannot join this ended class. Finish saving your recording before leaving.');
  });
  

  try {
    const {data:ticket,error:ticketError}=await sb.functions.invoke('jaas-token',{body:{classId}});
    if(ticketError){let m=ticketError.message;try{m=(await ticketError.context.json()).error||m}catch{}throw new Error(m)}
    if(!ticket?.token || !ticket?.roomName || !ticket?.appId) throw new Error(ticket?.error || 'Secure meeting token missing.');
    await new Promise((resolve,reject)=>{if(window.JitsiMeetJS)return resolve();const s=document.createElement('script');s.src='https://8x8.vc/libs/lib-jitsi-meet.min.js';s.onload=()=>window.JitsiMeetJS?resolve():reject(new Error('Jitsi low-level SDK did not initialize.'));s.onerror=()=>reject(new Error('Could not load the Jitsi meeting SDK.'));document.head.appendChild(s)});
    JitsiMeetJS.init({disableAudioLevels:true});
    status('Opening the shared classroom camera and microphone… Please allow both permissions.');
    if(isTeacher){
      localTracks=await JitsiMeetJS.createLocalTracks({devices:['audio','video'],constraints:{video:{height:{ideal:720,max:720},width:{ideal:1280,max:1280},frameRate:{ideal:30,max:30}}}});
      localAudioTrack=localTracks.find(t=>t.getType()==='audio');localVideoTrack=localTracks.find(t=>t.getType()==='video');
      if(!localAudioTrack||!localVideoTrack)throw new Error('Could not create both classroom camera and microphone tracks.');
      const preview=$('#localPreview');await localVideoTrack.attach(preview);preview.style.setProperty('transform','none','important');preview.style.setProperty('-webkit-transform','none','important');preview.style.setProperty('object-fit','cover','important');
    }else{localTracks=[];localAudioTrack=null;localVideoTrack=null;$('#enableMic')?.classList.remove('hidden');}
    const roomOnly=ticket.roomName.slice(ticket.roomName.indexOf('/')+1);
    const options={
      hosts:{domain:'8x8.vc',muc:'conference.'+ticket.appId+'.8x8.vc',focus:'focus.8x8.vc'},
      serviceUrl:'wss://8x8.vc/'+ticket.appId+'/xmpp-websocket?room='+encodeURIComponent(roomOnly),
      conferenceRequestUrl:'https://8x8.vc/'+ticket.appId+'/conference-request/v1?room='+encodeURIComponent(roomOnly),
      websocketKeepAliveUrl:'https://8x8.vc/'+ticket.appId+'/_unlock?room='+encodeURIComponent(roomOnly),
      hiddenDomain:'recorder.8x8.vc',
      p2p:{enabled:true},disableAudioLevels:true
    };
    connection=new JitsiMeetJS.JitsiConnection(null,ticket.token,options);
    connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,async()=>{
      room=connection.initJitsiConference(roomOnly,options);
       try{room.setDisplayName?.(state.profile?.full_name||state.profile?.role||'Participant');}catch{}
      room.on(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED,(sender,payload)=>{
        if(!payload)return;
        if(payload.edusphereChat===true && typeof payload.message==='string'){
          const senderId=String(sender||'');
          const ownName=state.profile?.full_name||'';
          addChatMessage(payload.name||'Participant',payload.message.slice(0,500),false);
          return;
        }
        if(payload.edusphereClassAction==='end' && !isTeacher){
          classEndedForStudents=true;status('The teacher has ended this class.');
          try{room?.leave();}catch{} try{connection?.disconnect();}catch{}
          showClassEnded();return;
        }
        if(isTeacher||!payload.eduspherePdf)return;
        if(payload.eduspherePdf==='start'){incomingPdfTransfers.set(payload.id,{name:payload.name,total:payload.total,chunks:new Array(payload.total),received:0});}
        else if(payload.eduspherePdf==='chunk'){const t=incomingPdfTransfers.get(payload.id);if(!t||t.chunks[payload.index])return;t.chunks[payload.index]=pdfBase64ToBytes(payload.data);t.received++;}
        else if(payload.eduspherePdf==='end'){const t=incomingPdfTransfers.get(payload.id);if(!t)return;if(t.received!==t.total){incomingPdfTransfers.delete(payload.id);return pdfStatus('PDF transfer incomplete. Ask teacher to share again.');}const url=URL.createObjectURL(new Blob(t.chunks,{type:'application/pdf'}));incomingPdfTransfers.delete(payload.id);showPdf(url,t.name,1);pdfStatus('PDF received temporarily; not saved to your account.');}
      });
      room.on(JitsiMeetJS.events.conference.TRACK_ADDED,track=>{
        if(track.isLocal()) return;
        const type=track.getType(), node=document.createElement(type==='video'?'video':'audio');
        node.autoplay=true;node.playsInline=true;
        if(type==='video'){
          const tile=document.createElement('div');tile.className='participant-tile';tile.dataset.track=track.getId();
          const name=document.createElement('span');name.textContent='Participant';
          tile.append(node,name);$('#participantGrid').append(tile);remoteTrackNodes.set(track.getId(),{node,tile});
        } else {node.style.display='none';document.body.append(node);remoteTrackNodes.set(track.getId(),{node,tile:null});}
        track.attach(node);
      });
      room.on(JitsiMeetJS.events.conference.TRACK_REMOVED,track=>{
        const item=remoteTrackNodes.get(track.getId());if(item){track.detach(item.node);item.tile?.remove();item.node.remove();remoteTrackNodes.delete(track.getId());}
      });
      room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED,()=>{
        status('Connected · Live classroom. Your camera and microphone are shared with the class.');
        try{for(const p of room.getParticipants?.()||[]){const id=p.getId?.();if(id)participantNames.set(id,p.getDisplayName?.()||'Participant');}}catch{}
        renderRoster();
      });
      room.on(JitsiMeetJS.events.conference.USER_JOINED,(id,user)=>{participantNames.set(id,user?.getDisplayName?.()||'Participant');renderRoster();if(isTeacher)toast((user?.getDisplayName?.()||'A student')+' joined the class.');});
      room.on(JitsiMeetJS.events.conference.USER_LEFT,(id)=>{const name=participantNames.get(id)||'A participant';participantNames.delete(id);renderRoster();if(isTeacher)toast(name+' left the class.');});
      room.on(JitsiMeetJS.events.conference.CONFERENCE_LEFT,()=>status('You left the live classroom.'));
      try{await Promise.all(localTracks.map(t=>room.addTrack(t)));await room.join();}
      catch(e){status('Could not join the live room: '+(e?.message||e));}
    });
    connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED,()=>status('Jitsi connection failed. Check your internet and try again.'));
    connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,()=>status('Jitsi disconnected.'));
    connection.connect();
    $('#toggleMic').addEventListener('click',async()=>{
      try{if(localAudioTrack.isMuted()){await localAudioTrack.unmute();$('#toggleMic').textContent='Mute Mic';}else{await localAudioTrack.mute();$('#toggleMic').textContent='Unmute Mic';}
      if(micStream)micStream.getAudioTracks().forEach(t=>t.enabled=!localAudioTrack.isMuted());}
      catch(e){status('Microphone control failed: '+(e?.message||e));}
    });
    $('#switchCamera').addEventListener('click',async()=>{
      const button=$('#switchCamera');
      try{
        button.disabled=true;button.textContent='Switching…';
        const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
        if(!devices.length)throw new Error('No camera was found. Check browser camera permission.');
        const currentId=localVideoTrack?.getTrack?.().getSettings?.().deviceId || localVideoTrack?.getDeviceId?.();
        const currentIndex=devices.findIndex(d=>d.deviceId===currentId);
        const next=devices.length>1?devices[(currentIndex<0?0:currentIndex)+1>=devices.length?0:(currentIndex<0?1:currentIndex+1)]:null;
        const target=next||devices[0];
        const facing=(localVideoTrack?.getTrack?.().getSettings?.().facingMode==='user')?'environment':'user';
        const created=await JitsiMeetJS.createLocalTracks({devices:['video'],cameraDeviceId:target.deviceId,constraints:{video:{deviceId:{exact:target.deviceId},facingMode:{ideal:facing},height:{ideal:720,max:720},width:{ideal:1280,max:1280},frameRate:{ideal:30,max:30}}}});
        const replacement=created.find(t=>t.getType()==='video');
        if(!replacement)throw new Error('Could not open the selected camera.');
        const previous=localVideoTrack;
        await room.replaceTrack(previous,replacement);
        try{previous.detach($('#localPreview'));}catch{}
        try{await previous.dispose();}catch{}
        localVideoTrack=replacement;
        await replacement.attach($('#localPreview'));
        $('#localPreview').style.setProperty('transform','none','important');
        $('#localPreview').style.setProperty('-webkit-transform','none','important');
        $('#localPreview').style.setProperty('object-fit','cover','important');
        localTracks=localTracks.filter(t=>t!==previous);localTracks.push(replacement);
        cameraStream=null;
        status('Camera switched to '+(next.label||'the next camera')+'.');
      }catch(e){status('Could not switch camera: '+(e?.message||e));}
      finally{button.disabled=false;button.textContent='Front / Back';}
    });
    $('#toggleCamera').addEventListener('click',async()=>{
      try{if(localVideoTrack.isMuted()){await localVideoTrack.unmute();$('#toggleCamera').textContent='Turn Camera Off';}else{await localVideoTrack.mute();$('#toggleCamera').textContent='Turn Camera On';}
      if(cameraStream)cameraStream.getVideoTracks().forEach(t=>t.enabled=!localVideoTrack.isMuted());}
      catch(e){status('Camera control failed: '+(e?.message||e));}
    });
  } catch(e) { status(e.message || 'Could not connect to the classroom.'); }
}
window.addEventListener('beforeunload',e=>{if(recorder?.state==='recording'){e.preventDefault();e.returnValue='';}});
init();
