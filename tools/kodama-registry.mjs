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

// scenes whose controls need saying by hand (none so far; every library scene follows the pattern)
const HAND = {};

const idx = JSON.parse(fs.readFileSync(path.join(PACK, 'index.json'), 'utf8'));
const reg = {};
for (const s of idx.scenes) {
  const html = fs.readFileSync(path.join(PACK, s.file), 'utf8');
  const e = { turntable: {}, groups: [] };
  // turntable: `if(turntable&&!drag)camA+=0.0007` or `if(autoSpin) camA+=0.0016`
  let m = /if\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:&&\s*!\s*drag\s*)?\)\s*camA\s*\+=\s*([\d.]+)/.exec(html);
  if (m) e.turntable = { method: 'camA', spinVar: m[1], rate: Number(m[2]) };
  else if ((m = /camA\s*\+=\s*([\d.]+)/.exec(html))) e.turntable = { method: 'camA', ownSpin: true, rate: Number(m[1]) };
  else e.turntable = { method: 'root', ownSpin: true, rate: 0.0008 };
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
  reg[s.id] = Object.assign(e, HAND[s.id] || {});
}
fs.writeFileSync(OUT, JSON.stringify(reg, null, 1) + '\n');
const n = Object.values(reg).reduce((a, e) => a + e.groups.reduce((b, g) => b + g.items.length, 0), 0);
console.log(Object.keys(reg).length + ' scenes, ' + n + ' controls -> data/kodama-controls.json');
