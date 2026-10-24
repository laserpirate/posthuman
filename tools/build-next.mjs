// Builds the /next/ preview: a copy of the app from a branch (default feat/midi) into next/ on main.
// The encrypted kodama pack comes from this checkout's kodamas/ (the root pack), so / and /next/ share it.
//   node tools/build-next.mjs [ref]        (run in the main checkout; then root-hash.mjs, the gates, commit next/)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] || 'feat/midi';
const OUT = path.join(ROOT, 'next');
// the app as served; docs, tools and tests stay out of the preview
const APP = ['index.html', 'app.js', 'app.css', 'kodama.js', 'kodama-rig.js', 'midi.js', 'data', 'fonts', 'vendor', 'thumbs', 'robots.txt', 'ai.txt', 'LICENSE'];

const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28 });
const files = git('ls-tree', '-r', '--name-only', REF, '--', ...APP).toString().split('\n').filter(Boolean);
if (!files.includes('midi.js')) throw new Error(REF + ' has no midi.js: wrong ref?');
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, git('show', REF + ':' + f));
}
let pack = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'kodamas'))) {
  fs.mkdirSync(path.join(OUT, 'kodamas'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'kodamas', f), path.join(OUT, 'kodamas', f));
  pack++;
}
const sha = git('rev-parse', '--short', REF).toString().trim();
fs.writeFileSync(path.join(OUT, 'BUILD.txt'), 'posthuman /next/ preview, built from ' + REF + ' ' + sha + ' on ' + new Date().toISOString() + '\n');
console.log('next/: ' + files.length + ' app files from ' + REF + ' (' + sha + '), ' + pack + ' kodama pack files from kodamas/');
