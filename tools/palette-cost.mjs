// fps cost of each palette on the software floor (SwiftShader), Kodama mode, at a quality level.
//   node tools/palette-cost.mjs [--gpu] [--level=low|med|high] [scene=pk18]   (needs node serve.mjs --port 8091)
import fs from 'node:fs';
import { chromium } from 'playwright';
const GPU = process.argv.includes('--gpu');
const SCENE = process.argv.slice(2).find(a => /^(pk|kv)\d+$/.test(a)) || 'pk18';
const LEVEL = (process.argv.find(a => a.startsWith('--level=')) || '--level=low').slice(8);
const b = await chromium.launch({ headless: true, args: [GPU ? '--use-angle=d3d11' : '--use-angle=swiftshader', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
await p.goto('http://localhost:8091/?i=pcost');
await p.waitForFunction(() => window.PHVJ && PHVJ.state.kscenes > 0, null, { timeout: 20000 });
await p.evaluate(lv => { const q = document.getElementById('s-q'); q.value = lv; q.dispatchEvent(new Event('change')); }, LEVEL);
await p.evaluate(() => PHVJ.setMode('kodama', { instant: true }));
await p.evaluate(id => { PHVJ.setPlaying(false); PHVJ.show(id, { cut: true }); }, SCENE);
await p.waitForFunction(() => PHVJ.state.kready && PHVJ.state.kframes === 1, null, { timeout: 30000 });
const gpu = await p.textContent('#gpu');
const fps = async () => {
  const xs = [];
  await p.waitForTimeout(2500);
  for (let k = 0; k < 8; k++) { await p.waitForTimeout(1000); xs.push((await p.evaluate(() => PHVJ.state.fps)) || 0); }
  return xs.reduce((a, x) => a + x, 0) / xs.length;
};
const rows = [];
const cases = [
  ['original', { style: 'original', int: 1, con: 1 }], ['grayscale', { style: 'grayscale' }], ['bw', { style: 'bw', thr: 0.3 }],
  ['mono', { style: 'mono' }], ['duotone', { style: 'duotone' }], ['rg', { style: 'rg' }],
  ['grayscale, intensity 0.5, contrast 1.4', { style: 'grayscale', int: 0.5, con: 1.4 }],
];
let base = 0;
for (const [name, pal] of cases) {
  await p.evaluate(pal => PHVJ.setPal(pal), pal);
  const f = await fps();
  if (!base) base = f;
  rows.push({ palette: name, fps: +f.toFixed(1), cost: +((1 - f / base) * 100).toFixed(1) });
  console.log(name.padEnd(40) + f.toFixed(1).padStart(6) + ' fps  ' + ((1 - f / base) * 100).toFixed(1).padStart(6) + '%');
}
console.log(gpu + ', scene ' + SCENE + ', level ' + LEVEL);
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync('test-results/palette-cost' + (GPU ? '-gpu' : '-swiftshader') + '-' + LEVEL + '.json', JSON.stringify({ gpu, scene: SCENE, level: LEVEL, rows }, null, 1));
await b.close();
