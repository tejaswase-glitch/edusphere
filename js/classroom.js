import { sb, state, $ } from './core.js';

const params = new URLSearchParams(location.search);
const classId = params.get('classId');
const status = (s) => { $('#roomStatus').textContent = s; };
const toast = (s) => { $('#roomToast').textContent = s; };
let api = null, connection = null, room = null, recorder = null, streams = [], chunks = [], audioContext = null, objectUrl = null;
let localTracks = [], localAudioTrack = null, localVideoTrack = null, remoteTrackNodes = new Map();
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
  const sourceTrack = localVideoTrack?.getTrack?.();
  if (!sourceTrack || sourceTrack.readyState !== 'live' || localVideoTrack.isMuted()) throw new Error('The classroom camera is off or unavailable. Turn the classroom camera on and retry.');
  if (!cameraStream || !cameraStream.getVideoTracks().some(t=>t.readyState==='live')) {
    // Reuse the exact Jitsi camera track. Do not clone or reopen the camera device.
    cameraStream = new MediaStream([sourceTrack]);
  }
  if (recordVideo) { recordVideo.srcObject=cameraStream; await recordVideo.play(); }
  return cameraStream;
}

function stopTracks() {
  if (recordVideo) { recordVideo.remove(); recordVideo=null; }
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
    video=document.createElement('video'); video.muted=true; video.playsInline=true; video.autoplay=true;
    video.setAttribute('aria-label','Teacher camera preview');
    video.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:0';
    document.body.appendChild(video);
    recordVideo=video;
    if(cameraStream){
      video.srcObject=cameraStream;
      await video.play();
      if(video.readyState<2) await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Shared Jitsi camera opened but no video frames arrived. Check that your classroom camera is on.')),6000);
        const ready=()=>{clearTimeout(timer);resolve();};
        const failed=()=>{clearTimeout(timer);reject(new Error('Camera video could not be read by the recorder.'));};
        video.addEventListener('loadeddata',ready,{once:true});
        video.addEventListener('error',failed,{once:true});
        if(video.readyState>=2) ready();
      });
      if(!video.videoWidth||!video.videoHeight) throw new Error('The shared Jitsi camera has no video frames. Check the camera control and retry.');
    }
    recordCanvas=document.createElement('canvas'); recordCanvas.width=854; recordCanvas.height=480;
    const ctx=recordCanvas.getContext('2d');
    const drawTeachingFrame=()=>{
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
    const canvasStream=recordCanvas.captureStream(8);
    const canvasVideoTrack=canvasStream.getVideoTracks()[0];
    if(!canvasVideoTrack || canvasVideoTrack.readyState!=='live') throw new Error('The browser could not create a live recording video track. Update Chrome and retry.');
    const output=new MediaStream([canvasVideoTrack,...micStream.getAudioTracks()]);
    if(output.getVideoTracks().length!==1 || output.getAudioTracks().length!==1) throw new Error('The recording stream is incomplete. Check camera and microphone permissions.');
    chunks=[];
    const mimeCandidates=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
    const supportedMimes=mimeCandidates.filter(t=>MediaRecorder.isTypeSupported(t));
    const recorderOptions=[...supportedMimes.map(mimeType=>({mimeType,videoBitsPerSecond:400000,audioBitsPerSecond:64000})),{videoBitsPerSecond:400000,audioBitsPerSecond:64000},{}];
    let startError=null;
    for(const options of recorderOptions){
      try{
        recorder=new MediaRecorder(output,options);
        recorder.ondataavailable=e=>{if(e.data && e.data.size)chunks.push(e.data);};
        recorder.onerror=e=>{status('Recorder error: ' + (e?.error?.message || 'The browser could not encode this video.'));};
        recorder.onstop=()=>{video?.remove();finishRecording();};
        recorder.start(1000);
        startError=null;
        break;
      }catch(err){startError=err;recorder=null;}
    }
    if(startError) throw new Error('Android browser could not start the video encoder ('+(startError.message||'unsupported video source')+'). Try updating Chrome.'); 
    paint();
    modeObserver=new MutationObserver(async()=>{
      if(!pdfMode()&&!cameraStream&&recorder?.state==='recording'){
        try { const s=await ensureCamera(); video.srcObject=s; await video.play().catch(()=>{}); }
        catch(e){toast('Camera access was not allowed. PDF recording can continue, but whiteboard mode needs camera permission.');}
      }
    });
    modeObserver.observe($('#pdfViewer'),{attributes:true,attributeFilter:['class']});
    $('#recordStart').disabled=true; $('#recordStart').textContent='● Recording'; $('#recordStop').disabled=false; $('#recordStop').classList.remove('hidden');
    $('#switchCamera')?.classList.add('hidden');
    status(pdfMode()?'RECORDING: PDF slides + teacher microphone. Close the PDF to switch to the whiteboard camera.':'RECORDING: whiteboard camera + teacher microphone. Open a PDF to switch to slide recording.');
  } catch(e) {
    video?.remove(); recordVideo=null; stopTracks();
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
  $('#pdfClose').textContent='← Back to Camera';
  $('#pdfClose').addEventListener('click',async()=>{if(isTeacher){$('#pdfViewer').classList.remove('active');document.querySelector('.room-shell')?.classList.remove('pdf-active');pdfDoc=null;await sendPdfState('pdf-presentation',{closed:true});}});
  pdfChannel = sb.channel('class-pdf-' + classId);
  pdfChannel.on('broadcast',{event:'pdf-presentation'},({payload})=>{if(!isTeacher){if(payload?.closed){$('#pdfViewer').classList.remove('active');pdfDoc=null;}else if(payload?.url) showPdf(payload.url,payload.name,payload.page);}});
  pdfChannel.on('broadcast',{event:'pdf-page'},({payload})=>{if(!isTeacher && pdfDoc) renderPdfPage(payload.page);});
  pdfChannel.subscribe();

  $('#recordStop').addEventListener('click',stopRecording);
  

  try {
    const {data:ticket,error:ticketError}=await sb.functions.invoke('jaas-token',{body:{classId}});
    if(ticketError){let m=ticketError.message;try{m=(await ticketError.context.json()).error||m}catch{}throw new Error(m)}
    if(!ticket?.token || !ticket?.roomName || !ticket?.appId) throw new Error(ticket?.error || 'Secure meeting token missing.');
    await new Promise((resolve,reject)=>{if(window.JitsiMeetJS)return resolve();const s=document.createElement('script');s.src='https://8x8.vc/libs/lib-jitsi-meet.min.js';s.onload=()=>window.JitsiMeetJS?resolve():reject(new Error('Jitsi low-level SDK did not initialize.'));s.onerror=()=>reject(new Error('Could not load the Jitsi meeting SDK.'));document.head.appendChild(s)});
    JitsiMeetJS.init({disableAudioLevels:true});
    status('Opening the shared classroom camera and microphone… Please allow both permissions.');
    localTracks=await JitsiMeetJS.createLocalTracks({devices:['audio','video'],constraints:{video:{height:{ideal:480,max:720},width:{ideal:854,max:1280}}}});
    localAudioTrack=localTracks.find(t=>t.getType()==='audio');
    localVideoTrack=localTracks.find(t=>t.getType()==='video');
    if(!localAudioTrack || !localVideoTrack) throw new Error('Could not create both classroom camera and microphone tracks.');
    const preview=$('#localPreview');
    await localVideoTrack.attach(preview);
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
      room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED,()=>status('Connected · Live classroom. Your camera and microphone are shared with the class.'));
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
    $('#toggleCamera').addEventListener('click',async()=>{
      try{if(localVideoTrack.isMuted()){await localVideoTrack.unmute();$('#toggleCamera').textContent='Turn Camera Off';}else{await localVideoTrack.mute();$('#toggleCamera').textContent='Turn Camera On';}
      if(cameraStream)cameraStream.getVideoTracks().forEach(t=>t.enabled=!localVideoTrack.isMuted());}
      catch(e){status('Camera control failed: '+(e?.message||e));}
    });
  } catch(e) { status(e.message || 'Could not connect to the classroom.'); }
}
window.addEventListener('beforeunload',e=>{if(recorder?.state==='recording'){e.preventDefault();e.returnValue='';}});
init();
