// Preflight every sketch on this machine's real GPU, write data/quarantine.json and thumbs/<id>.jpg.
//   node serve.mjs --port 8091 &   then   node tools/preflight.mjs [http://localhost:8091/]
// Quarantine: throws, renders black or white for more than 3 s, tanks frame cost (p95 > 41.7 ms at
// 1280x720, i.e. under 24 fps), or needs a camera, screen or network media (offline shows).
// Re-run node tools/build-data.mjs afterwards to fold the flags into data/sketches.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://localhost:8091/';
const SECS = 7, THUMB_AT = 4.5;

global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'data', 'sketches.js'), 'utf8'));
const D = global.window.PH_DATA;
const STATIC = /\binit(Cam|Screen|Video|Image|Stream)\b|\bloadScript\b|https?:\/\//;
const body = code => code.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 700, height: 400 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.goto(BASE + 'tools/harness.html');
await page.waitForFunction(() => window.ready);
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); });
console.log('GPU:', gpu);

fs.mkdirSync(path.join(ROOT, 'thumbs'), { recursive: true });
const report = { gpu, date: new Date().toISOString(), secs: SECS, sketches: {}, results: [] };
for (const sk of D.sketches) {
  const m = STATIC.exec(body(sk.code));
  const errBefore = errors.length;
  const r = await page.evaluate(([id, s, t]) => window.run(id, s, t), [sk.id, SECS, THUMB_AT]);
  if (r.thumb) fs.writeFileSync(path.join(ROOT, 'thumbs', sk.id + '.jpg'), Buffer.from(r.thumb.split(',')[1], 'base64'));
  let q = '';
  if (m) q = 'needs ' + (m[1] ? m[1].toLowerCase() : m[0]) + ' input';
  else if (r.err) q = 'throws (' + r.err.slice(0, 80) + ')';
  else if (r.blankMax > 3) q = 'renders ' + r.blankKind + ' for ' + r.blankMax.toFixed(1) + ' s';
  else if (r.p95Ms > 41.7) q = 'slow (p95 ' + r.p95Ms.toFixed(1) + ' ms per frame)';
  else if (r.lost) q = 'lost the WebGL context';
  if (q) report.sketches[sk.id] = q;
  const row = { id: sk.id, avgMs: +r.avgMs.toFixed(2), p95Ms: +(r.p95Ms || 0).toFixed(2), frames: r.frames, blankMax: +r.blankMax.toFixed(1), blankKind: r.blankKind, err: r.err, consoleErrors: errors.slice(errBefore), quarantine: q };
  report.results.push(row);
  console.log(sk.id.padEnd(13), ('avg ' + row.avgMs + 'ms p95 ' + row.p95Ms + 'ms').padEnd(28), 'blank ' + row.blankMax + 's', q ? '  QUARANTINE: ' + q : '', row.consoleErrors.length ? ' console: ' + row.consoleErrors.join(' | ').slice(0, 120) : '');
}
await browser.close();
fs.writeFileSync(path.join(ROOT, 'data', 'quarantine.json'), JSON.stringify(report, null, 1) + '\n');
console.log('quarantined:', Object.keys(report.sketches).length, Object.entries(report.sketches).map(([k, v]) => k + ': ' + v).join('; '));
