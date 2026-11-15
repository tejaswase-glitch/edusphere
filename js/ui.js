// Small UI helpers shared by all views.
import { esc } from './core.js';
export const loading = el => { el.innerHTML = '<div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>'; };
export const empty = text => `<div class="empty">${esc(text)}</div>`;
export const errBox = e => `<div class="note warn" role="alert">${esc(e?.message || String(e))}</div>`;
// One delegated click handler per view: <button data-act="name" data-id="..">
export function actions(el, map) {
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]'); if (!b || !el.contains(b) || b.disabled) return;
    const fn = map[b.dataset.act]; if (!fn) return;
    b.disabled = true;
    try { await fn(b.dataset, b, ev); } finally { b.disabled = false; }
  });
}
export const options = (list, sel = '', blank = '') => (blank !== null ? `<option value="">${esc(blank)}</option>` : '') + list.map(o => { const v = typeof o === 'string' ? o : o.value, t = typeof o === 'string' ? o : o.label; return `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`; }).join('');
export const icon = {
  home: '<path fill="currentColor" d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3Z"/>',
  book: '<path fill="currentColor" d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5V5.5Z"/>',
  play: '<path fill="currentColor" d="M5 4v16l15-8L5 4Z"/>',
  live: '<circle cx="12" cy="12" r="2.4" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.7 4.7a10.4 10.4 0 0 0 0 14.6M19.3 4.7a10.4 10.4 0 0 1 0 14.6"/>',
  doc: '<path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5Z"/>',
  user: '<path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5Z"/>',
  users: '<path fill="currentColor" d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.9 0-7 2-7 4.5V20h14v-2.5C16 15 12.9 13 9 13Zm8-2a3 3 0 1 0-1-5.8A5.9 5.9 0 0 1 16 9c0 .7-.1 1.4-.4 2 .4.1.9 0 1.4 0Zm1 2.2c2.3.6 4 2 4 4.3V20h-4v-2.5c0-1.7-.6-3.200-1.600-4.300.5-.1 1-.1 1.600 0Z"/>',
  shield: '<path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.300 8 11 4.600-1.700 8-6 8-11V5l-8-3Z"/>',
  rec: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.500" fill="currentColor"/>',
  list: '<path fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" d="M8 6h13M8 12h13M8 18h13M3.500 6h.01M3.500 12h.01M3.500 18h.01"/>',
  check: '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.500 4.500 4.500L19 7"/>',
  trophy: '<path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.2A5 5 0 0 1 13 14.900V17h3v2H8v-2h3v-2.100A5 5 0 0 1 8.200 12H8a4 4 0 0 1-4-4V5h3V3Zm-1 4v1a2 2 0 0 0 1.200 1.800A9 9 0 0 1 7 7H6Zm12 0h-1a9 9 0 0 1-.2 2.800A2 2 0 0 0 18 8V7Z"/>',
};
export const svg = (n, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${icon[n] || ''}</svg>`;
