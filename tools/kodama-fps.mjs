// In-app fps per kodama scene: the app at a quality level, each scene on screen for a few seconds.
//   node tools/kodama-fps.mjs [--swiftshader] [--level high|med|low] [--only pk26,pk27] [--secs 6]
// Needs `node serve.mjs --port 8091`. Writes test-results/kodama-fps[-swiftshader].json.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SW = process.argv.includes('--swiftshader');
const LEVEL = arg('--level', SW ? 'low' : 'high');
const ONLY = arg('--only', 'pk26,pk27,pk28,pk29,pk30,pk31,pk32,pk33').split(',');
const SECS = Number(arg('--secs', 6));
const b = await chromium.launch({ headless: true, args: [SW ? '--use-angle=swiftshader' : '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto('http://localhost:8091/?i=kfps');
await p.waitForFunction(() => window.PHVJ && PHVJ.state.kscenes > 0, null, { timeout: 20000 });
await p.evaluate(l => { const s = document.getElementById('s-q'); s.value = l; s.dispatchEvent(new Event('change')); }, LEVEL);
await p.evaluate(() => { PHVJ.setMode('kodama', { instant: true }); PHVJ.setPlaying(false); });
const gpu = await p.textContent('#gpu');
const rows = [];
for (const id of ONLY) {
  await p.evaluate(id => PHVJ.show(id, { cut: true }), id);
  await p.waitForFunction(id => PHVJ.state.cur === id && PHVJ.state.kready, id, { timeout: 20000 });
  await p.waitForTimeout(1500);
  const fps = [];
  for (let k = 0; k < SECS; k++) { await p.waitForTimeout(1000); fps.push(await p.evaluate(() => PHVJ.state.fps)); }
  const lvl = await p.evaluate(() => PHVJ.state.level);
  // the level column shows whether auto-drop stepped down during the run
  const row = { id, level: lvl, fpsMin: +Math.min(...fps).toFixed(1), fpsAvg: +(fps.reduce((a, c) => a + c, 0) / fps.length).toFixed(1) };
  rows.push(row);
  console.log(id.padEnd(5) + ' ' + lvl.padEnd(4) + ' avg ' + String(row.fpsAvg).padStart(5) + '  min ' + String(row.fpsMin).padStart(5));
}
await b.close();
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(path.join('test-results', 'kodama-fps' + (SW ? '-swiftshader' : '') + '.json'), JSON.stringify({ gpu, level: LEVEL, rows }, null, 1));
console.log(gpu);
