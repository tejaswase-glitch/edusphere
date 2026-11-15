// Static checks: every referenced local file exists, every JS import resolves, no absolute paths, no secrets.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); let bad = 0;
const fail = m => { bad++; console.log('FAIL', m); }; const ok = m => console.log('PASS', m);
const exists = (from, ref) => fs.existsSync(path.resolve(path.dirname(from), ref.split('#')[0].split('?')[0]));
const html = path.join(ROOT, 'index.html'), h = fs.readFileSync(html, 'utf8');
let n = 0; for (const m of h.matchAll(/(?:src|href)="([^"]+)"/g)) { const r = m[1]; if (/^(https?:|#|mailto:|tel:|data:)/.test(r)) continue; n++; if (r.startsWith('/')) fail('absolute path in index.html: ' + r); else if (!exists(html, r)) fail('missing file referenced in index.html: ' + r); }
ok(`index.html: ${n} local references checked`);
const css = path.join(ROOT, 'css/styles.css'), c = fs.readFileSync(css, 'utf8'); for (const m of c.matchAll(/url\((?!["']?data:)["']?([^"')]+)/g)) if (!exists(css, m[1])) fail('css url missing ' + m[1]);
ok('css url() references checked');
let imports = 0; for (const f of fs.readdirSync(path.join(ROOT, 'js'))) { const p = path.join(ROOT, 'js', f), s = fs.readFileSync(p, 'utf8'); for (const m of s.matchAll(/(?:import[^'"]*from\s*|import\()\s*['"](\.[^'"]+)['"]/g)) { imports++; if (!exists(p, m[1])) fail(`${f}: unresolved import ${m[1]}`); } for (const m of s.matchAll(/['"](assets\/[\w.-]+)['"]/g)) if (!fs.existsSync(path.join(ROOT, m[1]))) fail(`${f}: missing asset ${m[1]}`); }
ok(`${imports} JS imports resolved`);
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); for (const i of man.icons) if (!fs.existsSync(path.join(ROOT, i.src))) fail('manifest icon missing ' + i.src);
if (man.start_url !== './' || man.scope !== './') fail('manifest paths must be relative'); ok('manifest valid + relative');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'); for (const m of sw.matchAll(/'((?:js|css|assets)\/[\w./-]+|index\.html|config\.js|manifest\.webmanifest)'/g)) if (!fs.existsSync(path.join(ROOT, m[1]))) fail('sw.js precache missing ' + m[1]); ok('service worker precache list valid');
// every data-act used in a view has a handler in that file
for (const f of fs.readdirSync(path.join(ROOT, 'js'))) { const s = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').replace(/^\s*\/\/.*$/gm, ''); const used = new Set([...s.matchAll(/data-act="(\w+)"/g)].map(m => m[1])); for (const a of used) if (!new RegExp(`\\b${a}\\s*[:(]|\\b${a}:`).test(s)) fail(`${f}: data-act="${a}" has no handler`); }
ok('every data-act has a handler');
for (const f of ['index.html', 'config.js', ...fs.readdirSync(path.join(ROOT, 'js')).map(x => 'js/' + x), 'sw.js']) { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); if (/eyJ[\w-]{20,}\./.test(s) || /service_role\s*[:=]\s*['"]/i.test(s)) fail('secret-like string in ' + f); }
ok('no secrets in website files');
console.log(bad ? `\n${bad} problem(s)` : '\nall static checks passed'); process.exit(bad ? 1 : 0);
