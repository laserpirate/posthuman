// Copies the kodama scenes the VJ app plays from ..\All_Kodamas into local/kodamas/ (gitignored) and
// writes local/kodamas/index.json. The scene files are copied byte for byte: the app adapts them at
// load time (local three.js, inline manifest, kodama-rig.js), never on disk.
//   node tools/kodama-import.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, '..', 'All_Kodamas');
const OUT = path.join(ROOT, 'local', 'kodamas');

// the SE Asia climate-megacity arc, the kodama-v1 topography studies (no kv22 exists), the new drafts
const WANT = [
  ...['17', '18', '19', '20', '21', '22', '23', '24'].map(n => 'pk' + n),
  ...Array.from({ length: 25 }, (_, i) => 'kv' + String(i + 1).padStart(2, '0')).filter(k => k !== 'kv22'),
  'pk26', 'pk27', 'pk28', 'pk29',
];
// drafts not in the manifest yet: plain working titles, pending Marko's approval
const NEW = {
  pk26: { file: 'phylla-kodama-topo-26-airfield.html', title: 'airfield', series: 'phylla-kodama-topo', draft: true },
  pk27: { file: 'phylla-kodama-topo-27-under-city.html', title: 'under-city', series: 'phylla-kodama-topo', draft: true },
  pk28: { file: 'phylla-kodama-topo-28-drowned-towers.html', title: 'drowned towers', series: 'phylla-kodama-topo', draft: true },
  pk29: { file: 'phylla-kodama-topo-29-cloud-city.html', title: 'cloud city', series: 'phylla-kodama-topo', draft: true },
};

function csv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])));
}

const manifest = csv(fs.readFileSync(path.join(LIB, 'kodamas_manifest.csv'), 'utf8'));
const byId = {};
for (const r of manifest) if (r.kid && !byId[r.kid] && !r.file.includes("/")) byId[r.kid] = r; // current versions, not _prior-versions/
fs.mkdirSync(OUT, { recursive: true });
const old = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : { scenes: [] };
const oldById = Object.fromEntries(old.scenes.map(s => [s.id, s]));

const scenes = [], missing = [];
for (const id of WANT) {
  const m = NEW[id] || (byId[id] && { file: byId[id].file, title: byId[id].title, series: byId[id].series });
  const src = m && [path.join(LIB, m.file), path.join(OUT, m.file)].find(p => fs.existsSync(p));
  if (!src) { missing.push(id); continue; }
  if (path.dirname(src) !== OUT) fs.copyFileSync(src, path.join(OUT, m.file));
  const prev = oldById[id] || {};
  scenes.push({
    id, file: m.file, title: m.title.replace(/\s*\(study[^)]*\)\s*$/, ''), series: m.series,
    draft: !!m.draft, quarantine: prev.quarantine || '', thumb: prev.thumb || '',
  });
}
fs.copyFileSync(path.join(LIB, 'phylla-kodama-manifest.js'), path.join(OUT, 'phylla-kodama-manifest.js'));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ format: 'posthuman-kodama-pack', version: 1, author: 'Marko Manriquez', scenes }, null, 1));
console.log(scenes.length + ' scenes in local/kodamas/' + (missing.length ? '; missing: ' + missing.join(', ') : ''));
