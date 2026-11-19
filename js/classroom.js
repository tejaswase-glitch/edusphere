import { sb, state, $ } from './core.js';

const params = new URLSearchParams(location.search);
const classId = params.get('classId');
const status = (s) => { $('#roomStatus').textContent = s; };
const toast = (s) => { $('#roomToast').textContent = s; };
let api = null, recorder = null, streams = [], chunks = [], audioContext = null, objectUrl = null;
let micStream = null, cameraStream = null, recordCanvas = null, recordFrame = 0, modeObserver = null, recordVideo = null, cameraFacing = 'environment';
let pdfDoc = null, pdfPage = 1, pdfChannel = null, pdfJs = null, isTeacher = false, currentPdfUrl = null;
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
  const availableHeight = Math.max(240, wrap.clientHeight - 12);
  const base = page.getViewport({scale:1});
  const scale = Math.min(availableWidth / base.width, availableHeight / base.height);
  const viewport = page.getViewport({scale:Math.max(.25,scale)});
  const canvas = $('#pdfCanvas'), ctx = canvas.getContext('2d');
  canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
  canvas.style.width = canvas.width + 'px'; canvas.style.height = canvas.height + 'px';
  await page.render({canvasContext:ctx,viewport}).promise;
  $('#pdfPage').textContent = 'Page ' + pdfPage + ' / ' + pdfDoc.numPages;
  $('#pdfPrev').disabled = pdfPage <= 1; $('#pdfNext').disabled = pdfPage >= pdfDoc.numPages;
}
async function sendPdfState(event, payload) {
  if (!pdfChannel) return;
  const {error} = await pdfChannel.send({type:'broadcast',event,payload});
  if (error) pdfStatus('Could not sync PDF with students. Check connection.');
}


function pdfMode() { return $('#pdfViewer').classList.contains('active') && $('#pdfCanvas').width > 0; }
async function ensureCamera() {
  if (cameraStream?.getVideoTracks().some(t=>t.readyState==='live')) return cameraStream;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{exact:cameraFacing}},audio:false});
  } catch (e) {
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:cameraFacing}},audio:false});
  }
  streams.push(cameraStream);
  if (recordVideo) { recordVideo.srcObject=cameraStream; await recordVideo.play().catch(()=>{}); }
  return cameraStream;
}
async function switchRecordingCamera() {
  if (recorder?.state !== 'recording') { status('Start recording before switching the camera.'); return; }
  const next = cameraFacing === 'environment' ? 'user' : 'environment';
  try {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t=>t.stop());
      streams = streams.filter(s=>s!==cameraStream);
      cameraStream = null;
    }
    cameraFacing = next;
    await ensureCamera();
    status('Camera switched to ' + (next==='user'?'front/selfie':'back/rear') + ' camera. This view will be recorded when the PDF is closed.');
  } catch(e) {
    cameraFacing = next==='user'?'environment':'user';
    status('Could not switch camera: ' + (e?.message || String(e)) + '. Check Chrome camera permission.');
  }
}
function stopTracks() {
  if (recordVideo) { recordVideo.remove(); recordVideo=null; }
  $('#switchCamera')?.classList.add('hidden');
  if (recordFrame) cancelAnimationFrame(recordFrame);
  recordFrame=0;
  if (modeObserver) modeObserver.disconnect();
  modeObserver=null;
  streams.forEach(s=>s.getTracks().forEach(t=>t.stop())); streams=[];
  micStream=null; cameraStream=null;
  if (audioContext) { audioContext.close().catch(()=>{}); audioContext=null; }
}
function finishRecording() {
  const mime = recorder?.mimeType || 'video/webm';
  const blob = new Blob(chunks, {type:mime});
  $('#recordStart').disabled = false;
  $('#recordStop').disabled = true;
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
  status('Consent accepted. Checking recording support…');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    status('Recording is not supported in this browser. Open this classroom in the latest Chrome browser.'); return;
  }
  let video=null;
  try {
    status('Requesting microphone permission. Please allow the microphone popup if it appears…');
    micStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    status('Microphone allowed. Preparing the teaching video…');
    streams.push(micStream);
    if (!pdfMode()) { status('Requesting camera permission for whiteboard recording…'); await ensureCamera(); }
    video=document.createElement('video'); video.muted=true; video.playsInline=true; video.autoplay=true;
    video.setAttribute('aria-label','Teacher camera preview');
    video.style.cssText='position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    recordVideo=video;
    if(cameraStream){video.srcObject=cameraStream;await video.play().catch(()=>{});}
    recordCanvas=document.createElement('canvas'); recordCanvas.width=854; recordCanvas.height=480;
    const ctx=recordCanvas.getContext('2d');
    const paint=()=>{
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,854,480);
      if(pdfMode()){
        const source=$('#pdfCanvas');
        if(source.width>0&&source.height>0){
          const scale=Math.min(854/source.width,480/source.height),w=source.width*scale,h=source.height*scale;
          ctx.drawImage(source,(854-w)/2,(480-h)/2,w,h);
        }
      } else if(video.readyState>=2&&video.videoWidth){
        const scale=Math.min(854/video.videoWidth,480/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
        ctx.drawImage(video,(854-w)/2,(480-h)/2,w,h);
      } else {
        ctx.fillStyle='#263858';ctx.font='bold 32px system-ui';ctx.textAlign='center';
        ctx.fillText('Waiting for whiteboard camera…',427,240);
      }
      if(cameraStream) cameraStream.getVideoTracks().forEach(t=>t.enabled=!pdfMode());
      recordFrame=requestAnimationFrame(paint);
    };
    const canvasStream=recordCanvas.captureStream(8);
    const output=new MediaStream([...canvasStream.getVideoTracks(),...micStream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder=new MediaRecorder(output,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:400000,audioBitsPerSecond:64000});
    chunks=[];
    recorder.ondataavailable=e=>{if(e.data && e.data.size)chunks.push(e.data);};
    recorder.onerror=e=>{status('Recorder error: ' + (e?.error?.message || 'The browser could not encode this video.'));};
    recorder.onstop=()=>{video?.remove();finishRecording();};
    recorder.start(1000); paint();
    modeObserver=new MutationObserver(async()=>{
      if(!pdfMode()&&!cameraStream&&recorder?.state==='recording'){
        try { const s=await ensureCamera(); video.srcObject=s; await video.play().catch(()=>{}); }
        catch(e){toast('Camera access was not allowed. PDF recording can continue, but whiteboard mode needs camera permission.');}
      }
    });
    modeObserver.observe($('#pdfViewer'),{attributes:true,attributeFilter:['class']});
    $('#recordStart').disabled=true; $('#recordStop').disabled=false; $('#recordStop').classList.remove('hidden');
    $('#switchCamera').classList.remove('hidden');
    status(pdfMode()?'RECORDING: PDF slides + teacher microphone. Close the PDF to switch to the whiteboard camera.':'RECORDING: whiteboard camera + teacher microphone. Open a PDF to switch to slide recording.');
  } catch(e) {
    video?.remove(); recordVideo=null; stopTracks();
    status('Recording did not start: ' + (e?.message || String(e)) + '. If your camera is already active in Jitsi, turn the Jitsi camera off, then try Start Recording again.');
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
  button.addEventListener('click', () => {
    if (button.dataset.leaving === 'yes') return;
    if (recorder?.state === 'recording' && !confirm('A recording is running. Stop it before leaving?')) return;
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
      try { api?.executeCommand('hangup'); } catch {}
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
  if (error || !c || c.provider !== 'jitsi' || c.status !== 'scheduled') { status('This class is unavailable.'); return; }
  const teacher = profile.role === 'admin' || (profile.role === 'teacher' && c.created_by === profile.id);
  isTeacher = teacher;
  if (profile.role === 'student' && !c.is_published) { status('This class is not published for students.'); return; }
  $('#roomTitle').textContent = c.title || 'EduSphere Live Classroom';
  $('#roomUser').textContent = (profile.full_name || profile.role) + ' · ' + profile.role;
  if (teacher) {
    $('#pdfUploadLabel').classList.remove('hidden');
    $('#recordStart').classList.remove('hidden');
    $('#recordNote').textContent = 'One combined recorder: while a PDF is open it records the slides; when the PDF is closed it records the rear camera/whiteboard. Only the teacher microphone is added. Student audio/video and the dashboard are excluded. The video is saved locally; get consent first.';
  } else $('#recordNote').classList.add('hidden');
  $('#recordStart').addEventListener('click',startRecording);
  $('#pdfFile').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { pdfStatus('Please choose a PDF file.'); return; }
    if (file.size > 50 * 1024 * 1024) { pdfStatus('PDF must be 50 MB or smaller.'); return; }
    try {
      pdfStatus('Uploading PDF…');
      const path = state.user.id + '/' + crypto.randomUUID() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const {error:upError} = await sb.storage.from('study-materials').upload(path,file,{contentType:'application/pdf',upsert:false});
      if (upError) throw upError;
      const {error:rowError} = await sb.from('materials').insert({title:file.name.replace(/\.pdf$/i,''),subject:c.subject || 'Live class',description:'Shared during live class: '+c.title,file_path:path,file_name:file.name,content_type:'application/pdf',uploaded_by:state.user.id,is_published:true,course_id:c.course_id || null});
      if (rowError) throw rowError;
      const {data:signed,error:signedError} = await sb.storage.from('study-materials').createSignedUrl(path,3600,{download:false});
      if (signedError) throw signedError;
      await showPdf(signed.signedUrl,file.name,1);
      await sendPdfState('pdf-presentation',{url:signed.signedUrl,name:file.name,page:1,closed:false});
    } catch(err) { pdfStatus(err.message || 'PDF upload failed.'); }
    finally { e.target.value=''; }
  });
  $('#pdfPrev').addEventListener('click',async()=>{if(isTeacher && pdfDoc){await renderPdfPage(pdfPage-1);await sendPdfState('pdf-page',{page:pdfPage});}});
  $('#pdfNext').addEventListener('click',async()=>{if(isTeacher && pdfDoc){await renderPdfPage(pdfPage+1);await sendPdfState('pdf-page',{page:pdfPage});}});
  $('#pdfClose').textContent='Stop PDF • Return to Live Class';
  $('#pdfClose').addEventListener('click',async()=>{if(isTeacher){$('#pdfViewer').classList.remove('active');document.querySelector('.room-shell')?.classList.remove('pdf-active');pdfDoc=null;await sendPdfState('pdf-presentation',{closed:true});}});
  pdfChannel = sb.channel('class-pdf-' + classId);
  pdfChannel.on('broadcast',{event:'pdf-presentation'},({payload})=>{if(!isTeacher){if(payload?.closed){$('#pdfViewer').classList.remove('active');pdfDoc=null;}else if(payload?.url) showPdf(payload.url,payload.name,payload.page);}});
  pdfChannel.on('broadcast',{event:'pdf-page'},({payload})=>{if(!isTeacher && pdfDoc) renderPdfPage(payload.page);});
  pdfChannel.subscribe();

  $('#recordStop').addEventListener('click',stopRecording);
  $('#switchCamera').addEventListener('click',switchRecordingCamera);

  try {
    const {data:ticket,error:ticketError}=await sb.functions.invoke('jaas-token',{body:{classId}});
    if(ticketError){let m=ticketError.message;try{m=(await ticketError.context.json()).error||m}catch{}throw new Error(m)}
    if(!ticket?.token || !ticket?.roomName) throw new Error(ticket?.error || 'Secure meeting token missing.');
    await new Promise((resolve,reject)=>{if(window.JitsiMeetExternalAPI)return resolve();const s=document.createElement('script');s.src='https://8x8.vc/external_api.js';s.onload=resolve;s.onerror=()=>reject(new Error('Could not load the meeting service.'));document.head.appendChild(s)});
    api=new window.JitsiMeetExternalAPI('8x8.vc',{roomName:ticket.roomName,jwt:ticket.token,parentNode:$('#jitsiFrame'),width:'100%',height:'100%',userInfo:{displayName:profile.full_name||'EduSphere participant'},configOverwrite:{prejoinConfig:{enabled:false},disableInitialGUM:true,startWithAudioMuted:true,startWithVideoMuted:true,toolbarButtons:['microphone','camera','desktop','chat','participants-pane','raisehand','tileview','fullscreen','settings','hangup','select-background','videoquality']},interfaceConfigOverwrite:{MOBILE_APP_PROMO:false,SHOW_JITSI_WATERMARK:false}});
    api.addListener('videoConferenceJoined',()=>status('Connected · Live classroom'));
    api.addListener('readyToClose',()=>{if(recorder?.state==='recording')stopRecording();status('Meeting ended. You can leave this page.');});
  } catch(e) { status(e.message || 'Could not connect to the classroom.'); }
}
window.addEventListener('beforeunload',e=>{if(recorder?.state==='recording'){e.preventDefault();e.returnValue='';}});
init();
