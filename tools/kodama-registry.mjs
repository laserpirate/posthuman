// Writes data/kodama-controls.json: for each kodama, how the harness turns it (the scene's spin
// variable and rate) and the scene's own buttons, grouped as the scene groups them. The controller
// mirrors these buttons and proxies clicks by selector. Generated from local/kodamas/*.html; hand
// entries in HAND override or extend what the parser finds.
//   node tools/kodama-registry.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'local', 'kodamas');
const OUT = path.join(ROOT, 'data', 'kodama-controls.json');

// scenes whose controls need saying by hand
const HAND = {};
// camera overrides, merged into the parsed cam entry
const CAM = {
  // kv14: vertical drag moves the scene's look target (target.y) instead of camY; here vertical orbit
  // is off and pan covers it
  kv14: { note: 'vertical drag in the scene tilts target.y; here vertical orbit is off, pan covers it' },
  // under-city interiors: a short pan keeps the camera inside the tunnels
  pk27: { pan: 3, note: 'interior: pan kept short so the camera stays inside the tunnel' },
};

const idx = JSON.parse(fs.readFileSync(path.join(PACK, 'index.json'), 'utf8'));
const reg = {};
for (const s of idx.scenes) {
  if (!fs.existsSync(path.join(PACK, s.file))) { console.log('missing, skipped: ' + s.id); continue; }
  const html = fs.readFileSync(path.join(PACK, s.file), 'utf8');
  const e = { turntable: {}, groups: [] };
  // turntable: `if(turntable&&!drag)camA+=0.0007` or `if(autoSpin) camA+=0.0016`
  let m = /if\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:&&\s*!\s*drag\s*)?\)\s*camA\s*\+=\s*([\d.]+)/.exec(html);
  if (m) e.turntable = { method: 'camA', spinVar: m[1], rate: Number(m[2]) };
  else if ((m = /camA\s*\+=\s*([\d.]+)/.exec(html))) e.turntable = { method: 'camA', ownSpin: true, rate: Number(m[1]) };
  else e.turntable = { method: 'root', ownSpin: true, rate: 0.0008 };
  // camera: the scene's own drag rates and limits, from its handlers
  //   camA-=(e.clientX-px)*.005;  camY=MU.clamp(camY-(e.clientY-py)*.4,8,92);  camR=MU.clamp(camR+e.deltaY*.05,56,200)
  // pan: the app moves the camera and its look point (`target`) together, up to half the nearest zoom
  const num = '(-?[\\d.]+)';
  const ka = new RegExp('camA\\s*-=\\s*\\(e\\.clientX\\s*-\\s*px\\)\\s*\\*\\s*' + num).exec(html);
  const cy = new RegExp('camY\\s*=\\s*[\\w.]*clamp\\(\\s*camY\\s*-\\s*\\(e\\.clientY\\s*-\\s*py\\)\\s*\\*\\s*' + num + '\\s*,\\s*' + num + '\\s*,\\s*' + num).exec(html);
  const cr = new RegExp('camR\\s*=\\s*[\\w.]*clamp\\(\\s*camR\\s*\\+\\s*e\\.deltaY\\s*\\*\\s*' + num + '\\s*,\\s*' + num + '\\s*,\\s*' + num).exec(html);
  const tgt = /const\s+target\s*=\s*new\s+THREE\.Vector3\(/.test(html) && /camera\.lookAt\(\s*target\s*\)/.test(html);
  if (ka && cr) {
    e.cam = { ka: Number(ka[1]), ky: cy ? Number(cy[1]) : 0, y: cy ? [Number(cy[2]), Number(cy[3])] : null, kr: Number(cr[1]), r: [Number(cr[2]), Number(cr[3])] };
    e.cam.pan = tgt ? Math.round(e.cam.r[0] * 0.5) : 0;
    if (!cy) e.cam.note = 'no camY drag in the scene: vertical orbit off';
    if (!tgt) e.cam.note = 'no shared look target: pan off';
  } else e.cam = { ka: 0.005, ky: 0, y: null, kr: 0, r: null, pan: 0, note: 'no orbit handlers found: view fixed' };
  // buttons in source order, grouped by the <span class="grp">label that holds them
  const bar = (/<div id="bar"[^>]*>([\s\S]*?)<\/div>/.exec(html) || [, ''])[1];
  let group = null;
  const tok = /<span class="grp">\s*([^<]*)|<\/span>|<button([^>]*)>([^<]*)<\/button>/g;
  for (let t; (t = tok.exec(bar));) {
    if (t[1] !== undefined) { group = { name: t[1].trim() || 'scene', items: [] }; e.groups.push(group); continue; }
    if (t[0] === '</span>') { group = null; continue; }
    const attrs = t[2], label = t[3].trim();
    const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
    if (id === 'tt' || id === 'pk-snd') continue; // the turntable slider replaces #tt; sound is not used
    const data = /\b(data-[\w-]+)="([^"]*)"/.exec(attrs);
    const sel = data ? `[${data[1]}="${data[2]}"]` : id ? '#' + id : null;
    if (!sel) continue;
    const item = { label: label === '⟳' ? 'cycle' : label, sel };
    if (group) group.items.push(item);
    else e.groups.push({ name: label, items: [item] });
  }
  if (CAM[s.id]) Object.assign(e.cam, CAM[s.id]);
  reg[s.id] = Object.assign(e, HAND[s.id] || {});
}
fs.writeFileSync(OUT, JSON.stringify(reg, null, 1) + '\n');
const n = Object.values(reg).reduce((a, e) => a + e.groups.reduce((b, g) => b + g.items.length, 0), 0);
console.log(Object.keys(reg).length + ' scenes, ' + n + ' controls -> data/kodama-controls.json');
