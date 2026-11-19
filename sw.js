// EduSphere service worker: makes the app installable and the shell load offline.
// Network-first for our own files (so updates arrive), cache as fallback. Never touches Supabase/YouTube/other origins,
// and never caches signed URLs, API calls or user data.
const CACHE = 'edusphere-shell-v22';
const SHELL = ['./', 'index.html', 'config.js', 'css/styles.css', 'manifest.webmanifest', 'assets/logo.svg', 'assets/favicon.svg', 'assets/hero.svg', 'assets/banner.svg', 'assets/generic.svg', 'assets/biology.svg', 'assets/mathematics.svg', 'assets/physics.svg', 'assets/chemistry.svg',
  'js/main.js', 'js/core.js', 'js/auth.js', 'js/portal.js', 'js/ui.js', 'js/data.js', 'js/student.js', 'js/admin.js', 'js/courses.js', 'js/lectures.js', 'js/materials.js', 'js/classes.js', 'js/recorder.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
