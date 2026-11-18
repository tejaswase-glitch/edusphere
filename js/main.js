// Entry point: public site behaviour + wiring.
import { cfg, sb, $, $$, esc, toast } from './core.js';
import { initAuth, openLogin, openRegister, logout } from './auth.js';
import { initPortal } from './portal.js';

initPortal(); initAuth();

// Dialog plumbing: close buttons, backdrop click, role / register shortcuts.
document.addEventListener('click', e => {
  const t = e.target;
  if (t.matches('dialog')) { const r = t.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) t.close(); }
  const c = t.closest('[data-close]'); if (c) c.closest('dialog').close();
  const l = t.closest('[data-login]'); if (l) { closeNav(); openLogin(l.dataset.login); }
  if (t.closest('[data-register]')) { closeNav(); openRegister(); }
});
$('#sideLogout').addEventListener('click', logout);
$('#topLogout').addEventListener('click', logout);

// Mobile menu
const nav = $('#mainNav'), toggle = $('#menuToggle');
function closeNav() { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
toggle.addEventListener('click', () => { const o = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(o)); });
$$('#mainNav a').forEach(a => a.addEventListener('click', closeNav));
$('#year').textContent = new Date().getFullYear();

// Contact + social (only what the owner filled in config.js)
const contact = [['Email', cfg.CONTACT_EMAIL, v => `mailto:${v}`], ['Phone', cfg.CONTACT_PHONE, v => `tel:${v.replace(/\s/g, '')}`], ['Address', cfg.CONTACT_ADDRESS, null]].filter(c => c[1]);
if (contact.length) { $('#contactGrid').innerHTML = contact.map(([l, v, h]) => `<div class="contact-item"><small>${l}</small>${h ? `<a href="${esc(h(v))}">${esc(v)}</a>` : `<span>${esc(v)}</span>`}</div>`).join(''); }
const social = [['YouTube', cfg.YOUTUBE_URL, 'YT'], ['Facebook', cfg.FACEBOOK_URL, 'f'], ['Telegram', cfg.TELEGRAM_URL, 'TG']].filter(s => /^https:\/\//.test(s[1] || ''));
if (social.length) { $('#followBox').hidden = false; $('#followLinks').innerHTML = social.map(([n, u, s]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${n}">${s}</a>`).join(' '); }

// Public lecture previews: reads ONLY the safe view (title, subject, short description, thumbnail). No video id, no links.
(async () => {
  if (!sb) return;
  const { data, error } = await sb.from('public_lectures').select('id,title,subject,description,thumbnail_url,teacher_name').limit(8);
  if (error || !data?.length) return;
  $('#publicLectureGrid').innerHTML = data.map(l => `<article class="pv-card">${l.thumbnail_url ? `<img src="${esc(l.thumbnail_url)}" alt="" loading="lazy" width="320" height="180">` : '<img src="assets/generic.svg" alt="" loading="lazy" width="320" height="180">'}<div><small>${esc(l.subject)}</small><h4>${esc(l.title)}</h4><p>${esc(l.description || '')}</p><button class="btn btn-play" data-register type="button" style="margin-top:8px">Register to Watch</button></div></article>`).join('');
  $('#publicLectures').hidden = false;
})();

// Installable app (PWA). Relative path so it works under /edusphere/ on GitHub Pages.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const reg = () => navigator.serviceWorker.register('./sw.js?v=20261119-jitsi').catch(e => console.warn('Service worker not registered:', e.message));
  // main.js starts after a top-level await, so 'load' may already have fired.
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
}
