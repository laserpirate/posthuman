// End-to-end tests (Playwright, Chromium on the real GPU).
//   node serve.mjs --port 8091 &   then   node tools/e2e.mjs [base url]
// Base url defaults to http://localhost:8091/ ; pass https://laserpirate.github.io/posthuman/ for the live run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://localhost:8091/';
const HEADED = process.argv.includes('--headed');
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const browser = await chromium.launch({ headless: !HEADED, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const results = [];
const consoleProblems = [];
const offsite = [];

async function ctx(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true, ...opts });
  if (LOCAL) {
    // offline check: nothing may load from anywhere but this server
    await c.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(BASE) || u.startsWith('blob:') || u.startsWith('data:')) return r.continue();
      offsite.push(u);
      return r.abort();
    });
  }
  return c;
}
async function open(c, query = '') {
  const p = await c.newPage();
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => consoleProblems.push('pageerror: ' + e.message));
  p.answer = 'Second';
  p.on('dialog', d => d.type() === 'prompt' ? d.accept(p.answer) : d.accept());
  await p.goto(BASE + query);
  await p.waitForFunction(() => window.PHVJ && PHVJ.state.cur !== undefined);
  return p;
}
const st = p => p.evaluate(() => PHVJ.state);
const wait = ms => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('PASS', name); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, err: e.message }); console.log('FAIL', name, '::', e.message); }
}
// what is really on screen: screenshot the stage area, count lit pixels
async function screenLit(p) {
  const r = await p.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  if (r.w < 20 || r.h < 20) return { lit: 0, white: 0, rect: r };
  const png = PNG.sync.read(await p.screenshot({ clip: { x: r.x, y: r.y, width: Math.min(r.w, 1600), height: Math.min(r.h, 900) } }));
  let lit = 0, white = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 16) { // every 4th pixel
    const mx = Math.max(png.data[i], png.data[i + 1], png.data[i + 2]), mn = Math.min(png.data[i], png.data[i + 1], png.data[i + 2]);
    n++; if (mx > 24) lit++; if (mn > 245) white++;
  }
  return { lit: lit / n, white: white / n, rect: r };
}
const notBlank = q => q.lit > 0.02 && q.white < 0.98;

// set the playlist through the test handle: clear, then add ids
async function setList(p, ids, dur) {
  await p.click('[data-tab=playlist]');
  if ((await st(p)).list.length) await p.click('#pl-clear');
  await p.fill('#def-dur', String(dur));
  await p.press('#def-dur', 'Enter');
  await p.evaluate(ids => ids.forEach(id => PHVJ.addToList(id)), ids);
}

await test('loads with 2 hydra instances, GPU, no errors', async () => {
  const c = await ctx(); const p = await open(c);
  await wait(1500);
  const s = await st(p);
  assert(s.hydras === 2, 'hydras ' + s.hydras);
  assert(s.cur === 'celeste_1', 'first favorite on stage, got ' + s.cur);
  assert(s.list.length === 7, 'starting playlist has the 7 favorites');
  assert(s.stars.length === 7, 'favorites starred');
  assert(s.settings.defaultDur === 30 && s.settings.transition === 'xfade' && s.settings.xfadeSec === 2, 'defaults 30 s, crossfade 2 s');
  assert(s.level === 'med', 'quality med by default');
  assert(await p.textContent('#bar .brand b') === 'POST/HUMAN · VJ', 'title');
  assert(s.ticks[0] > 10, 'deck A ticking');
  console.log('   GPU:', await p.textContent('#gpu'));
  await c.close();
});

await test('gallery: all sketches, quarantine, search, starred filter', async () => {
  const c = await ctx(); const p = await open(c);
  await p.click('[data-tab=gallery]');
  assert(await p.locator('.cardg').count() === 58, 'cards');
  const q = await p.evaluate(() => PH_DATA.sketches.filter(s => s.quarantine).map(s => s.id));
  assert(await p.locator('.cardg .qb').count() === q.length && q.length >= 1, 'quarantine badges ' + q.length);
  const imgs = await p.evaluate(() => [...document.querySelectorAll('.cardg img')].every(i => i.getAttribute('src').startsWith('thumbs/')));
  assert(imgs, 'thumbnails are stills');
  assert(await p.locator('#g-grid canvas').count() === 0, 'no live canvases in gallery');
  await p.fill('#g-q', 'ritchse');
  assert(await p.locator('.cardg').count() === 5, 'search by author');
  await p.fill('#g-q', 'puertas');
  assert(await p.locator('.cardg').count() === 3, 'search by title');
  await p.fill('#g-q', '');
  await p.check('#g-star');
  assert(await p.locator('.cardg').count() === 7, 'starred filter');
  await p.locator('.cardg').first().locator('.star').click(); // unstar
  assert(await p.locator('.cardg').count() === 6, 'unstar removes from starred view');
  await p.uncheck('#g-star');
  await p.locator('.cardg[data-id="example_3"] .star').click();
  assert((await st(p)).stars.includes('example_3'), 'star toggle');
  const href = await p.getAttribute('.cardg[data-id="example_3"] a', 'href');
  assert(href.startsWith('https://hydra.ojack.xyz/?code='), 'edit in hydra link');
  // quarantined sketches are never autoplayed or pulled
  await setList(p, [], 30);
  await p.fill('#pull-n', '58');
  await p.click('#pull');
  const ids = (await st(p)).list.map(i => i.id);
  assert(q.every(id => !ids.includes(id)), 'pull skips quarantined');
  await c.close();
});

await test('playlist: add, pull, remove, up/down, drag, shuffle, durations, apply to all', async () => {
  const c = await ctx(); const p = await open(c);
  await p.click('#pl-clear');
  assert((await st(p)).list.length === 0, 'clear');
  await p.click('[data-tab=gallery]');
  for (const id of ['example_3', 'rangga_0', 'nesso_0']) await p.click(`.cardg[data-id="${id}"] [data-act=add]`);
  await p.click(`.cardg[data-id="nesso_0"] [data-act=add]`, { force: true }).catch(() => {});
  let s = await st(p);
  assert(s.list.map(i => i.id).join() === 'example_3,rangga_0,nesso_0', 'add from gallery, no duplicates: ' + s.list.map(i => i.id));
  await p.click('[data-tab=playlist]');
  await p.fill('#pull-n', '5'); await p.selectOption('#pull-from', 'pool'); await p.click('#pull');
  s = await st(p);
  assert(s.list.length === 8 && new Set(s.list.map(i => i.id)).size === 8, 'pull 5, no duplicates');
  await p.selectOption('#pull-from', 'starred'); await p.fill('#pull-n', '50'); await p.click('#pull');
  s = await st(p);
  assert(new Set(s.list.map(i => i.id)).size === s.list.length, 'pull from starred, no duplicates');
  assert(s.stars.every(id => s.list.some(i => i.id === id) || id === 'flor_1'), 'all starred pulled');
  const n0 = s.list.length;
  await p.click('#pl-list li:nth-child(2) [data-act=rm]');
  s = await st(p);
  assert(s.list.length === n0 - 1 && !s.list.some(i => i.id === 'rangga_0'), 'remove');
  let before = s.list.map(i => i.id);
  await p.click('#pl-list li:nth-child(1) [data-act=down]');
  s = await st(p);
  assert(s.list[0].id === before[1] && s.list[1].id === before[0], 'down');
  await p.click('#pl-list li:nth-child(2) [data-act=up]');
  s = await st(p);
  assert(s.list.map(i => i.id).join() === before.join(), 'up');
  // drag the first item below the third
  await p.locator('#pl-list li:nth-child(1) .h').dragTo(p.locator('#pl-list li:nth-child(3)'), { targetPosition: { x: 40, y: 22 } });
  s = await st(p);
  const want = [before[1], before[2], before[0], ...before.slice(3)];
  assert(s.list.map(i => i.id).join() === want.join(), 'drag reorder: ' + s.list.slice(0, 4).map(i => i.id) + ' want ' + want.slice(0, 4));
  before = s.list.map(i => i.id);
  let shuffled = false;
  for (let k = 0; k < 5 && !shuffled; k++) {
    await p.click('#pl-shuf');
    const now = (await st(p)).list.map(i => i.id);
    assert([...now].sort().join() === [...before].sort().join(), 'shuffle keeps items');
    shuffled = now.join() !== before.join();
  }
  assert(shuffled, 'shuffle changes order');
  await p.fill('#pl-list li:nth-child(1) input', '7');
  await p.dispatchEvent('#pl-list li:nth-child(1) input', 'change');
  s = await st(p);
  assert(s.list[0].dur === 7, 'duration edit');
  await p.fill('#def-dur', '12'); await p.click('#pl-apply');
  s = await st(p);
  assert(s.list.every(i => i.dur === 12) && s.settings.defaultDur === 12, 'apply to all');
  await c.close();
});

await test('playlists: named lists, switcher, export/import round trip', async () => {
  const c = await ctx(); const p = await open(c);
  p.answer = 'Second';
  await p.click('#pl-new');
  let s = await st(p);
  assert(s.active === 'Second' && s.lists.length === 2, 'new named playlist');
  await p.evaluate(() => ['khoparzi_0', 'khoparzi_1'].forEach(id => PHVJ.addToList(id)));
  await p.selectOption('#pl-sel', 'Favorites');
  s = await st(p);
  assert(s.active === 'Favorites' && s.list.length === 7, 'switcher');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pl-exp')]);
  const file = path.join(os.tmpdir(), 'phvj-export-' + Date.now() + '.json');
  await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(exported.lists.Second.length === 2 && exported.lists.Favorites.length === 7, 'export content');
  // import into a fresh instance
  const p2 = await open(c, '?i=importtest');
  await p2.setInputFiles('#pl-file', file);
  await p2.waitForFunction(() => PHVJ.state.lists.includes('Second'));
  const s2 = await st(p2);
  assert(JSON.stringify(s2.lists.sort()) === JSON.stringify(['Favorites', 'Second']), 'import lists ' + s2.lists);
  await p2.selectOption('#pl-sel', 'Second');
  assert((await st(p2)).list.map(i => i.id).join() === 'khoparzi_0,khoparzi_1', 'import items');
  fs.unlinkSync(file);
  await c.close();
});

await test('autoplay: advances on time, loops, pause/next/prev', async () => {
  const c = await ctx(); const p = await open(c);
  await setList(p, ['example_3', 'example_14', 'example_15'], 2);
  await p.selectOption('#s-trans', 'cut');
  await p.click('#pl-list li:nth-child(1) .t');
  await p.keyboard.press('Space');
  assert((await st(p)).playing, 'space plays');
  const seen = [];
  const t0 = Date.now();
  let last = (await st(p)).cur;
  seen.push([0, last]);
  while (Date.now() - t0 < 7200) {
    const cur = (await st(p)).cur;
    if (cur !== last) { seen.push([Date.now() - t0, cur]); last = cur; }
    await wait(50);
  }
  const order = seen.map(x => x[1]).join();
  assert(order.startsWith('example_3,example_14,example_15,example_3'), 'order and loop: ' + order);
  const gaps = seen.slice(1).map((x, i) => x[0] - seen[i][0]).slice(1);
  assert(gaps.every(g => g > 1600 && g < 2500), 'switch every 2 s: ' + gaps);
  await p.keyboard.press('Space');
  const e1 = (await st(p)).elapsed; await wait(800); const e2 = (await st(p)).elapsed;
  assert(!(await st(p)).playing && e1 === e2, 'pause stops the timer');
  const a = (await st(p)).cur;
  await p.keyboard.press('ArrowRight');
  const b = (await st(p)).cur;
  assert(a !== b, 'next');
  await p.keyboard.press('ArrowLeft');
  assert((await st(p)).cur === a, 'previous');
  await p.click('#b-next'); assert((await st(p)).cur === b, 'next button');
  await p.click('#b-prev'); assert((await st(p)).cur === a, 'prev button');
  const count = await p.textContent('#count');
  assert(/paused \d:\d\d/.test(count), 'countdown shows: ' + count);
  await c.close();
});

await test('random mode covers every item before any repeat', async () => {
  const c = await ctx(); const p = await open(c);
  const ids = ['example_3', 'example_14', 'example_15', 'rangga_0', 'rangga_1', 'naoto_0'];
  await setList(p, ids, 30);
  await p.selectOption('#s-trans', 'cut');
  await p.click('#pl-list li:nth-child(1) .t'); // start on an item of the playlist
  await p.keyboard.press('r');
  assert((await st(p)).settings.random, 'R toggles random');
  // each cycle plays every item once; the item that ends one cycle starts the window of the next
  const picks = [(await st(p)).cur];
  for (let k = 0; k < (ids.length - 1) * 4; k++) { await p.keyboard.press('ArrowRight'); picks.push((await st(p)).cur); }
  for (let b = 0; b < 4; b++) {
    const win = picks.slice(b * (ids.length - 1), b * (ids.length - 1) + ids.length);
    assert(new Set(win).size === ids.length, 'cycle ' + b + ' covers all before a repeat: ' + win + ' / log: ' + (await p.textContent('#log')).slice(0, 400));
  }
  // pool scope
  await p.selectOption('#s-scope', 'pool');
  const pool = new Set();
  for (let k = 0; k < 20; k++) { await p.keyboard.press('ArrowRight'); pool.add((await st(p)).cur); }
  assert(pool.size === 20, 'pool random without repeats');
  assert([...pool].some(id => !ids.includes(id)), 'pool scope reaches outside the playlist');
  await c.close();
});

await test('transitions: crossfade completes, idle deck stops; cut is instant', async () => {
  const c = await ctx(); const p = await open(c);
  await setList(p, ['example_3', 'example_14'], 30);
  await p.selectOption('#s-trans', 'xfade');
  await p.fill('#n-xfade', '1'); await p.dispatchEvent('#n-xfade', 'change');
  await p.click('#b-next');
  await wait(450);
  let s = await st(p);
  assert(s.fading, 'fading');
  const mid = s.opacity.map(Number).filter(x => x > 0 && x < 1);
  assert(mid.length === 1, 'mid fade opacity ' + s.opacity);
  await wait(900);
  s = await st(p);
  assert(!s.fading && s.opacity[s.live] === '1' && s.opacity[1 - s.live] === '0', 'crossfade complete ' + s.opacity);
  const idleTicks = s.ticks[1 - s.live];
  await wait(700);
  s = await st(p);
  assert(s.ticks[1 - s.live] === idleTicks, 'idle deck not ticking');
  await p.selectOption('#s-trans', 'cut');
  await p.click('#b-next');
  s = await st(p);
  assert(!s.fading && s.opacity[s.live] === '1' && s.opacity[1 - s.live] === '0', 'cut instant');
  for (let k = 0; k < 30; k++) await p.click('#b-next');
  assert((await st(p)).hydras === 2, 'still 2 hydra instances after 30 switches');
  await c.close();
});

await test('full screen: code hidden, credits hidden, menu auto-hides and returns', async () => {
  const c = await ctx(); const p = await open(c);
  await p.keyboard.press('c');
  assert((await st(p)).code, 'C shows code in window');
  await p.keyboard.press('f');
  await p.waitForFunction(() => PHVJ.state.fs, null, { timeout: 3000 }).catch(() => {});
  let real = (await st(p)).fs;
  if (!real) { await p.evaluate(() => PHVJ.setFs(true)); console.log('   (headless refused the Fullscreen API; forced the full screen state)'); }
  assert(!(await st(p)).code && !(await p.isVisible('#code-ov')), 'code hidden entering full screen');
  assert(!(await p.isVisible('#credit')), 'no credits line in full screen');
  assert(!(await p.isVisible('#panel')), 'panel hidden');
  await p.mouse.move(400, 300);
  assert(await p.evaluate(() => !document.body.classList.contains('idle')), 'menu shown after mouse move');
  await wait(3400);
  assert(await p.evaluate(() => document.body.classList.contains('idle')), 'menu hidden after 3 s');
  await p.mouse.move(420, 320);
  assert(await p.evaluate(() => !document.body.classList.contains('idle')), 'menu back on mouse move');
  await p.keyboard.press('c');
  assert(await p.isVisible('#code-ov'), 'C toggles code on in full screen');
  await p.keyboard.press('c');
  if (real) { await p.evaluate(() => document.exitFullscreen()); await p.waitForFunction(() => !PHVJ.state.fs); }
  else await p.evaluate(() => PHVJ.setFs(false));
  assert(await p.isVisible('#credit'), 'credits back in window');
  await p.keyboard.press('h');
  assert(!(await p.isVisible('#bar')), 'H hides menu');
  await p.keyboard.press('h');
  assert(await p.isVisible('#bar'), 'H shows menu');
  await p.keyboard.press('?');
  assert(await p.isVisible('#help'), '? card');
  await p.keyboard.press('Escape');
  assert(!(await p.isVisible('#help')), 'Esc closes card');
  await c.close();
});

await test('full screen shows the sketch: pixels, transitions, quality, 20 toggles, all entry points', async () => {
  const c = await ctx(); const p = await open(c);
  await setList(p, ['example_3', 'example_14', 'nesso_0', 'rangga_4'], 30);
  await p.selectOption('#s-trans', 'xfade');
  await p.fill('#n-xfade', '1'); await p.press('#n-xfade', 'Enter');
  await p.selectOption('#s-q', 'high');
  await p.click('#pl-list li:nth-child(1) .t');
  await p.keyboard.press('Space');
  await wait(500);
  const win = await screenLit(p);
  assert(notBlank(win), 'window stage lit ' + JSON.stringify(win));
  const enter = async how => {
    if (how === 'button') await p.click('#b-full');
    else if (how === 'key') await p.keyboard.press('f');
    else await p.dblclick('#stage', { position: { x: 200, y: 150 } });
    await p.waitForFunction(() => PHVJ.state.fs, null, { timeout: 2000 });
  };
  const leave = async () => {
    await p.keyboard.press('f');
    await p.waitForFunction(() => !PHVJ.state.fs, null, { timeout: 2000 });
  };
  for (const how of ['button', 'key', 'dblclick']) {
    await enter(how);
    await wait(1000);
    const q = await screenLit(p);
    const vp = p.viewportSize();
    assert(q.rect.w >= vp.width - 2 && q.rect.h >= vp.height - 2, how + ': stage fills the screen ' + JSON.stringify(q.rect));
    assert(notBlank(q), how + ': not blank within 1 s ' + JSON.stringify(q));
    await leave();
  }
  await enter('key');
  for (let k = 0; k < 3; k++) {
    await p.keyboard.press('ArrowRight');
    let t = 0;
    for (const ms of [300, 700, 1300]) { await wait(ms - t); t = ms; const q = await screenLit(p); assert(notBlank(q), 'transition ' + k + ' at ' + ms + ' ms ' + JSON.stringify(q)); }
    const s = await st(p);
    assert(await p.textContent('#now') === (await p.evaluate(id => { const x = PH_DATA.sketches.find(z => z.id === id); return x.title + ' · ' + x.author; }, s.cur)), 'menu title matches the sketch on screen');
  }
  await p.keyboard.press('ArrowLeft'); await wait(1300);
  assert(notBlank(await screenLit(p)), 'after previous');
  await p.evaluate(() => { const s = document.getElementById('s-q'); s.value = 'low'; s.dispatchEvent(new Event('change')); });
  await wait(600);
  assert(notBlank(await screenLit(p)), 'after quality change');
  await leave();
  for (let k = 0; k < 20; k++) { await enter('key'); await leave(); }
  await enter('key'); await wait(800);
  assert(notBlank(await screenLit(p)), 'after 20 toggles');
  await leave();
  const r = await p.evaluate(() => ({ panel: !!document.getElementById('panel').offsetParent, bar: document.getElementById('bar').getBoundingClientRect().height, stage: document.getElementById('stage').getBoundingClientRect().width }));
  assert(r.panel && r.bar > 20 && r.stage < p.viewportSize().width, 'exit restores the layout ' + JSON.stringify(r));
  assert(notBlank(await screenLit(p)), 'window stage lit after exit');
  // fallback: a refused Fullscreen API still gives a full window that renders
  await p.evaluate(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('refused for test')); });
  await p.keyboard.press('f');
  await p.waitForFunction(() => PHVJ.state.fs);
  await wait(600);
  const fb = await screenLit(p);
  assert(notBlank(fb) && fb.rect.h >= p.viewportSize().height - 2, 'CSS full-window fallback renders ' + JSON.stringify(fb));
  await p.keyboard.press('Escape');
  assert(!(await st(p)).fs, 'Esc leaves the fallback');
  await c.close();
});

await test('clean output and the output window render the sketch (pixels)', async () => {
  const c = await ctx(); const p = await open(c, '?i=px');
  await wait(400);
  await p.click('#b-clean'); await wait(500);
  assert(notBlank(await screenLit(p)), 'clean output lit');
  await p.keyboard.press('h');
  await p.keyboard.press('h'); await wait(300);
  assert(notBlank(await screenLit(p)), 'menu hidden: stage lit');
  await p.keyboard.press('h');
  const out = await open(c, '?i=px&out=1');
  await wait(1200);
  assert(notBlank(await screenLit(out)), 'output window lit');
  await c.close();
});

await test('blackout from any state', async () => {
  const c = await ctx(); const p = await open(c);
  const covered = () => p.evaluate(() => {
    const b = document.getElementById('black'), r = b.getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect();
    return !b.hidden && getComputedStyle(b).backgroundColor === 'rgb(0, 0, 0)' && r.width >= s.width && r.height >= s.height &&
      document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2) === b;
  });
  await p.keyboard.press('b'); assert(await covered(), 'window'); await p.keyboard.press('b');
  assert(!(await p.isVisible('#black')), 'off');
  await p.evaluate(() => PHVJ.setFs(true));
  await p.keyboard.press('b'); assert(await covered(), 'full screen'); await p.keyboard.press('b');
  await p.evaluate(() => PHVJ.setFs(false));
  await p.click('#b-clean');
  await p.keyboard.press('b'); assert(await covered(), 'clean output'); await p.keyboard.press('b');
  await p.keyboard.press('h');
  assert(await p.isVisible('#bar'), 'H leaves clean output');
  await p.keyboard.press('c'); await p.keyboard.press('b'); assert(await covered(), 'over code overlay'); await p.keyboard.press('b');
  await p.click('[data-tab=gallery]'); await p.focus('#g-q'); await p.keyboard.press('Escape'); await p.keyboard.press('b');
  assert(await covered(), 'after typing in search'); await p.keyboard.press('b');
  await c.close();
});

await test('broken sketches are skipped and logged, never shown on the output', async () => {
  const c = await ctx(); const p = await open(c);
  await setList(p, [], 2);
  await p.evaluate(() => {
    PHVJ.addTestSketch('t_throw', 'osc(10).out(o0\n'); // syntax error
    PHVJ.addTestSketch('t_ref', 'nothere(1).out()'); // reference error at eval
    PHVJ.addTestSketch('t_runtime', 'osc(() => { throw new Error("boom") }).out()'); // throws on tick
    PHVJ.addTestSketch('t_black', 'solid(0,0,0).out()'); // black
    PHVJ.addTestSketch('t_white', 'solid(1,1,1).out()'); // white
    for (const id of ['example_3', 't_throw', 't_ref', 't_runtime', 't_black', 't_white', 'example_14']) PHVJ.addToList(id);
  });
  await p.evaluate(() => { for (const it of PHVJ.state.list) if (it.id === 't_black' || it.id === 't_white') document.querySelector(`#pl-list li[data-id="${it.id}"] input`).value = '10'; });
  for (const id of ['t_black', 't_white']) await p.dispatchEvent(`#pl-list li[data-id="${id}"] input`, 'change');
  await p.selectOption('#s-trans', 'cut');
  await p.click('#pl-list li:nth-child(1) .t');
  await p.keyboard.press('Space');
  await p.waitForFunction(() => PHVJ.state.cur === 'example_14', null, { timeout: 20000 });
  const s = await st(p);
  for (const id of ['t_throw', 't_ref', 't_runtime', 't_black', 't_white']) assert(s.failed.includes(id), 'skipped ' + id + ' failed=' + s.failed);
  const logText = await p.textContent('#log');
  assert(/Skipped "Test t_black".*black/.test(logText.replace(/\n/g, ' ')) || logText.includes('t_black'), 'logged');
  assert(await p.isVisible('#log-n'), 'log badge');
  const stageText = await p.evaluate(() => [...document.querySelectorAll('#stage > *')].filter(e => e.offsetParent && e.id !== 'credit').map(e => e.textContent).join(''));
  assert(!/Skipped|error/i.test(stageText), 'nothing about the skip on the stage');
  assert(s.hydras === 2, 'still 2 hydras');
  await c.close();
});

await test('reload restores playlist, position and settings', async () => {
  const c = await ctx(); const p = await open(c);
  await setList(p, ['example_3', 'example_14', 'example_15', 'rangga_0'], 20);
  await p.fill('#n-xfade', '3.5'); await p.dispatchEvent('#n-xfade', 'change');
  await p.click('#pl-list li:nth-child(3) .t');
  await p.keyboard.press('Space');
  await wait(2500);
  const a = await st(p);
  await p.reload();
  await p.waitForFunction(() => window.PHVJ);
  await wait(300);
  const b = await st(p);
  assert(b.cur === 'example_15' && a.cur === 'example_15', 'position ' + b.cur);
  assert(b.playing, 'still playing');
  assert(b.list.map(i => i.id).join() === a.list.map(i => i.id).join(), 'playlist');
  assert(b.settings.xfadeSec === 3.5 && b.settings.defaultDur === 20, 'settings');
  assert(b.elapsed >= 1500, 'time into the sketch restored: ' + b.elapsed);
  await c.close();
});

await test('instances ?i=a and ?i=b are separate; share link opens the same playlist', async () => {
  const c = await ctx(); const pa = await open(c, '?i=a');
  await setList(pa, ['example_8', 'example_9', 'rangga_2'], 15);
  assert(await pa.textContent('#inst') === 'a', 'instance shown');
  const pb = await open(c, '?i=b');
  const sb = await st(pb);
  assert(sb.inst === 'b' && sb.list.length === 7 && sb.active === 'Favorites', 'b untouched');
  await pa.reload(); await pa.waitForFunction(() => window.PHVJ);
  assert((await st(pa)).list.length === 3, 'a kept its list');
  const link = await pa.evaluate(() => PHVJ.shareLink());
  const c2 = await ctx(); const pc = await c2.newPage();
  pc.on('pageerror', e => consoleProblems.push('pageerror: ' + e.message));
  await pc.goto(link.replace(/^https?:\/\/[^/]+\/(posthuman\/)?(next\/)?/, BASE));
  await pc.waitForFunction(() => window.PHVJ);
  const sc = await st(pc);
  assert(sc.list.map(i => i.id + ':' + i.dur).join() === 'example_8:15,example_9:15,rangga_2:15', 'shared list ' + JSON.stringify(sc.list));
  assert(!(await pc.evaluate(() => location.hash)), 'hash cleared');
  await c.close(); await c2.close();
});

await test('phone width: usable, no horizontal scroll', async () => {
  const c = await ctx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await open(c);
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, 390]);
  assert(w[0] <= w[1], 'no horizontal overflow ' + w);
  for (const tab of ['playlist', 'gallery', 'live', 'code', 'credits', 'log']) {
    await p.evaluate(t => document.querySelector(`[data-tab=${t}]`).click(), tab);
    const off = await p.evaluate(() => [...document.querySelectorAll('#app *')]
      .filter(e => e.offsetParent && !e.closest('#tabs') && !e.closest('#stage')).filter(e => e.getBoundingClientRect().right > 391).map(e => e.id || e.textContent || e.type).slice(0, 5));
    assert(!off.length, tab + ' tab: controls cut off at the right edge: ' + off);
  }
  await p.evaluate(() => document.querySelector('[data-tab=playlist]').click());
  assert(await p.isVisible('#stage') && await p.isVisible('#pl-list'), 'stage and playlist visible');
  await p.screenshot({ path: path.join(os.tmpdir(), 'phvj-phone.png') });
  await c.close();
});

await test('1366x768: bar fits and stage is large', async () => {
  const c = await ctx(); const p = await open(c);
  const r = await p.evaluate(() => { const s = document.getElementById('stage').getBoundingClientRect(), b = document.getElementById('bar').getBoundingClientRect(); return { sw: s.width, sh: s.height, bh: b.height, over: document.documentElement.scrollWidth > innerWidth }; });
  assert(!r.over && r.sw >= 900 && r.bh <= 80, JSON.stringify(r));
  await c.close();
});

// ---- stretch -----------------------------------------------------------------------------------

await test('stretch: audio reactive (fake input) drives zoom and flash, off by default', async () => {
  const c = await ctx({ permissions: ['microphone'] }); const p = await open(c);
  let s = await st(p);
  assert(!s.settings.au.on && !s.audio, 'off by default');
  assert(await p.evaluate(() => getComputedStyle(document.getElementById('decks')).transform) === 'none', 'no effect when off');
  await p.click('[data-tab=live]');
  // the fake device is a tone; open the full band and the mid band, route both effects
  await p.evaluate(() => {
    for (const b of ['full', 'mid', 'low', 'high']) {
      const el = document.querySelector(`.band[data-band="${b}"] label:first-of-type input`);
      el.value = '40'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
    }
  });
  await p.selectOption('#au-zsrc', 'full');
  await p.selectOption('#au-fsrc', 'mid');
  await p.check('#au-on');
  await p.waitForFunction(() => PHVJ.state.audio, null, { timeout: 5000 });
  let maxFx = 0, sawTransform = false;
  for (let k = 0; k < 40; k++) {
    await wait(100);
    const r = await p.evaluate(() => [PHVJ.state.fx, document.getElementById('decks').style.transform]);
    maxFx = Math.max(maxFx, r[0]);
    if (r[1].startsWith('scale(')) sawTransform = true;
  }
  assert(maxFx > 0.02 && sawTransform, 'level drives the effect: max ' + maxFx);
  assert(await p.evaluate(() => document.getElementById('au-m-full').style.width !== '0%'), 'full band meter moves');
  const A = (await st(p)).A;
  assert(['full', 'low', 'mid', 'high', 'custom'].every(k => typeof A[k] === 'number') && await p.evaluate(() => typeof window.A.low === 'number'), 'A.* globals');
  assert(await p.locator('.band').count() === 5, 'five band rows with sens, smooth, threshold');
  const opts = await p.locator('#au-dev option').count();
  assert(opts >= 1, 'device picker');
  await p.uncheck('#au-on');
  s = await st(p);
  assert(!s.audio && s.fx === 0 && await p.evaluate(() => document.getElementById('decks').style.transform === ''), 'off clears the effect');
  await c.close();
});

await test('audio input: a Scarlett is picked automatically, unplug keeps visuals, replug reconnects', async () => {
  const c = await ctx({ permissions: ['microphone'] });
  // relabel the last fake input as the show interface; window.__unplug hides it, as if the USB cable came out
  await c.addInitScript(() => {
    const md = navigator.mediaDevices, orig = md.enumerateDevices.bind(md);
    md.enumerateDevices = async () => {
      const all = (await orig()).map(d => ({ kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: d.label }));
      const ins = all.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default');
      const sc = ins[ins.length - 1];
      if (sc && sc.label) { sc.label = 'Focusrite USB (Scarlett 2i2 USB)'; window.__scId = sc.deviceId; }
      return window.__unplug ? all.filter(d => d !== sc) : all;
    };
  });
  const p = await open(c, '?i=scar');
  await p.click('[data-tab=live]');
  await p.check('#au-on');
  await p.waitForFunction(() => PHVJ.state.audio, null, { timeout: 5000 });
  let s = await st(p);
  const scId = await p.evaluate(() => window.__scId);
  assert(scId && /Scarlett/.test(s.auStatus), 'Scarlett shown as the input: ' + s.auStatus);
  assert(await p.inputValue('#au-dev') === scId, 'picker shows the Scarlett');
  assert(await p.locator('#log li', { hasText: 'show interface, picked automatically' }).count() === 1, 'logged');
  const before = (await st(p)).time;
  // unplug: the track ends and the device leaves the list
  await p.evaluate(() => { window.__unplug = true; PHVJ.testEndInput(); });
  await wait(300);
  s = await st(p);
  assert(!s.audio && s.auLost && /Input lost/.test(s.auStatus) && s.settings.au.on, 'lost, said so, audio still armed: ' + s.auStatus);
  assert(s.A.full === 0 && s.fx === 0, 'no stale levels');
  await wait(800);
  assert((await st(p)).time > before && !(await st(p)).failed.length, 'visuals keep running');
  // replug
  await p.evaluate(() => { window.__unplug = false; navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await p.waitForFunction(() => PHVJ.state.audio, null, { timeout: 5000 });
  s = await st(p);
  assert(!s.auLost && /Scarlett/.test(s.auStatus), 'reconnected: ' + s.auStatus);
  // the Scarlett wins over a remembered choice on the next start too
  await p.uncheck('#au-on');
  const other = await p.evaluate(sc => [...document.querySelectorAll('#au-dev option')].map(o => o.value).find(v => v && v !== sc), scId);
  if (other) {
    await p.selectOption('#au-dev', other);
    await p.check('#au-on');
    await p.waitForFunction(() => PHVJ.state.audio, null, { timeout: 5000 });
    assert(/Scarlett/.test((await st(p)).auStatus), 'Scarlett preferred over the remembered device');
  }
  await c.close();
});

await test('stretch: output window follows the controller, reports failures back', async () => {
  const c = await ctx(); const ctl = await open(c, '?i=o');
  await setList(ctl, ['example_3', 'example_14', 'example_15'], 30);
  await ctl.selectOption('#s-trans', 'cut');
  const out = await open(c, '?i=o&out=1');
  await ctl.waitForFunction(() => PHVJ.state.outLive, null, { timeout: 4000 });
  assert((await st(ctl)).resting, 'controller preview rests while the output is open');
  assert(!(await out.isVisible('#bar')) && !(await out.isVisible('#panel')) && !(await out.isVisible('#credit')), 'output shows the stage only');
  await out.evaluate(() => { window.__writes = 0; const set = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { window.__writes++; return set.apply(this, a); }; });
  for (let k = 0; k < 3; k++) {
    await ctl.keyboard.press('ArrowRight');
    await out.waitForFunction(id => PHVJ.state.cur === id, (await st(ctl)).cur, { timeout: 2000 });
  }
  await ctl.keyboard.press('b');
  await out.waitForFunction(() => !document.getElementById('black').hidden, null, { timeout: 2000 });
  await ctl.keyboard.press('b');
  await out.waitForFunction(() => document.getElementById('black').hidden, null, { timeout: 2000 });
  const before = await st(ctl);
  // a sketch that renders white only matters on the output; the controller hears about it and moves on
  for (const pg of [ctl, out]) await pg.evaluate(() => PHVJ.addTestSketch('t_white2', 'solid(1,1,1).out()'));
  await ctl.evaluate(() => PHVJ.show('t_white2', { cut: true }));
  await ctl.waitForFunction(() => PHVJ.state.failed.includes('t_white2') && PHVJ.state.cur !== 't_white2', null, { timeout: 8000 });
  await out.waitForFunction(() => PHVJ.state.cur && PHVJ.state.cur !== 't_white2', null, { timeout: 3000 });
  assert((await st(out)).cur === (await st(ctl)).cur, 'back in step after the skip');
  assert(await out.evaluate(() => window.__writes) === 0, 'output never writes the instance state');
  await out.close();
  await ctl.waitForFunction(() => !PHVJ.state.outLive, null, { timeout: 5000 });
  assert(!(await st(ctl)).resting && before.hydras === 2, 'preview resumes when the output closes');
  await c.close();
});

await test('stretch: tap tempo and switch every N bars', async () => {
  const c = await ctx(); const p = await open(c);
  await p.click('[data-tab=live]');
  for (let k = 0; k < 5; k++) { await p.keyboard.press('t'); await wait(500); }
  let s = await st(p);
  assert(Math.abs(s.settings.bpm - 120) < 6, 'tapped bpm ' + s.settings.bpm);
  await p.fill('#n-bpm', '120'); await p.press('#n-bpm', 'Enter');
  await p.selectOption('#s-bars', '4');
  s = await st(p);
  assert(s.dur === 8, '4 bars at 120 = 8 s, got ' + s.dur);
  await p.selectOption('#s-bars', '0');
  assert((await st(p)).dur === 30, 'back to item durations');
  await c.close();
});

await test('stretch: hold, cue next, ban', async () => {
  const c = await ctx(); const p = await open(c);
  await setList(p, ['example_3', 'example_14', 'example_15', 'rangga_0', 'rangga_1'], 2);
  await p.selectOption('#s-trans', 'cut');
  await p.click('#pl-list li:nth-child(1) .t');
  await p.keyboard.press('Space');
  await p.keyboard.press('g');
  const a = await st(p); await wait(2600); const b = await st(p);
  assert(b.hold && a.cur === b.cur, 'hold keeps the sketch');
  await p.keyboard.press('g');
  await p.click('#pl-list li[data-id="rangga_0"] [data-act=cue]');
  assert((await st(p)).cue === 'rangga_0', 'cued');
  await p.keyboard.press('ArrowRight');
  assert((await st(p)).cur === 'rangga_0' && !(await st(p)).cue, 'cue plays next');
  await p.keyboard.press('x');
  let s = await st(p);
  assert(s.banned.includes('rangga_0') && s.cur !== 'rangga_0', 'X bans and skips');
  for (let k = 0; k < 8; k++) { await p.keyboard.press('ArrowRight'); assert((await st(p)).cur !== 'rangga_0', 'banned never plays'); }
  await p.click('[data-tab=live]');
  await p.click('#b-unban');
  assert((await st(p)).banned.length === 0, 'unban all');
  await c.close();
});

// ---- live edit -------------------------------------------------------------------------------------

// average colour of the stage as seen on screen
async function screenAvg(p) {
  const r = await p.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  const png = PNG.sync.read(await p.screenshot({ clip: r }));
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 40) { R += png.data[i]; G += png.data[i + 1]; B += png.data[i + 2]; n++; }
  return [R / n, G / n, B / n];
}

await test('live edit: knob parsing finds float arguments only', async () => {
  const c = await ctx(); const p = await open(c);
  const k = await p.evaluate(() => PHVJ.parseKnobs([
    'osc(40, 0.2, 1)',
    '  .modulateScale(osc(40,0,1).kaleid(8))',
    '  .color([0.5,2].smooth(1), -0.3, 0)',
    '  .rotate(() => Math.sin(time) * 0.5, 0.1)',
    '  .modulate(o0, 0.05) // 7, 8',
    '  .scale("2", Math.max(1, 2))',
    '  .out(o0)'].join('\n')).map(x => x.fn + '.' + x.name + '=' + x.value));
  const expect = ['osc.frequency=40', 'osc.sync=0.2', 'osc.offset=1', 'osc.frequency=40', 'osc.sync=0', 'osc.offset=1', 'kaleid.nSides=8', 'color.g=-0.3', 'color.b=0', 'rotate.speed=0.1', 'modulate.amount=0.05'];
  assert(JSON.stringify(k) === JSON.stringify(expect), 'knobs ' + JSON.stringify(k));
  // every gallery sketch parses and its getter version still evals
  const bad = await p.evaluate(() => {
    const out = [];
    for (const s of PH_DATA.sketches) { try { PHVJ.parseKnobs(s.code); } catch (e) { out.push(s.id + ': ' + e.message); } }
    return out;
  });
  assert(!bad.length, 'parse errors ' + bad);
  await c.close();
});

await test('live edit: run changes the render, errors keep the last frame, revert restores', async () => {
  const c = await ctx(); const p = await open(c, '?i=ed');
  await p.click('[data-tab=code]');
  await wait(400);
  const orig = await p.inputValue('#ed-text');
  assert(orig.includes('Puertas III'), 'panel shows the current sketch code');
  const t0 = (await st(p)).time;
  await p.fill('#ed-text', 'solid(1, 0, 0).out()');
  await p.press('#ed-text', 'Control+Enter');
  await wait(400);
  let col = await screenAvg(p), s = await st(p);
  assert(col[0] > 200 && col[1] < 40 && col[2] < 40, 'red after run ' + col);
  assert(s.time >= t0, 'no time reset ' + t0 + ' -> ' + s.time);
  assert(!s.fading, 'no crossfade');
  await p.fill('#ed-text', 'solid(0, 0, 1).out(');
  await p.press('#ed-text', 'Control+Enter');
  await wait(300);
  assert(await p.isVisible('#ed-err') && /Syntax/.test(await p.textContent('#ed-err')), 'syntax error shown');
  col = await screenAvg(p);
  assert(col[0] > 200, 'last frame keeps playing after a syntax error ' + col);
  await p.fill('#ed-text', 'solid(() => { throw new Error("kaput") }, 0, 0).out()');
  await p.press('#ed-text', 'Control+Enter');
  await wait(600);
  assert(/kaput/.test(await p.textContent('#ed-err')), 'runtime error shown: ' + await p.textContent('#ed-err'));
  col = await screenAvg(p); s = await st(p);
  assert(col[0] > 200 && s.cur === 'celeste_1' && !s.failed.includes('celeste_1'), 'runtime error: last good code restored, not skipped ' + col);
  await p.click('#ed-revert');
  await wait(500);
  assert(await p.inputValue('#ed-text') === orig, 'revert restores the text');
  col = await screenAvg(p);
  assert(!(col[0] > 200 && col[1] < 40 && col[2] < 40), 'revert restores the render ' + col);
  await c.close();
});

await test('live edit: knob slider changes a uniform without re-eval; audio link moves it', async () => {
  const c = await ctx({ permissions: ['microphone'] }); const p = await open(c, '?i=kn');
  await p.click('[data-tab=code]');
  await p.fill('#ed-text', 'solid(0.2, 0, 0).out()');
  await p.press('#ed-text', 'Control+Enter');
  await wait(300);
  let s = await st(p);
  assert(s.knobs.join() === 'solid.r=0.2,solid.g=0,solid.b=0', 'knobs ' + s.knobs);
  const before = await screenAvg(p), evals = s.evals, t0 = s.time;
  const slider = p.locator('.knob[data-k="0"] > input[type=range]');
  await slider.evaluate(el => { el.value = '0.8'; el.dispatchEvent(new Event('input')); });
  const evalsAfterAttach = (await st(p)).evals;
  for (const v of ['0.85', '0.9', '0.95']) await slider.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }, v);
  await wait(400);
  s = await st(p);
  const after = await screenAvg(p);
  assert(after[0] > before[0] + 100, 'slider moved the render ' + before + ' -> ' + after);
  assert(evalsAfterAttach === evals + 1 && s.evals === evalsAfterAttach, 'one eval to attach, none per slider move: ' + evals + ' / ' + evalsAfterAttach + ' / ' + s.evals);
  assert(s.time > t0, 'time keeps running');
  assert((await p.inputValue('#ed-text')).includes('solid(0.95, 0, 0)'), 'code text shows the value');
  // audio link
  await p.click('[data-tab=live]');
  await p.evaluate(() => { const el = document.querySelector('.band[data-band="full"] label:first-of-type input'); el.value = '40'; el.dispatchEvent(new Event('input')); });
  await p.check('#au-on');
  await p.waitForFunction(() => PHVJ.state.audio);
  await p.click('[data-tab=code]');
  await p.selectOption('.knob[data-k="1"] select', 'full');
  await p.locator('.knob[data-k="1"] .kx input[type=range]').evaluate(el => { el.value = '1'; el.dispatchEvent(new Event('input')); });
  const seen = new Set();
  for (let k = 0; k < 30; k++) { await wait(80); seen.add((await st(p)).knobVals[1].toFixed(3)); }
  assert(seen.size > 3, 'audio-linked knob moves: ' + [...seen].slice(0, 6));
  await p.click('#ed-bake');
  assert(!(await st(p)).edActive && (await p.inputValue('#ed-text')).startsWith('solid(0.95,'), 'bake writes values back');
  await c.close();
});

await test('live edit: save as variant, reload, add to a playlist; instances stay separate', async () => {
  const c = await ctx(); const p = await open(c, '?i=var');
  await p.click('[data-tab=code]');
  await p.fill('#ed-text', 'osc(12, 0.1, 1.2).kaleid(5).out()');
  await p.click('#ed-save');
  let s = await st(p);
  assert(s.variants.length === 1, 'saved');
  const vid = s.variants[0];
  await p.reload(); await p.waitForFunction(() => window.PHVJ);
  s = await st(p);
  assert(s.variants.includes(vid), 'variant survives reload');
  await p.click('[data-tab=gallery]');
  const card = p.locator(`.cardg[data-id="${vid}"]`);
  assert(await card.count() === 1, 'variant in gallery');
  assert(/Puertas III \(edit\)/.test(await card.textContent()) && /edited from Puertas III by Celeste Betancur/.test(await card.textContent()), 'credited');
  await card.locator('[data-act=add]').click();
  assert((await st(p)).list.some(i => i.id === vid), 'addable to playlist');
  await card.locator('[data-act=play]').click();
  assert((await st(p)).cur === vid, 'plays');
  const other = await open(c, '?i=var2');
  assert((await st(other)).variants.length === 0, 'other instance has no variants');
  await c.close();
});

if (LOCAL) await test('offline: nothing requested off this server', async () => {
  assert(offsite.length === 0, 'offsite: ' + offsite.join(', '));
});
await test('zero console errors or warnings', async () => {
  assert(consoleProblems.length === 0, consoleProblems.slice(0, 5).join(' | '));
});

await browser.close();
const pass = results.filter(r => r.ok).length;
console.log(`\n${pass}/${results.length} passed against ${BASE}`);
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(path.join('test-results', 'e2e-' + (LOCAL ? 'local' : 'live') + '.json'), JSON.stringify({ base: BASE, date: new Date().toISOString(), results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
