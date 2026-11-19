import { sb, state, $ } from './core.js';

const params = new URLSearchParams(location.search);
const classId = params.get('classId');
const status = (s) => { $('#roomStatus').textContent = s; };
const toast = (s) => { $('#roomToast').textContent = s; };
let api = null, recorder = null, streams = [], chunks = [], audioContext = null, objectUrl = null;

function stopTracks() { streams.forEach(s => s.getTracks().forEach(t => t.stop())); streams = []; if (audioContext) { audioContext.close().catch(()=>{}); audioContext = null; } }
function finishRecording() {
  const blob = new Blob(chunks, {type: recorder?.mimeType || 'video/webm'});
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = objectUrl;
  a.download = 'edusphere-class-' + new Date().toISOString().slice(0,16).replace(/[:T]/g,'-') + '.webm';
  a.textContent = 'Download class recording';
  a.style.cssText = 'display:inline-block;margin:10px 16px;padding:12px 16px;border-radius:8px;background:#e8f4ed;color:#174c31;font-weight:800';
  $('#roomToast').replaceChildren(document.createTextNode('Recording ready. '), a);
  $('#recordStart').disabled = false; $('#recordStop').classList.add('hidden');
  stopTracks();
}
async function startRecording() {
  if (!confirm('Record this class page only? Make sure everyone who may be recorded has given consent.')) return;
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    toast('Browser recording is not supported here. On Android, use the phone Screen Recorder while this dedicated classroom page is open. Do not switch to the dashboard during recording.');
    return;
  }
  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:true,preferCurrentTab:true,selfBrowserSurface:'include'});
    const settings = display.getVideoTracks()[0]?.getSettings?.() || {};
    if (settings.displaySurface && settings.displaySurface !== 'browser') {
      display.getTracks().forEach(t=>t.stop());
      toast('Recording cancelled: please choose the EduSphere classroom browser tab, not the full screen or another window.');
      return;
    }
    let mic = null;
    try { mic = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}); } catch {}
    streams = [display, ...(mic ? [mic] : [])];
    const tracks = [...display.getVideoTracks()];
    const audioTracks = [...display.getAudioTracks(), ...(mic ? mic.getAudioTracks() : [])];
    if (audioTracks.length) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioContext.createMediaStreamDestination();
      audioTracks.forEach(track => audioContext.createMediaStreamSource(new MediaStream([track])).connect(dest));
      tracks.push(...dest.stream.getAudioTracks());
    }
    const out = new MediaStream(tracks);
    const mime = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(out, mime ? {mimeType:mime} : undefined);
    chunks = []; recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    recorder.onstop = finishRecording;
    display.getVideoTracks()[0].addEventListener('ended',()=>{ if(recorder?.state!=='inactive') recorder.stop(); });
    recorder.start(1000);
    $('#recordStart').disabled = true; $('#recordStop').classList.remove('hidden');
    toast('Recording the dedicated classroom tab. Keep this page open; stop when class ends.');
  } catch (e) { display?.getTracks().forEach(t=>t.stop()); stopTracks(); toast(e.message || 'Could not start recording.'); }
}
function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }

async function init() {
  if (!sb || !classId) { status('Cannot open class. Sign in through EduSphere and try again.'); return; }
  const {data:{session}} = await sb.auth.getSession();
  if (!session) { status('Your session expired. Sign in to EduSphere again.'); return; }
  state.user = session.user;
  const {data:profile,error:profileError} = await sb.from('profiles').select('id,full_name,role,status').eq('id',session.user.id).single();
  if (profileError || !profile || profile.status !== 'approved') { status('Your EduSphere account is not approved.'); return; }
  state.profile = profile;
  const {data:c,error} = await sb.from('live_classes').select('id,title,provider,status,created_by,is_published').eq('id',classId).maybeSingle();
  if (error || !c || c.provider !== 'jitsi' || c.status !== 'scheduled') { status('This class is unavailable.'); return; }
  const teacher = profile.role === 'admin' || (profile.role === 'teacher' && c.created_by === profile.id);
  if (profile.role === 'teacher' && !teacher) { status('Teachers can enter only their own classes.'); return; }
  if (profile.role === 'student' && !c.is_published) { status('This class is not published for students.'); return; }
  $('#roomTitle').textContent = c.title || 'EduSphere Live Classroom';
  $('#roomUser').textContent = (profile.full_name || profile.role) + ' · ' + profile.role;
  if (teacher) {
    $('#recordStart').classList.remove('hidden');
    $('#recordNote').textContent = 'Teacher recording: this page is a separate classroom window, so the EduSphere dashboard is not part of the class capture. On Android, use the built-in Screen Recorder and keep this page in front. Recording may include participant audio/video; obtain consent before recording.';
  } else $('#recordNote').classList.add('hidden');
  $('#recordStart').addEventListener('click',startRecording);
  $('#recordStop').addEventListener('click',stopRecording);
  $('#leaveRoom').addEventListener('click',()=>{ if(recorder?.state==='recording' && !confirm('A recording is running. Stop and save it before leaving?')) return; stopRecording(); api?.dispose(); location.href='./'; });
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
