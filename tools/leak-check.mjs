// Leak check before a push: nothing private from the kodama pack in plaintext in what git would publish.
// Scans every tracked file (git ls-files, i.e. what Pages serves) for the pack password, each local
// scene's <title>, its seeded PRNG call and a long line of its code, and for JPEG data in kodamas/.
//   node tools/leak-check.mjs        exit 0 = clean
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PACK = path.join(ROOT, 'local', 'kodamas');
const needles = [];
const pass = fs.existsSync(path.join(ROOT, 'local', 'kodama-pass.txt')) ? fs.readFileSync(path.join(ROOT, 'local', 'kodama-pass.txt'), 'utf8').trim() : '';
if (pass) needles.push(['password', pass]);
const idx = JSON.parse(fs.readFileSync(path.join(PACK, 'index.json'), 'utf8'));
for (const s of idx.scenes) {
  const html = fs.readFileSync(path.join(PACK, s.file), 'utf8');
  const title = (/<title>([^<]{6,})<\/title>/.exec(html) || [])[1];
  if (title) needles.push([s.id + ' title', title]);
  const seed = (/mulberry32\(\d{5,}\)/.exec(html) || [])[0];
  if (seed) needles.push([s.id + ' seed', seed]);
  const line = html.split('\n').map(l => l.trim()).filter(l => l.length > 80 && !/three\.min\.js|^<script|^<\/|^\/\*|^\*/.test(l))[5];
  if (line) needles.push([s.id + ' code', line.slice(0, 80)]);
}
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const hits = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  const text = buf.toString('latin1');
  for (const [what, n] of needles) if (text.includes(n)) hits.push(f + ': ' + what);
  if (f.startsWith('kodamas/') && buf.includes(Buffer.from([0xff, 0xd8, 0xff]))) {
    // an IV or ciphertext can contain these bytes by chance; a JPEG starts with them after the 12-byte IV
    if (buf.indexOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0])) === 0 || buf.indexOf(Buffer.from('JFIF')) > -1) hits.push(f + ': JPEG data');
  }
}
console.log('leak check: ' + files.length + ' tracked files, ' + needles.length + ' needles from ' + idx.scenes.length + ' scenes' + (pass ? ' and the password' : ''));
for (const h of hits) console.log('  LEAK ' + h);
console.log(hits.length ? hits.length + ' leaks' : '0 leaks');
process.exit(hits.length ? 1 : 0);
