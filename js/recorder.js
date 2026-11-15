// Teacher screen + microphone recorder (getDisplayMedia + getUserMedia(audio only) + MediaRecorder).
// No camera is ever requested. Everything stays in the browser until the teacher downloads the file.
import { $, esc, toast, fail } from './core.js';
import { actions } from './ui.js';

let rec = null, streams = [], chunks = [], ctx = null, timer = null, startedAt = 0, accum = 0, blobUrl = null, mime = '';
export const isRecording = () => !!rec && rec.state !== 'inactive';
const fmt = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(r).padStart(2, '0'); };
const elapsed = () => accum + (rec?.state === 'recording' ? (Date.now() - startedAt) / 1000 : 0);
const warnUnload = e => { e.preventDefault(); e.returnValue = ''; };
const setStatus = (t, on = false) => { const s = $('#recStatus'); if (s) s.innerHTML = `<span class="rec-dot${on ? ' on' : ''}"></span>${esc(t)}`; };
const tick = () => { const t = $('#recTime'); if (t) t.textContent = fmt(elapsed()); };

export function stopRecording(discard = false) {
  clearInterval(timer); timer = null; window.removeEventListener('beforeunload', warnUnload);
  if (rec && rec.state !== 'inactive') { if (discard) rec.onstop = null; try { rec.stop(); } catch { /* already stopped */ } }
  streams.forEach(s => s.getTracks().forEach(t => t.stop())); streams = [];
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
  if (discard) { rec = null; chunks = []; if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; } }
}

export async function recorderView(el, { go }) {
  const supported = !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
  el.innerHTML = `<h1>Record Screen</h1><p class="page-sub">Record your screen, window or browser tab together with your voice.</p>
  <div class="grid-2"><section class="card rec-box">
    <div class="note"><b>Consent notice:</b> Only your screen and your own microphone are recorded. Student cameras are never switched on. If students speak, appear or are visible in what you share, you must have their consent before you record or publish.</div>
    ${supported ? '' : `<div class="note warn"><b>This browser cannot record the screen.</b> On Android phones use the built-in screen recorder (swipe down, "Screen recorder"), or open EduSphere in Chrome on a laptop. Then upload the video to YouTube as Unlisted.</div>`}
    <label class="check"><input type="checkbox" id="recConsent"> I will record only my own screen and voice, or I have consent from anyone else who appears.</label>
    <div><div class="rec-time" id="recTime">0:00</div><div id="recStatus"><span class="rec-dot"></span>Ready</div></div>
    <div class="actions"><button class="btn btn-primary" id="recStart" data-act="start" type="button"${supported ? '' : ' disabled'}>Start Recording</button><button class="btn btn-soft" id="recPause" data-act="pause" type="button" disabled>Pause</button><button class="btn btn-danger" id="recStop" data-act="stop" type="button" disabled>Stop Recording</button></div>
    <video id="recPreview" class="preview" controls playsinline hidden></video>
    <div id="recSave" class="actions"></div>
  </section>
  <section class="card"><h3>How it works</h3><ul class="hint" style="padding-left:18px;display:grid;gap:8px;font-size:14px">
    <li>Press <b>Start Recording</b>, then pick the screen, window or tab. Tick <b>"Share tab audio"</b> if you want the sound of that tab.</li>
    <li>Your microphone is mixed in so students hear your voice.</li>
    <li>Press <b>Stop Recording</b>, check the preview, then <b>Download</b>.</li></ul>
    <div class="note warn" style="margin-top:12px"><b>Limits to know:</b><ul><li>What is recorded depends on the source you choose and your browser permissions.</li><li>Voices of other Google Meet participants are not guaranteed to be captured.</li><li>Browsers usually save <b>WebM</b>, not MP4. YouTube accepts WebM.</li><li>Android browser support varies; use the phone's screen recorder as a fallback.</li><li>Google Meet's own recording needs an eligible paid Google Workspace plan.</li></ul></div>
    <h3 style="margin-top:16px">Publish to Recorded Lectures</h3><ol style="padding-left:18px;display:grid;gap:6px;font-size:14px"><li>Download the recording.</li><li>Upload it to YouTube Studio and set visibility to <b>Unlisted</b>.</li><li>Copy the YouTube link, open Recorded Lectures and paste it into the form.</li></ol>
    <div class="actions" style="margin-top:10px"><a class="btn btn-soft btn-sm" href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">Open YouTube Studio</a><button class="btn btn-primary btn-sm" data-act="publish" type="button">Go to Recorded Lectures</button></div>
    <p class="hint" style="margin-top:8px">Unlisted YouTube links can be shared by anyone who has them. This is not private DRM.</p></section></div>`;
  if (isRecording()) { /* view re-opened while recording: keep going */ }

  actions(el, {
    publish: () => go('lectures'),
    start: async () => {
      if (!$('#recConsent').checked) return toast('Please tick the consent notice first.', 'bad');
      let screen, mic = null;
      try { screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
      catch (e) { return toast(e.name === 'NotAllowedError' ? 'Screen sharing was cancelled or blocked.' : (e.message || 'Could not start screen capture.'), 'bad'); }
      let micMsg = '';
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); }
      catch { micMsg = ' (no microphone: your voice is not being recorded)'; }
      streams = [screen, mic].filter(Boolean);
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)(); const dest = ctx.createMediaStreamDestination(); let audio = false;
        streams.forEach(s => { if (s.getAudioTracks().length) { ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest); audio = true; } });
        const out = new MediaStream([...screen.getVideoTracks(), ...(audio ? dest.stream.getAudioTracks() : [])]);
        mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
        rec = new MediaRecorder(out, mime ? { mimeType: mime } : undefined); chunks = []; accum = 0;
        rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
        rec.onstop = finish;
        screen.getVideoTracks()[0].addEventListener('ended', () => stopRecording(false)); // user pressed the browser's "Stop sharing"
        rec.start(1000); startedAt = Date.now(); timer = setInterval(tick, 500); window.addEventListener('beforeunload', warnUnload);
        if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
        $('#recPreview').hidden = true; $('#recSave').innerHTML = '';
        $('#recStart').disabled = true; $('#recPause').disabled = false; $('#recStop').disabled = false;
        setStatus('Recording' + micMsg, true);
      } catch (e) { stopRecording(true); fail(e, 'Could not start recording.'); }
    },
    pause: () => {
      if (!rec) return;
      if (rec.state === 'recording') { accum = elapsed(); rec.pause(); $('#recPause').textContent = 'Resume'; setStatus('Paused'); }
      else if (rec.state === 'paused') { startedAt = Date.now(); rec.resume(); $('#recPause').textContent = 'Pause'; setStatus('Recording', true); }
    },
    stop: () => { if (isRecording()) { if (rec.state === 'paused') rec.resume(); accum = elapsed(); stopRecording(false); } },
  });
}

function finish() {
  clearInterval(timer); timer = null; window.removeEventListener('beforeunload', warnUnload);
  streams.forEach(s => s.getTracks().forEach(t => t.stop())); streams = [];
  if (!$('#recStatus')) return;
  const type = rec?.mimeType || mime || 'video/webm', ext = type.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type }); blobUrl = URL.createObjectURL(blob);
  const v = $('#recPreview'); v.src = blobUrl; v.hidden = false;
  const mb = (blob.size / 1048576).toFixed(1);
  $('#recSave').innerHTML = `<a class="btn btn-green" href="${blobUrl}" download="edusphere-lecture-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}">Download recording (.${ext}, ${mb} MB)</a>`;
  setStatus(`Stopped · length ${fmt(accum)} · format ${type.split(';')[0]}`);
  $('#recTime').textContent = fmt(accum);
  $('#recStart').disabled = false; $('#recPause').disabled = true; $('#recStop').disabled = true; $('#recPause').textContent = 'Pause';
  if (!blob.size) toast('The recording is empty. Try again and make sure something is shared.', 'bad');
}
