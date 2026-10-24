// Leak check before a push: the old kodama pack password must not be in anything git would publish.
// The kodama pack itself is public now (Marko's call, 24 Oct: no password on the live sites), so scene
// code in kodamas/ is expected. Scans every tracked file (git ls-files, i.e. what Pages serves) for the
// password from local/kodama-pass.txt, and checks that no local/ file or pass file is tracked.
//   node tools/leak-check.mjs        exit 0 = clean
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PASSFILE = path.join(ROOT, 'local', 'kodama-pass.txt');
const pass = fs.existsSync(PASSFILE) ? fs.readFileSync(PASSFILE, 'utf8').trim() : '';
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const hits = [];
for (const f of files) {
  if (/(^|\/)local\/|kodama-pass/.test(f)) hits.push(f + ': private file tracked');
  if (pass && fs.readFileSync(path.join(ROOT, f)).toString('latin1').includes(pass)) hits.push(f + ': password');
}
console.log('leak check: ' + files.length + ' tracked files' + (pass ? ', the password' : ' (no password file)'));
for (const h of hits) console.log('  LEAK ' + h);
console.log(hits.length ? hits.length + ' leaks' : '0 leaks');
process.exit(hits.length ? 1 : 0);
