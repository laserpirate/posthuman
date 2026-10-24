// Palette check on real screen pixels: headed Google Chrome on the real GPU, the screen copied by
// the OS (tools/screen-grab.ps1), not a DevTools screenshot. Controller stage and output window,
// windowed and in full screen, Kodamas and Hydras.
//   node serve.mjs --port 8091 &   then   node tools/palette-screen.mjs [base url]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://localhost:8091/';
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'phpal-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [], problems = [];
function assert(c, m) { if (!c) throw new Error(m); }
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('FAIL ' + name + ' :: ' + e.message); }
}

// the page's stage, in physical screen pixels, copied from the screen
let grabN = 0;
async function grab(p, sel = '#stage') {
  const r = await p.evaluate(sel => {
    const b = document.querySelector(sel).getBoundingClientRect(), d = devicePixelRatio;
    const fs = !!document.fullscreenElement;
    // the content area's top-left on screen: the browser frame is on the left/right/bottom edges evenly
    const side = fs ? 0 : (outerWidth - innerWidth) / 2;
    const top = fs ? 0 : outerHeight - innerHeight - side;
    return { x: Math.round((screenX + side + b.x) * d), y: Math.round((screenY + top + b.y) * d), w: Math.round(b.width * d), h: Math.round(b.height * d) };
  }, sel);
  // keep clear of the edges (window frame rounding, the menu bar's auto-hide area)
  const pad = Math.round(Math.min(r.w, r.h) * 0.08);
  const out = path.join(TMP, 'g' + (++grabN) + '.png');
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join('tools', 'screen-grab.ps1'),
    String(r.x + pad), String(r.y + pad * 2), String(r.w - pad * 2), String(r.h - pad * 3), out]);
  return PNG.sync.read(fs.readFileSync(out));
}
function stats(png) {
  let n = 0, luma = 0, chroma = 0, lit = 0, chromaSum = 0;
  const levels = new Set(), hist = new Map();
  for (let i = 0; i < png.data.length; i += 16) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b; chroma = Math.max(chroma, mx - mn); chromaSum += mx - mn;
    if (mx > 24) lit++;
    levels.add(r >> 2);
    const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4); hist.set(k, (hist.get(k) || 0) + 1);
    n++;
  }
  // share of pixels within the two most common colour cells (B/W: almost everything)
  const top2 = [...hist.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / n;
  return { luma: +(luma / n).toFixed(1), chroma, chromaAvg: +(chromaSum / n).toFixed(2), lit: +(lit / n).toFixed(3), levels: levels.size, top2: +top2.toFixed(3) };
}
function bwOk(s) { return s.chroma <= 6 && s.top2 >= 0.97; }

const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--window-position=0,0', '--window-size=1400,860', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate'],
});
const ctx = await browser.newContext({ viewport: null });
async function page(q) {
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') problems.push(q + ' console: ' + m.text()); });
  p.on('pageerror', e => problems.push(q + ' pageerror: ' + e.message));
  await p.goto(BASE + q);
  await p.waitForFunction(() => window.PHVJ && PHVJ.state.cur !== undefined);
  await p.evaluate(() => { if (PHVJ.state.settings.credits) document.getElementById('b-cred').click(); });
  await p.bringToFront();
  return p;
}
async function toKodama(p) {
  await p.waitForFunction(() => PHVJ.state.kscenes > 0, null, { timeout: 20000 });
  if ((await p.evaluate(() => PHVJ.state.mode)) !== 'kodama') await p.click('#b-mk');
  await p.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 20000 });
  await p.evaluate(() => PHVJ.setPlaying(false));
  await wait(800);
}
const setPal = (p, ch) => p.evaluate(ch => PHVJ.setPal(ch), ch);
async function enterFs(p) {
  await p.keyboard.press('f');
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
  await p.mouse.move(5, 400); await wait(1500);
}
async function leaveFs(p) { await p.evaluate(() => document.exitFullscreen()); await wait(800); }

async function checkSet(p, label, sel) {
  await setPal(p, { style: 'original', int: 1, con: 1 }); await wait(600);
  const o = stats(await grab(p, sel));
  assert(o.lit > 0.02 && o.chroma > 30, label + ': original is lit and coloured ' + JSON.stringify(o));
  await setPal(p, { style: 'grayscale' }); await wait(600);
  const g = stats(await grab(p, sel));
  assert(g.chroma <= 6, label + ': grayscale has no chroma ' + JSON.stringify(g));
  await setPal(p, { style: 'bw', thr: 0.15 }); await wait(600);
  const b = stats(await grab(p, sel));
  assert(bwOk(b), label + ': B/W has two values ' + JSON.stringify(b));
  await setPal(p, { style: 'mono', mono: '#ff0000' }); await wait(600);
  const m = stats(await grab(p, sel));
  await setPal(p, { style: 'duotone', pre: 'cm', a: '#00b7c7', b: '#e0309e' }); await wait(600);
  const d = stats(await grab(p, sel));
  assert(d.lit > 0.5, label + ': duotone lifts the shadows to cyan ' + JSON.stringify(d));
  await setPal(p, { style: 'original' }); await wait(400);
  console.log('   ' + label, JSON.stringify({ o, g, b, m, d }));
}

console.log('Palette on screen pixels against ' + BASE);
await test('kodama palette on the controller stage, windowed', async () => {
  const p = await page('?i=palscr');
  await toKodama(p);
  await checkSet(p, 'controller windowed');
  await p.close();
});
await test('kodama palette on the controller stage, full screen', async () => {
  const p = await page('?i=palscr');
  await toKodama(p);
  await enterFs(p);
  await checkSet(p, 'controller full screen');
  await leaveFs(p);
  await p.close();
});
await test('kodama palette in the output window, windowed and full screen', async () => {
  const p = await page('?i=palout');
  await toKodama(p);
  await p.evaluate(() => PHVJ.setPal({ style: 'original' }));
  const o = await page('?i=palout&out=1');
  await o.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 20000 });
  await wait(1000);
  // the controller drives; the output window is the one on screen
  const drive = async ch => { await p.evaluate(ch => PHVJ.setPal(ch), ch); await o.bringToFront(); await wait(700); return stats(await grab(o)); };
  const run = async label => {
    const g = await drive({ style: 'grayscale' });
    assert(g.chroma <= 6, label + ': grayscale has no chroma ' + JSON.stringify(g));
    const b = await drive({ style: 'bw', thr: 0.15 });
    assert(bwOk(b), label + ': B/W two values ' + JSON.stringify(b));
    const x = await drive({ style: 'original' });
    assert(x.chroma > 30, label + ': original back ' + JSON.stringify(x));
    console.log('   ' + label, JSON.stringify({ g, b, x }));
  };
  await o.bringToFront();
  await run('output windowed');
  await enterFs(o);
  await run('output full screen');
  // switching scenes keeps the palette
  await p.evaluate(() => PHVJ.setPal({ style: 'grayscale' }));
  await p.evaluate(() => PHVJ.next());
  await o.waitForFunction(() => PHVJ.state.kready && !PHVJ.state.fading, null, { timeout: 20000 });
  await wait(2500);
  await o.bringToFront();
  const after = stats(await grab(o));
  assert(after.chroma <= 6 && after.lit > 0.01, 'grayscale kept across a scene switch ' + JSON.stringify(after));
  await leaveFs(o);
  await o.close(); await p.close();
});
await test('hydra palette on the controller stage, windowed and full screen', async () => {
  const p = await page('?i=palhy');
  if ((await p.evaluate(() => PHVJ.state.mode)) !== 'hydra') { await p.click('#b-mh'); await wait(1500); }
  await p.waitForFunction(() => PHVJ.state.cur && !PHVJ.state.fading, null, { timeout: 20000 });
  await p.evaluate(() => PHVJ.setPlaying(false));
  // a sketch that is colourful and stays lit
  await p.evaluate(() => PHVJ.show('marianne_0', { cut: true }));
  await wait(1500);
  await setPal(p, { style: 'grayscale' }); await wait(600);
  const g = stats(await grab(p));
  assert(g.chroma <= 6, 'hydra grayscale ' + JSON.stringify(g));
  await enterFs(p);
  const gf = stats(await grab(p));
  assert(gf.chroma <= 6, 'hydra grayscale full screen ' + JSON.stringify(gf));
  await leaveFs(p);
  await setPal(p, { style: 'original' });
  console.log('   hydra', JSON.stringify({ g, gf }));
  await p.close();
});

await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(pass + '/' + results.length + ' passed; console errors: ' + problems.length);
for (const x of problems.slice(0, 10)) console.log('   ' + x);
fs.writeFileSync(path.join('test-results', 'palette-screen.json'), JSON.stringify({ when: new Date().toISOString(), base: BASE, results, problems }, null, 1));
process.exit(pass === results.length && !problems.length ? 0 : 1);
