// Kodama preflight on the real GPU: every scene in local/kodamas/ through the same harness the app
// uses, with the Hydra rules (throws, black or white for more than 3 s, p95 frame cost). Writes the
// quarantine reason and a 320x180 thumbnail (local/kodamas/thumbs/<id>.jpg) into local/kodamas/index.json.
//   node tools/kodama-preflight.mjs [--swiftshader] [--only pk26,pk27] [--secs 8]
// Needs `node serve.mjs --port 8091` running.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'local', 'kodamas');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SW = process.argv.includes('--swiftshader');
const ONLY = arg('--only', '').split(',').filter(Boolean);
const SECS = Number(arg('--secs', 8));
const [W, H] = SW ? [960, 540] : [1280, 720];
const P95_LIMIT = SW ? 1e9 : 25; // ms of scene work per displayed frame; 33 ms is the whole 30 fps budget

const browser = await chromium.launch({ headless: true, args: [SW ? '--use-angle=swiftshader' : '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W + 20, height: H + 20 } });
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push(e.message));
await page.goto('http://localhost:8091/tools/kodama-harness.html');
const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const x = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(x.UNMASKED_RENDERER_WEBGL); });
console.log('GPU: ' + gpu + '  ' + W + 'x' + H);
const info = await page.evaluate(() => KH.open());
if (info.mode !== 'local') { console.log('no local pack: ' + info.why); process.exit(1); }

const idx = JSON.parse(fs.readFileSync(path.join(PACK, 'index.json'), 'utf8'));
fs.mkdirSync(path.join(PACK, 'thumbs'), { recursive: true });
const rows = [];
for (const s of idx.scenes) {
  if (ONLY.length && !ONLY.includes(s.id)) continue;
  problems.length = 0;
  const ld = await page.evaluate(([id, w, h]) => KH.load(id, w, h), [s.id, W, H]);
  let res = { err: ld.err || '' }, reason = '';
  if (ld.ok) {
    res = await page.evaluate(ms => KH.run(ms), SECS * 1000);
    const hidden = await page.evaluate(() => KH.visibleNonCanvas());
    // 3 consecutive black or white probes (one a second) is the app's skip rule
    let streak = 0, worst = 0;
    for (const b of res.bad) { streak = b ? streak + 1 : 0; worst = Math.max(worst, streak); }
    if (res.err) reason = 'throws: ' + res.err;
    else if (worst >= 3) reason = 'renders ' + res.bad.find(Boolean) + ' for 3 s';
    else if (res.p95 > P95_LIMIT) reason = 'slow: p95 ' + res.p95.toFixed(1) + ' ms per frame';
    else if (problems.length) reason = 'console error: ' + problems[0];
    if (hidden.length) console.log('  visible text left in ' + s.id + ': ' + hidden.join(' | '));
    if (!SW && !res.err) {
      const url = await page.evaluate(() => KH.thumb());
      fs.writeFileSync(path.join(PACK, 'thumbs', s.id + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
      s.thumb = 'thumbs/' + s.id + '.jpg';
    }
  } else reason = 'does not start: ' + ld.err;
  if (!SW) s.quarantine = reason;
  rows.push({ id: s.id, title: s.title, reason, fps: res.fps, p50: res.p50, p95: res.p95, bad: (res.bad || []).join(''), spin: res.spin });
  console.log((reason ? 'QUAR ' : 'ok   ') + s.id.padEnd(5) + ' p50 ' + (res.p50 || 0).toFixed(1).padStart(5) + ' p95 ' + (res.p95 || 0).toFixed(1).padStart(5) + ' ms  fps ' + (res.fps || 0).toFixed(1) + '  ' + (reason || ''));
}
await page.evaluate(() => KH.unload());
if (!SW) fs.writeFileSync(path.join(PACK, 'index.json'), JSON.stringify(idx, null, 1));
fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'test-results', 'kodama-preflight' + (SW ? '-swiftshader' : '') + '.json'), JSON.stringify({ gpu, W, H, rows }, null, 1));
await browser.close();
