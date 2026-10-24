// Gate: the root app (/) must be byte-identical to the baseline tag. Compares the git blob ids of every
// root app file in the working tree with the baseline tag's (docs *.md, tools/, test-results/, next/ and
// local/ are not the app). Exit 1 on any difference.
//   node tools/root-hash.mjs              check against tools/root-baseline.json
//   node tools/root-hash.mjs --set <tag>  move the baseline (a deliberate root release, e.g. posthuman-v0.4.3)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'tools', 'root-baseline.json');
const git = (a, input) => execFileSync('git', a, { cwd: ROOT, input, maxBuffer: 1 << 28 }).toString();
const isApp = f => !/^(next|tools|test-results|local|node_modules)\//.test(f) && !/\.md$/i.test(f);

function atTag(tag) {
  const m = new Map();
  for (const line of git(['ls-tree', '-r', tag]).split('\n')) {
    const r = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (r && isApp(r[2])) m.set(r[2], r[1]);
  }
  return m;
}
function inTree() {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(f => f && isApp(f) && fs.existsSync(path.join(ROOT, f)));
  const ids = git(['hash-object', '--stdin-paths'], files.join('\n') + '\n').split('\n').filter(Boolean);
  return new Map(files.map((f, i) => [f, ids[i]]));
}
const digest = m => crypto.createHash('sha256').update([...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([f, id]) => f + ' ' + id).join('\n')).digest('hex');

const si = process.argv.indexOf('--set');
if (si > -1) {
  const tag = process.argv[si + 1];
  const m = atTag(tag);
  fs.writeFileSync(BASE, JSON.stringify({ tag, hash: digest(m), files: m.size }, null, 1) + '\n');
  console.log('root baseline set to ' + tag + ' (' + m.size + ' files) ' + digest(m));
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const want = atTag(base.tag), have = inTree();
const bad = [];
for (const [f, id] of want) if (have.get(f) !== id) bad.push((have.has(f) ? 'changed ' : 'missing ') + f);
for (const f of have.keys()) if (!want.has(f)) bad.push('added ' + f);
if (digest(want) !== base.hash) bad.push('baseline file does not match tag ' + base.tag);
if (bad.length) { console.log('ROOT CHANGED vs ' + base.tag + ':\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('root unchanged: byte-identical to ' + base.tag + ' (' + want.size + ' files, ' + digest(have).slice(0, 16) + ')');
