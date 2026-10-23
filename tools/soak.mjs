// Soak test: autoplay through the full pool at 10 s per sketch, on the real GPU, for N minutes.
//   node serve.mjs --port 8091 &   then   node tools/soak.mjs [minutes=32] [base url] [--headless]
// Pass criteria: no WebGL context lost, no console errors, stable fps, JS heap does not climb.
// Writes test-results/soak.json and prints a summary.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const MIN = Number(args.find(a => /^\d+(\.\d+)?$/.test(a)) || 32);
const BASE = args.find(a => a.startsWith('http')) || 'http://localhost:8091/';
const headless = args.includes('--headless');

const browser = await chromium.launch({
  headless,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 860 } });
const page = await ctx.newPage();
const problems = [];
let navigations = 0;
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 300) }); });
page.on('pageerror', e => problems.push({ t: Date.now(), type: 'pageerror', text: e.message }));
page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
await page.goto(BASE + '?i=soak');
await page.waitForFunction(() => window.PHVJ);
const cdp = await ctx.newCDPSession(page);

// the full pool (minus quarantine), 10 s each, crossfade 2 s, playing
await page.evaluate(() => {
  const L = PHVJ.state.list.map(i => i.id);
  document.querySelector('#def-dur').value = '10';
  document.querySelector('#def-dur').dispatchEvent(new Event('change'));
  for (const id of L) document.querySelector(`#pl-list li[data-id="${id}"] [data-act=rm]`).click();
  for (const s of PH_DATA.sketches) if (!s.quarantine) PHVJ.addToList(s.id);
  PHVJ.show(PHVJ.state.list[0].id, { cut: true });
  PHVJ.setPlaying(true);
});
const poolSize = await page.evaluate(() => PHVJ.state.list.length);
console.log(`soak: ${poolSize} sketches, 10 s each, ${MIN} min, ${headless ? 'headless' : 'headed'}, GPU ${await page.textContent('#gpu')}`);

async function heap() {
  await cdp.send('HeapProfiler.collectGarbage');
  const h = await cdp.send('Runtime.getHeapUsage');
  return h.usedSize / 1048576;
}
const samples = [];
const seen = new Set();
const t0 = Date.now();
let lastCur = null, switches = 0;
while (Date.now() - t0 < MIN * 60000) {
  for (let k = 0; k < 30; k++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => PHVJ.state);
    if (s.cur !== lastCur) { switches++; lastCur = s.cur; seen.add(s.cur); }
  }
  const s = await page.evaluate(() => ({ ...PHVJ.state, dom: document.getElementsByTagName('*').length }));
  const row = { min: +((Date.now() - t0) / 60000).toFixed(2), fps: +s.fps.toFixed(1), heapMB: +(await heap()).toFixed(2), level: s.level, hydras: s.hydras, ctxLost: s.ctxLost, skips: s.skips, errors: s.errors, dom: s.dom, cur: s.cur };
  samples.push(row);
  console.log(JSON.stringify(row));
}
const log = await page.evaluate(() => [...document.querySelectorAll('#log li')].map(l => l.textContent));
await browser.close();

const fps = samples.map(s => s.fps), heaps = samples.map(s => s.heapMB);
const third = Math.max(1, Math.floor(samples.length / 3));
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const heapFirst = avg(heaps.slice(0, third)), heapLast = avg(heaps.slice(-third));
const last = samples[samples.length - 1];
const summary = {
  base: BASE, minutes: MIN, headless, poolSize, switches, distinctPlayed: seen.size,
  fpsMin: Math.min(...fps), fpsMax: Math.max(...fps), fpsAvg: +avg(fps).toFixed(2),
  heapStartMB: heaps[0], heapEndMB: heaps[heaps.length - 1], heapFirstThirdMB: +heapFirst.toFixed(2), heapLastThirdMB: +heapLast.toFixed(2),
  hydras: last.hydras, ctxLost: last.ctxLost, reloads: navigations - 1, skips: last.skips, consoleProblems: problems.length,
  quality: last.level,
};
summary.pass = summary.ctxLost === 0 && summary.reloads === 0 && summary.consoleProblems === 0 && summary.hydras === 2 &&
  summary.fpsMin >= 24 && heapLast - heapFirst < 2;
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(path.join('test-results', 'soak.json'), JSON.stringify({ summary, samples, problems, log }, null, 1));
console.log('\nSUMMARY', JSON.stringify(summary, null, 1));
if (problems.length) console.log('problems:', problems.slice(0, 10));
process.exit(summary.pass ? 0 : 1);
