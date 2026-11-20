// Shared helpers + Supabase client. Only the PUBLIC anon key is ever used here.
export const cfg = window.EDUSPHERE_CONFIG || {};
export const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  && !/YOUR[-_]/i.test(cfg.SUPABASE_URL) && !/YOUR[-_]/i.test(cfg.SUPABASE_ANON_KEY));

export let sb = null;
export let sdkError = null;
// Do not block the entire app while the remote Supabase SDK downloads.
// The public navigation and dialog buttons can initialise immediately.
export const sdkReady = configured
  ? import('https://esm.sh/@supabase/supabase-js@2.45.4')
      .then(m => {
        sb = m.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'edusphere-auth' },
        });
        return sb;
      })
      .catch(e => {
        sdkError = e;
        console.error('Could not load Supabase SDK', e);
        return null;
      })
  : Promise.resolve(null);

export const state = { profile: null, user: null };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const niceDate = s => s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const niceDay = s => s ? new Date(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const localInput = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export function relTime(s) {
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 60) return 'just now';
  const u = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [604800, 'week']];
  let out = 'a while ago';
  for (let i = u.length - 1; i >= 0; i--) if (sec >= u[i][0]) { const n = Math.floor(sec / u[i][0]); out = `${n} ${u[i][1]}${n > 1 ? 's' : ''} ago`; break; }
  return sec > 2419200 ? niceDay(s) : out;
}
export const initials = n => (String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
export const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'there';

// YouTube: accepts a link or an 11-character ID. Returns the ID or null.
export const ytId = v => {
  v = String(v || '').trim();
  const m = v.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : (/^[\w-]{11}$/.test(v) ? v : null);
};
// Google Meet links only (host check, https only).
export function isMeetUrl(u) {
  try { const x = new URL(String(u).trim()); return x.protocol === 'https:' && ['meet.google.com', 'g.co'].includes(x.hostname) && (x.hostname !== 'g.co' || x.pathname.startsWith('/meet')); }
  catch { return false; }
}
export const subjectArt = s => {
  const k = String(s || '').toLowerCase();
  return ['biology', 'mathematics', 'physics', 'chemistry'].find(n => k.includes(n.slice(0, 4))) ? `assets/${['biology', 'mathematics', 'physics', 'chemistry'].find(n => k.includes(n.slice(0, 4)))}.svg` : 'assets/generic.svg';
};
export const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;

// ---------- Toast ----------
let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + (kind === true ? 'bad' : kind);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'bad' || kind === true ? 6000 : 3800);
}
export const fail = (e, fallback = 'Something went wrong.') => toast(e?.message || fallback, 'bad');

// ---------- Dialogs ----------
const modalDlg = () => $('#modalDlg');
export function openModal(inner, { xl = false } = {}) {
  const d = modalDlg(); $('#modalBody').innerHTML = inner;
  d.classList.toggle('dlg-xl', xl); if (!d.open) d.showModal();
  return d;
}
export function closeModal() { const d = modalDlg(); if (d.open) d.close(); }
export function confirmDialog({ title, text, confirm = 'Delete', danger = true }) {
  return new Promise(res => {
    const d = $('#confirmDlg'); $('#confirmTitle').textContent = title; $('#confirmText').textContent = text;
    const yes = $('#confirmYes'), no = $('#confirmNo'); yes.textContent = confirm; yes.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    const done = v => { yes.onclick = no.onclick = null; d.onclose = null; if (d.open) d.close(); res(v); };
    yes.onclick = () => done(true); no.onclick = () => done(false); d.onclose = () => done(false);
    d.showModal(); no.focus();
  });
}
