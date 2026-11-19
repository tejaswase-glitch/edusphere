// Legacy dashboard-wide recorder disabled. Recording is available only from the dedicated classroom page.
import { $ } from './core.js';
import { actions } from './ui.js';

export const isRecording = () => false;
export function stopRecording() {}
export async function recorderView(el, { go }) {
  el.innerHTML = `<h1>Class Recording</h1>
    <section class="card">
      <h3>Record only the live classroom</h3>
      <p>The old dashboard screen recorder is disabled so it cannot accidentally capture your dashboard.</p>
      <p>Open <b>Live Classes</b>, join your JaaS class, then use <b>Start Class Recording</b> on the separate classroom page. On Android, use the phone's built-in Screen Recorder while that classroom page stays open.</p>
      <div class="note warn">Choose only the dedicated EduSphere classroom tab/window. Recording can include participant voices or video shown in the class. Obtain consent before recording. Android's built-in recorder behavior and audio capture vary by device.</div>
      <div class="actions"><button class="btn btn-primary" type="button" data-act="classes">Open Live Classes</button></div>
    </section>`;
  actions(el, { classes: () => go('classes') });
}
