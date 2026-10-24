// Builds the public kodama pack that GitHub Pages carries, unencrypted (Marko's call, 24 Oct: no
// password on the live sites): kodamas/index.json, the scene files, the manifest and the thumbs,
// copied byte for byte from the plain pack in local/kodamas/. Scenes stay © Marko Manriquez, all
// rights reserved. local/kodama-pass.txt is no longer used; it is never copied or committed.
//   node tools/kodama-pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'local', 'kodamas');
const OUT = path.join(ROOT, 'kodamas');

const idx = JSON.parse(fs.readFileSync(path.join(SRC, 'index.json'), 'utf8'));
const files = ['index.json', 'phylla-kodama-manifest.js', ...idx.scenes.map(s => s.file), ...idx.scenes.filter(s => s.thumb).map(s => s.thumb)];
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), dst);
}
console.log('kodamas/: ' + files.length + ' plain files, ' + idx.scenes.length + ' scenes');
