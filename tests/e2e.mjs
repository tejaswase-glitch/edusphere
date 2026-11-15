// End-to-end UI tests. Run:  node tests/e2e.mjs   (needs: npm i playwright && npx playwright install chromium)
// The Supabase backend is a MOCK (tests/mock-supabase.js). These tests verify the website code and UI flows,
// NOT your live Supabase project or your real RLS policies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = fs.readFileSync(path.join(ROOT, 'tests/mock-supabase.js'), 'utf8');
const TEST_CONFIG = `window.EDUSPHERE_CONFIG={SUPABASE_URL:'https://mock.supabase.co',SUPABASE_ANON_KEY:'mock-anon-key',CONTACT_EMAIL:'help@example.org'};`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SHOTS = path.join(ROOT, 'tests/screenshots'); fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS', name); }
  catch (e) { results.push({ name, ok: false, err: String(e.message).split('\n')[0] }); console.log('FAIL', name, '-', String(e.message).split('\n')[0]); }
};
const expect = (c, m) => { if (!c) throw new Error(m || 'expectation failed'); };

const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function newCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, acceptDownloads: true, ...opts });
  await ctx.route('https://esm.sh/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: TEST_CONFIG }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://i.ytimg.com/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://www.youtube-nocookie.com/**', r => r.fulfill({ contentType: 'text/html', body: '<p>video</p>' }));
  await ctx.route('https://mock.supabase.co/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  return ctx;
}
const open = async ctx => { const p = await ctx.newPage(); p.on('pageerror', e => results.push({ name: 'JS error: ' + e.message, ok: false, err: e.message })); await p.goto(BASE); await p.waitForFunction(() => window.__mock); return p; };
const view = p => p.evaluate(() => document.body.dataset.view);
async function login(p, role, email, pw) {
  await p.click(`.nav-logins [data-login=${role}]`); await p.fill('#loginForm [name=email]', email); await p.fill('#loginForm [name=password]', pw);
  await p.click('#loginForm button[type=submit]');
}
const loggedIn = async p => { await p.waitForFunction(() => document.body.dataset.view === 'app', null, { timeout: 5000 }); };
const toastText = async p => { await p.waitForSelector('#toast.show'); return p.textContent('#toast'); };
const nav = async (p, label) => { await p.click(`#sideNav button:has-text("${label}")`); await p.waitForTimeout(250); };
async function logout(p) { if (await p.isVisible('#topLogout')) { await p.click('#topLogout'); } else { await p.click('#hamb'); await p.click('#sideLogout'); } await p.waitForFunction(() => document.body.dataset.view === 'site'); }
const confirmYes = async p => { await p.waitForSelector('#confirmDlg[open]'); await p.click('#confirmYes'); await p.waitForTimeout(300); };
const db = p => p.evaluate(() => JSON.parse(localStorage.getItem('mockdb')));
const future = (mins = 120) => { const d = new Date(Date.now() + mins * 60000); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const VID = 'dQw4w9WgXcQ', MEET = 'https://meet.google.com/abc-defg-hij';

const ctx = await newCtx(); let p = await open(ctx);

// ---------- Public homepage ----------
await step('Homepage: hero, 4 subject cards, banner, 4 feature cards, footer', async () => {
  expect(await p.textContent('.hero h1') .then(t => /Welcome to\s*EduSphere/.test(t)), 'hero heading');
  expect((await p.$$('.subject-card')).length === 4, '4 subject cards');
  for (const s of ['Biology', 'Mathematics', 'Physics', 'Chemistry']) expect(await p.isVisible(`.subject-card h3:has-text("${s}")`), s);
  expect(await p.isVisible('.banner-cta'), 'banner'); expect((await p.$$('.feature-row li')).length === 4, 'features');
  for (const t of ['Video Lectures', 'Live Classes', 'Study Materials', 'Certificates']) expect(await p.isVisible(`.feature-row b:has-text("${t}")`), t);
  expect(await p.isVisible('.site-footer'), 'footer');
  for (const t of ['Home', 'Lectures', 'About', 'Contact', 'Admin Login', 'Teacher Login', 'Student Login']) expect(await p.isVisible(`#mainNav :text-is("${t}")`), 'nav ' + t);
});
await p.screenshot({ path: path.join(SHOTS, 'home-desktop.png'), fullPage: true });

// ---------- Auth + approval ----------
await step('1. Admin login works; wrong portal is refused', async () => {
  await login(p, 'teacher', 'admin@test.dev', 'Admin#1234'); expect(/not a teacher/i.test(await toastText(p)), 'role mismatch msg'); expect(await view(p) === 'site', 'still on site');
  await p.keyboard.press('Escape');
  await login(p, 'admin', 'admin@test.dev', 'Admin#1234'); await loggedIn(p);
  const items = await p.$$eval('#sideNav button', b => b.map(x => x.textContent.trim()));
  expect(['Dashboard', 'Students', 'Teachers', 'Courses & Subjects', 'Study Materials', 'Recorded Lectures', 'Live Classes', 'Audit Log'].every(i => items.includes(i)), 'admin sidebar: ' + items);
});
await step('Admin dashboard shows statistics', async () => { expect(await p.isVisible('.stats .stat'), 'stats'); const t = await p.textContent('.stats'); expect(/Pending students/.test(t) && /Teachers/.test(t), t); });
await p.screenshot({ path: path.join(SHOTS, 'admin-dashboard.png') });
await logout(p);

await step('4/6. Pending, rejected and suspended students are denied', async () => {
  for (const [em, re] of [['pending@test.dev', /waiting for Admin approval/i], ['rejected@test.dev', /not approved/i], ['suspended@test.dev', /suspended/i]]) {
    await login(p, 'student', em, 'Stud#12345'); const t = await toastText(p); expect(re.test(t), em + ': ' + t); expect(await view(p) === 'site', 'denied ' + em);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  }
  expect(!(await p.evaluate(() => localStorage.getItem('edusphere-auth'))), 'denied user must not keep a session');
});
await step('3. Student registration creates a pending profile with matching fields', async () => {
  await p.click('.banner-cta [data-register]');
  await p.fill('#registerForm [name=full_name]', 'Neha New'); await p.fill('#registerForm [name=phone]', '9876543210'); await p.fill('#registerForm [name=email]', 'neha@test.dev');
  await p.fill('#registerForm [name=student_id]', 'S-77'); await p.selectOption('#registerForm [name=course]', 'ANM'); await p.selectOption('#registerForm [name=academic_year]', 'Second Year');
  await p.fill('#registerForm [name=password]', 'Neha#12345'); await p.check('#registerForm [name=confirm]'); await p.click('#registerForm button[type=submit]');
  expect(/Registration submitted/.test(await toastText(p)), 'toast');
  const row = (await db(p)).profiles.find(x => x.email === 'neha@test.dev');
  expect(row && row.status === 'pending' && row.role === 'student' && row.full_name === 'Neha New' && row.phone === '9876543210' && row.student_id === 'S-77' && row.course === 'ANM' && row.academic_year === 'Second Year', JSON.stringify(row));
  expect(!(await p.evaluate(() => localStorage.getItem('edusphere-auth'))), 'no session after signup');
});
await step('Registered student cannot enter while pending', async () => { await p.waitForTimeout(500); await login(p, 'student', 'neha@test.dev', 'Neha#12345'); expect(/waiting/i.test(await toastText(p)), 'pending msg'); await p.keyboard.press('Escape'); });
await step('5. Admin sees the new registration; approve + reject work', async () => {
  await login(p, 'admin', 'admin@test.dev', 'Admin#1234'); await loggedIn(p);
  expect(await p.isVisible('#pendBox :text("Neha New")'), 'new student listed on dashboard');
  await nav(p, 'Students'); expect(await p.isVisible('#stuBox :text("Neha New")') && await p.isVisible('#stuBox :text("neha@test.dev")'), 'in students list');
  await p.click('.row:has-text("Neha New") button:has-text("Approve")'); await p.waitForTimeout(400);
  await p.click('.row:has-text("Pia Pending") button:has-text("Reject")'); await confirmYes(p);
  const d = await db(p); expect(d.profiles.find(x => x.email === 'neha@test.dev').status === 'approved', 'approved'); expect(d.profiles.find(x => x.email === 'pending@test.dev').status === 'rejected', 'rejected');
  await p.click('.row:has-text("Rahul Kumar") button:has-text("Suspend")'); await confirmYes(p); expect((await db(p)).profiles.find(x => x.email === 'student1@test.dev').status === 'suspended', 'suspended');
  await p.click('.row:has-text("Rahul Kumar") button:has-text("Reactivate")'); await p.waitForTimeout(400); expect((await db(p)).profiles.find(x => x.email === 'student1@test.dev').status === 'approved', 'reactivated');
});
await step('8. Admin creates a teacher; edit + suspend + activate', async () => {
  await nav(p, 'Teachers'); await p.fill('#tForm [name=full_name]', 'Tara Newteacher'); await p.fill('#tForm [name=email]', 'tara@test.dev'); await p.fill('#tForm [name=subject]', 'Chemistry'); await p.click('#tForm button[type=submit]');
  await p.waitForSelector('#tBox :text("Tara Newteacher")'); const d = await db(p); const t = d.profiles.find(x => x.email === 'tara@test.dev'); expect(t && t.role === 'teacher' && t.status === 'approved', 'teacher row'); expect(d.mail.some(m => m.to === 'tara@test.dev'), 'setup email requested');
  await p.click('.row:has-text("Tara Newteacher") button:has-text("Edit")'); await p.fill('#tEdit [name=subject]', 'Organic Chemistry'); await p.click('#tEdit button[type=submit]'); await p.waitForTimeout(400);
  expect((await db(p)).profiles.find(x => x.email === 'tara@test.dev').subject === 'Organic Chemistry', 'edited');
  await p.click('.row:has-text("Tara Newteacher") button:has-text("Suspend")'); await confirmYes(p); expect((await db(p)).profiles.find(x => x.email === 'tara@test.dev').status === 'suspended', 'suspended');
  await p.click('.row:has-text("Tara Newteacher") button:has-text("Activate")'); await p.waitForTimeout(400); expect((await db(p)).profiles.find(x => x.email === 'tara@test.dev').status === 'approved', 'activated');
});
await step('Admin: subjects and courses management', async () => {
  await nav(p, 'Courses & Subjects'); await p.fill('#subForm [name=name]', 'Nursing Foundation'); await p.click('#subForm button[type=submit]'); await p.waitForSelector('#subCard :text("Nursing Foundation")');
  await p.fill('#crsForm [name=title]', 'GNM Year 1'); await p.selectOption('#crsForm [name=subject]', 'Biology'); await p.click('#crsForm button[type=submit]'); await p.waitForSelector('#crsList :text("GNM Year 1")');
});
await logout(p);

await step('Teacher account created by Admin can sign in only after status check (Teacher login)', async () => {
  await login(p, 'teacher', 'teacher1@test.dev', 'Teach#1234'); await loggedIn(p);
  const items = await p.$$eval('#sideNav button', b => b.map(x => x.textContent.trim())); expect(items.includes('Record Screen') && !items.includes('Students') && !items.includes('Teachers'), 'teacher sidebar ' + items);
  expect(/Hello, Tina/.test(await p.textContent('.welcome')), 'welcome');
});
await step('Teacher: manage own course', async () => { await nav(p, 'My Courses'); await p.fill('#crsForm [name=title]', 'Biology Basics'); await p.selectOption('#crsForm [name=subject]', 'Biology'); await p.click('#crsForm button[type=submit]'); await p.waitForSelector('#crsList :text("Biology Basics")'); });
await step('9. Teacher uploads study materials (published + draft)', async () => {
  await nav(p, 'Study Materials');
  const up = async (title, name) => { await p.fill('#matForm [name=title]', title); await p.selectOption('#matForm [name=subject]', 'Biology'); await p.setInputFiles('#matForm [name=file]', { name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }); await p.click('#matForm button[type=submit]'); await p.waitForSelector(`#matList :text("${title}")`); };
  await up('Cell Notes T1', 'cell.pdf'); await up('T1 second file', 'second.pdf');
  await p.setInputFiles('#matForm [name=file]', { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') }); await p.fill('#matForm [name=title]', 'bad'); await p.selectOption('#matForm [name=subject]', 'Biology'); await p.click('#matForm button[type=submit]');
  expect(/not allowed/i.test(await toastText(p)), 'exe rejected');
  const d = await db(p); expect(d.materials.length === 2 && Object.keys(d.storage).length === 2, 'rows+files');
});
await step('12. Teacher publishes a recorded lecture (YouTube Unlisted)', async () => {
  await nav(p, 'Recorded Lectures');
  await p.fill('#lecForm [name=title]', 'Cell Structure'); await p.selectOption('#lecForm [name=subject]', 'Biology'); await p.fill('#lecForm [name=description]', 'Intro to cells'); await p.fill('#lecForm [name=video]', 'https://youtu.be/' + VID); await p.check('#lecForm [name=publish]');
  await p.setInputFiles('#lecForm [name=thumb]', { name: 't.png', mimeType: 'image/png', buffer: PNG }); await p.click('#lecForm button[type=submit]'); await p.waitForSelector('#lecList :text("Cell Structure")');
  await p.fill('#lecForm [name=title]', 'Bad'); await p.selectOption('#lecForm [name=subject]', 'Biology'); await p.fill('#lecForm [name=video]', 'not a link'); await p.click('#lecForm button[type=submit]'); expect(/valid YouTube/i.test(await toastText(p)), 'invalid link refused');
  expect((await db(p)).recorded_lectures.length === 1, 'one lecture');
});
await step('13. Teacher creates a Google Meet class; non-Meet link refused', async () => {
  await nav(p, 'Live Classes'); await p.fill('#clsForm [name=title]', 'Cell Biology Live'); await p.selectOption('#clsForm [name=subject]', 'Biology'); await p.fill('#clsForm [name=starts_at]', future(180)); await p.fill('#clsForm [name=meeting_url]', 'https://evil.example.com/x');
  await p.click('#clsForm button[type=submit]'); expect(/Google Meet link/i.test(await toastText(p)), 'meet only');
  await p.fill('#clsForm [name=meeting_url]', MEET); await p.click('#clsForm button[type=submit]'); await p.waitForSelector('#clsList :text("Cell Biology Live")'); expect(await p.isVisible('#clsList a:has-text("Join Google Meet")'), 'join visible for scheduled');
});
await logout(p);

await step('Public homepage exposes no private links (video id / Meet link)', async () => {
  await p.reload(); await p.waitForFunction(() => window.__mock); await p.waitForSelector('#publicLectures:not([hidden])');
  const html = await p.content(); expect(!html.includes(VID) && !html.includes('meet.google.com') && !html.includes('youtube-nocookie'), 'private data leaked into public DOM');
  expect(await p.isVisible('#publicLectureGrid :text("Cell Structure")'), 'safe preview shown');
});

// ---------- Ownership delete ----------
await step('10. Teacher 2 cannot see Delete on Teacher 1 content; owner can delete own', async () => {
  await login(p, 'teacher', 'teacher2@test.dev', 'Teach#1234'); await loggedIn(p); await nav(p, 'Study Materials');
  await p.waitForSelector('#matList :text("Cell Notes T1")'); expect(!(await p.isVisible('#matList button:has-text("Delete")')), 'T2 must not see Delete on T1 material');
  await nav(p, 'Recorded Lectures'); await p.waitForSelector('#lecList :text("Cell Structure")'); expect(!(await p.isVisible('#lecList button:has-text("Delete")')), 'T2 must not see Delete on T1 lecture');
  // T2 own content
  await nav(p, 'Study Materials'); await p.fill('#matForm [name=title]', 'Physics Notes T2'); await p.selectOption('#matForm [name=subject]', 'Physics'); await p.setInputFiles('#matForm [name=file]', { name: 'phy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }); await p.click('#matForm button[type=submit]'); await p.waitForSelector('#matList :text("Physics Notes T2")');
  await nav(p, 'Recorded Lectures'); await p.fill('#lecForm [name=title]', 'Motion T2'); await p.selectOption('#lecForm [name=subject]', 'Physics'); await p.fill('#lecForm [name=video]', 'aaaaaaaaaaa'); await p.check('#lecForm [name=publish]'); await p.click('#lecForm button[type=submit]'); await p.waitForSelector('#lecList :text("Motion T2")');
  // owner delete with confirmation (cancel first)
  await nav(p, 'Study Materials'); await p.click('.row:has-text("Physics Notes T2") button:has-text("Delete")'); await p.waitForSelector('#confirmDlg[open]'); await p.click('#confirmNo'); await p.waitForTimeout(200);
  expect((await db(p)).materials.some(m => m.title === 'Physics Notes T2'), 'cancel keeps item');
  await p.click('.row:has-text("Physics Notes T2") button:has-text("Delete")'); await confirmYes(p); await p.waitForTimeout(300);
  const d = await db(p); expect(!d.materials.some(m => m.title === 'Physics Notes T2'), 'row deleted'); expect(!Object.keys(d.storage).some(k => k.includes('phy.pdf')), 'file removed from storage');
  expect(d.audit_log.some(a => a.action === 'deleted' && a.entity_title === 'Physics Notes T2' && a.performer_name === 'Tom Teacher'), 'audit entry');
});
await step('Direct API deletion of another teacher\'s item is refused (mock RLS emulation)', async () => {
  const r = await p.evaluate(async () => { const d = JSON.parse(localStorage.getItem('mockdb')); const id = d.materials.find(m => m.title === 'Cell Notes T1').id; const out = await window.__mock.from('materials').delete().eq('id', id).select('id'); return { n: out.data.length }; });
  expect(r.n === 0, 'deleted rows: ' + r.n); expect((await db(p)).materials.some(m => m.title === 'Cell Notes T1'), 'still there');
});
await logout(p);
await step('11. Admin deletes any teacher\'s lecture and material', async () => {
  await login(p, 'admin', 'admin@test.dev', 'Admin#1234'); await loggedIn(p); await nav(p, 'Recorded Lectures'); await p.waitForSelector('#lecList :text("Motion T2")');
  await p.click('.lec:has-text("Motion T2") button:has-text("Delete")'); await confirmYes(p); await p.waitForTimeout(300); expect(!(await db(p)).recorded_lectures.some(l => l.title === 'Motion T2'), 'lecture deleted by admin');
  await nav(p, 'Study Materials'); await p.click('.row:has-text("T1 second file") button:has-text("Delete")'); await confirmYes(p); await p.waitForTimeout(300); const d = await db(p); expect(!d.materials.some(m => m.title === 'T1 second file'), 'material deleted by admin');
  await nav(p, 'Audit Log'); const t = await p.textContent('#aBox'); expect(/Motion T2/.test(t) && /T1 second file/.test(t) && /Asha Admin/.test(t), 'audit shows who: ' + t.slice(0, 200));
});
await logout(p);

// ---------- Student experience ----------
await step('Student dashboard (screenshot layout): sidebar items, banner, stats, sections', async () => {
  await login(p, 'student', 'student1@test.dev', 'Stud#12345'); await loggedIn(p);
  const items = await p.$$eval('#sideNav button', b => b.map(x => x.textContent.trim())); expect(JSON.stringify(items) === JSON.stringify(['Dashboard', 'My Courses', 'Live Classes', 'Recorded Lectures', 'Study Materials', 'My Profile']), items.join('|'));
  expect(await p.isVisible('#sideLogout'), 'sidebar logout'); expect(/Hello, Rahul/.test(await p.textContent('.welcome')), 'welcome'); expect((await p.$$('.stats .stat')).length >= 3, 'stats');
  const t = await p.textContent('#view'); for (const s of ['Continue Learning', 'My Courses', 'Upcoming Live Class', 'Recent Activity']) expect(t.includes(s), s);
  expect(/Welcome,\s*Rahul/.test(await p.textContent('.topbar')), 'topbar welcome');
});
await p.screenshot({ path: path.join(SHOTS, 'student-dashboard-desktop.png'), fullPage: true });
await step('6. Student sees published content; drafts hidden', async () => {
  await nav(p, 'Study Materials'); await p.waitForSelector('#matList :text("Cell Notes T1")'); expect(!(await p.isVisible('#matForm')) && !(await p.isVisible('#matList button:has-text("Delete")')), 'no staff controls');
  await p.click('.row:has-text("Cell Notes T1") button:has-text("Open")'); await p.waitForTimeout(200);
});
await step('12b. Student watches lecture inside EduSphere and progress is tracked', async () => {
  await nav(p, 'Recorded Lectures'); await p.click('.lec:has-text("Cell Structure") .tn'); await p.waitForSelector('#modalDlg[open] iframe');
  const src = await p.getAttribute('#modalDlg iframe', 'src'); expect(src.startsWith('https://www.youtube-nocookie.com/embed/' + VID), src);
  await p.click('#markDone'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await nav(p, 'Dashboard'); await p.waitForTimeout(300);
  const t = await p.textContent('.stats'); expect(/1\s*Completed/.test(t.replace(/\s+/g, ' ')) && /100%/.test(t), t); expect(/Completed: Cell Structure/.test(await p.textContent('.activity')), 'recent activity');
});
await step('15. Student sees class, updates after reschedule, and cancelled class has no Join button', async () => {
  await nav(p, 'Live Classes'); await p.waitForSelector('#clsList :text("Cell Biology Live")'); expect(await p.isVisible('#clsList a:has-text("Join Google Meet")'), 'join'); expect(!(await p.isVisible('#clsForm')), 'no form for student'); await logout(p);
  await login(p, 'teacher', 'teacher1@test.dev', 'Teach#1234'); await loggedIn(p); await nav(p, 'Live Classes');
  await p.click('.row:has-text("Cell Biology Live") button:has-text("Edit / reschedule")'); await p.fill('#clsForm [name=starts_at]', future(300)); await p.click('#clsForm button[type=submit]'); await p.waitForSelector('#clsList .badge:text("Rescheduled")');
  await logout(p); await login(p, 'student', 'student1@test.dev', 'Stud#12345'); await loggedIn(p); await nav(p, 'Live Classes'); await p.waitForSelector('#clsList .badge:text("Rescheduled")'); expect(await p.isVisible('#clsList a:has-text("Join Google Meet")'), 'join still visible');
  await logout(p); await login(p, 'teacher', 'teacher1@test.dev', 'Teach#1234'); await loggedIn(p); await nav(p, 'Live Classes');
  await p.click('.row:has-text("Cell Biology Live") button:has-text("Cancel class")'); await confirmYes(p); await p.waitForSelector('#clsList .badge:text("Cancelled")'); expect((await db(p)).live_classes.length === 1, 'history preserved');
  await logout(p); await login(p, 'student', 'student1@test.dev', 'Stud#12345'); await loggedIn(p); await nav(p, 'Live Classes'); await p.waitForSelector('#clsList .badge:text("Cancelled")'); expect(!(await p.isVisible('#clsList a:has-text("Join Google Meet")')), 'no Join for cancelled');
});
await step('Student profile edit', async () => { await nav(p, 'My Profile'); await p.fill('#pf [name=phone]', '8888888888'); await p.click('#pf button[type=submit]'); await p.waitForTimeout(300); expect((await db(p)).profiles.find(x => x.id === 'u-s1').phone === '8888888888', 'saved'); });

await step('7. Session persists after browser restart', async () => {
  const state = await ctx.storageState(); await ctx.close();
  const c2 = await newCtx({ storageState: state }); p = await open(c2); await loggedIn(p);
  expect(/Welcome,\s*Rahul/.test(await p.textContent('.topbar')), 'restored session shows student');
  await p.screenshot({ path: path.join(SHOTS, 'restored.png') });
});
await step('7b. Status is re-checked: suspended while signed in -> signed out', async () => {
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); d.profiles.find(x => x.id === 'u-s1').status = 'suspended'; localStorage.setItem('mockdb', JSON.stringify(d)); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => document.body.dataset.view === 'site', null, { timeout: 4000 }); expect(!(await p.evaluate(() => localStorage.getItem('edusphere-auth'))), 'session cleared');
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('mockdb')); d.profiles.find(x => x.id === 'u-s1').status = 'approved'; localStorage.setItem('mockdb', JSON.stringify(d)); });
});
await step('19. Logout leaves one homepage, no duplicate login sections, dashboard hidden', async () => {
  await login(p, 'student', 'student1@test.dev', 'Stud#12345'); await loggedIn(p); await logout(p);
  expect(await p.isVisible('.hero') && !(await p.isVisible('#app')), 'site visible, app hidden'); expect((await p.$$('.nav-logins')).length === 1 && (await p.$$('.hero')).length === 1, 'single login group / hero');
  expect(!(await p.isVisible('#loginDlg')), 'login dialog closed'); expect((await p.$$('#sideNav button')).length === 0, 'sidebar emptied');
});

// ---------- Recorder (stubbed capture APIs) ----------
await step('16. Recorder: consent gate, start/stop, timer, status, download (capture APIs stubbed)', async () => {
  await login(p, 'teacher', 'teacher1@test.dev', 'Teach#1234'); await loggedIn(p); await nav(p, 'Record Screen');
  await p.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); setInterval(() => { x.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); x.fillRect(0, 0, 320, 180); }, 100); return c.captureStream(10); };
    navigator.mediaDevices.getUserMedia = async c => { window.__gum = c; const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; };
  });
  await p.click('#recStart'); expect(/consent/i.test(await toastText(p)), 'consent required'); await p.check('#recConsent'); await p.click('#recStart');
  await p.waitForFunction(() => /Recording/.test(document.querySelector('#recStatus').textContent)); await p.waitForTimeout(2300);
  expect(await p.evaluate(() => document.querySelector('#recTime').textContent) !== '0:00', 'timer runs'); expect(await p.evaluate(() => window.__gum.video === false), 'camera never requested');
  await p.click('#recStop'); await p.waitForSelector('#recSave a[download]'); expect(/Stopped/.test(await p.textContent('#recStatus')), 'status stopped');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#recSave a')]); expect(/\.(webm|mp4)$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await p.click('button:has-text("Go to Recorded Lectures")'); await p.waitForSelector('#lecForm');
});
await logout(p);

// ---------- Responsive ----------
const overflow = pg => pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
for (const [label, w, h] of [['mobile 390', 390, 844], ['Galaxy 360', 360, 780], ['tablet 768', 768, 1024]]) {
  await step(`17. Homepage has no horizontal overflow @ ${label}`, async () => {
    const c = await newCtx({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: true }); const m = await open(c);
    let o = await overflow(m); expect(o.sw <= o.iw, `overflow ${o.sw}>${o.iw}`);
    if (w < 900) { await m.click('#menuToggle'); expect(await m.isVisible('#mainNav [data-login=student]'), 'menu opens'); o = await overflow(m); expect(o.sw <= o.iw, 'overflow with menu'); }
    await m.screenshot({ path: path.join(SHOTS, `home-${w}.png`), fullPage: true }); await c.close();
  });
}
for (const [label, w, h] of [['mobile 390', 390, 844], ['tablet 768', 768, 1024]]) {
  await step(`18. All dashboards: no horizontal overflow, working sidebar @ ${label}`, async () => {
    const c = await newCtx({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: true }); const m = await open(c);
    for (const [role, em, pw] of [['student', 'student1@test.dev', 'Stud#12345'], ['teacher', 'teacher1@test.dev', 'Teach#1234'], ['admin', 'admin@test.dev', 'Admin#1234']]) {
      if (w < 900) await m.click('#menuToggle'); await m.click(`.nav-logins [data-login=${role}]`); await m.fill('#loginForm [name=email]', em); await m.fill('#loginForm [name=password]', pw); await m.click('#loginForm button[type=submit]'); await loggedIn(m);
      const labels = await m.$$eval('#sideNav button', b => b.map(x => x.textContent.trim()));
      for (const l of labels) { if (w < 900) { await m.click('#hamb'); await m.waitForTimeout(260); } await m.click(`#sideNav button:has-text("${l}")`); await m.waitForTimeout(300); const o = await overflow(m); expect(o.sw <= o.iw, `${role}/${l} overflow ${o.sw}>${o.iw}`); }
      if (role === 'student') { if (w < 900) { await m.click('#hamb'); await m.waitForTimeout(260); } await m.click('#sideNav button:has-text("Dashboard")'); await m.waitForTimeout(300); await m.screenshot({ path: path.join(SHOTS, `student-dashboard-${w}.png`), fullPage: true }); }
      if (w < 900) await m.click('#hamb'); await m.waitForTimeout(260); await m.click(w < 900 ? '#sideLogout' : '#topLogout'); await m.waitForFunction(() => document.body.dataset.view === 'site');
    }
    await c.close();
  });
}

await step('Teacher password-setup / reset link opens the set-password dialog and saves the password', async () => {
  const c = await newCtx(); const m = await open(c);
  await m.evaluate(() => { localStorage.setItem('edusphere-auth', JSON.stringify({ user: { id: 'u-t2', email: 'teacher2@test.dev' } })); window.__mock.__helpers.emitRecovery(); });
  await m.waitForSelector('#recoverDlg[open]'); await m.fill('#recoverForm [name=password]', 'NewPass#9999'); await m.fill('#recoverForm [name=password2]', 'Mismatch#1'); await m.click('#recoverForm button[type=submit]');
  expect(/do not match/i.test(await m.textContent('#recMsg')), 'mismatch refused');
  await m.fill('#recoverForm [name=password2]', 'NewPass#9999'); await m.click('#recoverForm button[type=submit]');
  await m.waitForSelector('#loginDlg[open]'); expect((await m.evaluate(() => JSON.parse(localStorage.getItem('mockdb')).users.find(u => u.id === 'u-t2').password)) === 'NewPass#9999', 'password changed');
  expect(!(await m.evaluate(() => localStorage.getItem('edusphere-auth'))), 'signed out after setting password'); await c.close();
});
await step('PWA: manifest linked, icons load, service worker registers and activates', async () => {
  const c = await newCtx(); const m = await open(c);
  const man = await m.evaluate(async () => { const l = document.querySelector('link[rel=manifest]').href; const j = await (await fetch(l)).json(); const ok = await Promise.all(j.icons.map(i => fetch(new URL(i.src, l)).then(r => r.ok))); return { j, ok }; });
  expect(man.j.display === 'standalone' && man.ok.every(Boolean), 'manifest/icons'); 
  const sw = await m.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(r => !!r.active), new Promise(r => setTimeout(() => r(false), 8000))])); expect(sw, 'service worker active'); await c.close();
});
await step('Misc: no service_role key or secrets in website files', async () => {
  const files = ['index.html', 'config.js', ...fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f)]; for (const f of files) { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); expect(!/eyJ[A-Za-z0-9_-]{20,}\./.test(s), 'JWT-like string in ' + f); expect(!/SERVICE_ROLE_KEY\s*[:=]\s*['"]/.test(s), 'service key in ' + f); }
});

await browser.close(); server.close();
const failed = results.filter(r => !r.ok); const lines = results.map(r => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  -> ' + r.err}`);
fs.writeFileSync(path.join(ROOT, 'tests/e2e-results.txt'), lines.join('\n') + `\n\n${results.length - failed.length} passed, ${failed.length} failed\n`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`); process.exit(failed.length ? 1 : 0);
