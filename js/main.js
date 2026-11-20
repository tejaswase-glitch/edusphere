// Entry point: public site behaviour + wiring.
import { cfg, sb, $, $, esc, toast, openModal } from './core.js';
import { initAuth, openLogin, openRegister, logout } from './auth.js';
import { initPortal } from './portal.js?v=20261119-login-shell-fix';
import { getSubjects } from './data.js?v=20261120-homepage-cards';

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

// Contact and social details are editable by Admin > Site Contact & Settings.
async function renderContact(){
 const {data,error}=await sb.from('site_settings').select('*').eq('id','main').maybeSingle();
 if(error)console.warn('Contact settings unavailable:',error.message);
 const d=data||{};
 const items=[
  ['Email',d.contact_email||cfg.CONTACT_EMAIL,v=>`mailto:${v}`],
  ['Phone',d.contact_phone||cfg.CONTACT_PHONE,v=>`tel:${v.replace(/\\s/g,'')}`],
  ['WhatsApp',d.contact_whatsapp,v=>`https://wa.me/${v.replace(/\\D/g,'')}`],
  ['Address',d.contact_address||cfg.CONTACT_ADDRESS,null],
  ['Office hours',d.office_hours,null]
 ].filter(x=>x[1]);
 const grid=$('#contactGrid');
 grid.innerHTML=items.length?items.map(([label,value,href])=>`<div class="contact-item"><small>${label}</small>${href?`<a href="${esc(href(value))}" ${label==='WhatsApp'?'target="_blank" rel="noopener noreferrer"':''}>${esc(value)}</a>`:`<span>${esc(value)}</span>`}</div>`).join(''):`<p class="fine">${esc(d.contact_message||'Questions about registration or approval? Please contact the EduSphere administrator.')}</p>`;
 if(d.contact_message&&items.length)grid.insertAdjacentHTML('beforeend',`<p class="fine">${esc(d.contact_message)}</p>`);
 const social=[['YouTube',d.youtube_url||cfg.YOUTUBE_URL,'YT'],['Facebook',d.facebook_url||cfg.FACEBOOK_URL,'f'],['Telegram',d.telegram_url||cfg.TELEGRAM_URL,'TG']].filter(x=>/^https:\\/\\//i.test(x[1]||''));
 if(social.length){$('#followBox').hidden=false;$('#followLinks').innerHTML=social.map(([n,u,label])=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${n}">${label}</a>`).join(' ');}
}
renderContact();

// Homepage subjects are configured by Admin > Courses & Subjects.

// Never leave the built-in sample cards visible when the database is unavailable or has no visible subjects.
(async()=>{
  const grid=$('#subjectGrid');
  grid.innerHTML='<p class="fine">Loading subjects…</p>';
  if(!sb){grid.innerHTML='<p class="fine">Subjects are temporarily unavailable. Please refresh the page.</p>';return;}
  try{
    const {data,error}=await sb.from('subjects').select('id,name,description,homepage_visible,homepage_order,image_url').order('homepage_order').order('name');
    if(error) throw error;
    const subjects=(data||[]).filter(s=>s.homepage_visible!==false).sort((a,b)=>(Number(a.homepage_order)||0)-(Number(b.homepage_order)||0));
    if(subjects.length) grid.innerHTML=subjects.map((s,i)=>'<article class="subject-card" data-subject="'+esc(s.name)+'"><img src="'+esc(s.image_url||('assets/'+(['biology','mathematics','physics','chemistry'].find(n=>String(s.name).toLowerCase().includes(n))||'generic')+'.svg'))+'" alt="" loading="lazy" width="400" height="300"><div><h3>'+esc(s.name)+'</h3><p class="sc-sub">'+esc(s.description||'Explore lessons and study materials')+'</p><button class="btn btn-play '+(i%2?'alt':'')+'" data-register type="button">Register to Watch</button></div></article>').join('');
    else grid.innerHTML='<p class="fine">No subjects are currently published.</p>';
  }catch(e){console.warn('Could not load admin subjects:',e);grid.innerHTML='<p class="fine">Could not load subjects. Please refresh the page.</p>';}
})();

// Homepage demo lectures: only admin-selected rows are returned by the public-safe RLS policy.
(async()=>{
 if(!sb)return;
 const {data,error}=await sb.from('homepage_lectures').select('id,title,subject,description,video_id,thumbnail_url,visibility').eq('is_active',true).order('created_at',{ascending:false}).limit(12);
 if(error||!data?.length)return;
 $('#homepageDemoGrid').innerHTML=data.map(l=>`<article class="pv-card"><img src="${esc(l.thumbnail_url||'assets/generic.svg')}" alt="" loading="lazy" width="320" height="180"><div><small>${esc(l.subject||'Demo lecture')}</small><h4>${esc(l.title)}</h4><p>${esc(l.description||'Watch this sample lecture')}</p><button class="btn btn-play" type="button" data-demo-watch="${esc(l.id)}">Watch demo</button></div></article>`).join('');
 $('#homepageDemoSection').hidden=false;
 const watch=async e=>{const b=e.target.closest('[data-demo-watch]');if(!b)return;const l=data.find(x=>x.id===b.dataset.demoWatch);if(!l)return;openModal(`<h2 id="modalTitle">${esc(l.title)}</h2><p class="dlg-sub">${esc(l.subject||'')}</p><div class="player"><iframe title="${esc(l.title)}" src="https://www.youtube-nocookie.com/embed/${esc(l.video_id)}?rel=0&modestbranding=1" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><p>${esc(l.description||'')}</p>`,{xl:true});};
 $('#homepageDemoGrid').addEventListener('click',watch);
})();

// Public lecture previews remain registration prompts; they do not expose private video IDs.
(async () => {
 if (!sb) return;
 const { data, error } = await sb.from('public_lectures').select('id,title,subject,description,thumbnail_url,teacher_name').limit(8);
 if (error || !data?.length) return;
 $('#publicLectureGrid').innerHTML = data.map(l => `<article class="pv-card">${l.thumbnail_url ? `<img src="${esc(l.thumbnail_url)}" alt="" loading="lazy" width="320" height="180">` : '<img src="assets/generic.svg" alt="" loading="lazy" width="320" height="180">'}<div><small>${esc(l.subject)}</small><h4>${esc(l.title)}</h4><p>${esc(l.description || '')}</p><button class="btn btn-play" data-register type="button" style="margin-top:8px">Register to Watch</button></div></article>`).join('');
 $('#publicLectures').hidden = false;
})();

// Installable app (PWA). Relative path so it works under /edusphere/ on GitHub Pages.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const reg = () => navigator.serviceWorker.register('./sw.js?v=20261120-demo-contact-playlists').catch(e => console.warn('Service worker not registered:', e.message));
  // main.js starts after a top-level await, so 'load' may already have fired.
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg);
}
