// Kodama mode end-to-end tests on the real GPU (the Hydra suite, tools/e2e.mjs, stays unchanged).
//   node serve.mjs --port 8091 &   then   node tools/e2e-kodama.mjs [--headed] [base url]
// Locally the plain pack (local/kodamas/) and the encrypted copy (?kpack=enc, password from
// local/kodama-pass.txt) are both tested. Against Pages without KODAMA_PASS set, the test checks
// that the pack reads "locked" and nothing breaks.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://localhost:8091/';
const HEADED = process.argv.includes('--headed');
const LOCAL = BASE.startsWith('http://localhost');
const PASSFILE = path.join('local', 'kodama-pass.txt');
// KODAMA_PASS=none tests the locked pack (no password at all)
const PASS = process.env.KODAMA_PASS === 'none' ? '' : process.env.KODAMA_PASS || (fs.existsSync(PASSFILE) ? fs.readFileSync(PASSFILE, 'utf8').trim() : '');
const browser = await chromium.launch({ headless: !HEADED, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const offsite = [], consoleProblems = [], results = [];
const KSCENES = 42; // pk17-pk24, kv01-kv25 (no kv22), pk26-pk35

async function ctx(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...opts });
  if (LOCAL) await c.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(BASE) || u.startsWith('blob:') || u.startsWith('data:') || u === 'about:srcdoc') return r.continue();
    offsite.push(u);
    return r.abort();
  });
  return c;
}
async function open(c, query = '') {
  const p = await c.newPage();
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => consoleProblems.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(BASE + query);
  await p.waitForFunction(() => window.PHVJ && PHVJ.state.cur !== undefined);
  // the credits line is app UI over the stage, outside the scene and the palette: off for pixel checks
  await p.evaluate(() => { if (PHVJ.state.settings.credits) document.getElementById('b-cred').click(); });
  return p;
}
const st = p => p.evaluate(() => PHVJ.state);
const wait = ms => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7); // run the tests whose name has this text
async function test(name, fn) {
  if (ONLY && !name.includes(ONLY) && !name.startsWith('zero console')) return;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('FAIL ' + name + ' :: ' + e.message); }
}
// enter kodama mode and wait for the scene's first frame
async function kodama(p) {
  await p.waitForFunction(() => PHVJ.state.kscenes > 0, null, { timeout: 15000 });
  await p.click('#b-mk');
  await p.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 15000 });
}
async function shot(p) {
  const r = await p.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  return PNG.sync.read(await p.screenshot({ clip: r }));
}
// pixel statistics of the stage: mean luma, max chroma, distinct levels, and how lit it is
function stats(png) {
  let n = 0, luma = 0, chroma = 0, lit = 0, chromaSum = 0;
  const levels = new Set();
  for (let i = 0; i < png.data.length; i += 16) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b; chroma = Math.max(chroma, mx - mn); chromaSum += mx - mn;
    if (mx > 24) lit++;
    levels.add(r >> 2);
    n++;
  }
  return { luma: luma / n, chroma, chromaAvg: chromaSum / n, lit: lit / n, levels: levels.size };
}
function diff(a, b) {
  let d = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 16) { d += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); n++; }
  return d / n / 3;
}
const gpu = await (async () => { const c = await ctx(); const p = await open(c); const g = await p.textContent('#gpu'); await c.close(); return g; })();
console.log('Kodama e2e against ' + BASE + '\n   ' + gpu);

if (LOCAL) {
  await test('pack: local folder opens; the encrypted copy unlocks with the password, refuses a wrong one, remembers the key', async () => {
    const c = await ctx(); let p = await open(c, '?i=kp');
    await p.waitForFunction(() => PHVJ.state.kpack !== 'none' && PHVJ.state.kscenes > 0, null, { timeout: 15000 });
    let s = await st(p);
    assert(s.kpack === 'local' && s.kscenes === KSCENES, 'local pack ' + s.kpack + ' ' + s.kscenes);
    const p2 = await open(c, '?i=kenc&kpack=enc');
    await p2.evaluate(() => localStorage.removeItem('phvj:kodama-key'));
    await p2.reload(); await p2.waitForFunction(() => window.PHVJ && PHVJ.state.kpack === 'locked', null, { timeout: 15000 });
    await p2.click('#b-mk');
    assert((await st(p2)).mode === 'hydra' && await p2.isVisible('#k-unlock'), 'locked pack: stays in Hydras, password form shown');
    await p2.fill('#k-pass', 'not-the-password');
    await p2.click('#k-go');
    await p2.waitForFunction(() => /Wrong password/.test(document.getElementById('k-pack-st').textContent), null, { timeout: 15000 });
    assert(PASS, 'password file present');
    await p2.fill('#k-pass', PASS);
    await p2.click('#k-go');
    await p2.waitForFunction(n => PHVJ.state.kpack === 'encrypted' && PHVJ.state.kscenes === n, KSCENES, { timeout: 20000 });
    await kodama(p2);
    assert((await st(p2)).kready, 'encrypted scene plays');
    await p2.reload(); await p2.waitForFunction(() => window.PHVJ && PHVJ.state.kpack === 'encrypted', null, { timeout: 20000 });
    await p2.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 15000 });
    await c.close();
  });
} else {
  await test('pack on Pages: encrypted, locked without the password, Hydras unaffected', async () => {
    const c = await ctx(); const p = await open(c, '?i=kpages');
    await p.waitForFunction(() => PHVJ.state.kpack === 'locked' || PHVJ.state.kpack === 'encrypted', null, { timeout: 15000 });
    if (PASS) {
      await p.click('[data-tab=gallery]');
      await p.fill('#k-pass', PASS); await p.click('#k-go');
      await p.waitForFunction(() => PHVJ.state.kpack === 'encrypted', null, { timeout: 30000 });
      await kodama(p);
    } else {
      await p.click('#b-mk');
      assert((await st(p)).mode === 'hydra' && /locked/.test(await p.textContent('#k-pack-st')), 'locked message, Hydras keep playing');
    }
    await c.close();
  });
}

const PLAYABLE = LOCAL || PASS;
if (PLAYABLE) {
  const Q = LOCAL ? '' : '';
  await test('visuals only: no text or UI from the scene reaches the output', async () => {
    const c = await ctx(); const p = await open(c, '?i=ktext' + Q);
    if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); }
    await kodama(p);
    for (const id of ['pk17', 'pk18', 'kv03', 'kv16', 'pk26', 'pk29']) {
      await p.evaluate(id => PHVJ.show(id, { cut: true }), id);
      await p.waitForFunction(id => PHVJ.state.cur === id && PHVJ.state.kready && PHVJ.state.kframes === 1, id, { timeout: 15000 });
      const vis = await p.evaluate(() => {
        const d = document.querySelector('#kdecks .kd[style*="opacity: 1"] iframe') || [...document.querySelectorAll('#kdecks iframe')].pop();
        const w = d.contentWindow, out = [];
        for (const el of w.document.body.querySelectorAll('*')) {
          if (['CANVAS', 'SCRIPT', 'STYLE'].includes(el.tagName)) continue;
          const cs = w.getComputedStyle(el), r = el.getBoundingClientRect();
          if (cs.visibility !== 'hidden' && cs.display !== 'none' && r.width && r.height) out.push(el.tagName + '#' + el.id);
        }
        return out;
      });
      assert(!vis.length, id + ': visible elements ' + vis.join(' '));
      // hide the canvas: whatever is left on screen would be the scene's own UI; it must be black
      await p.evaluate(() => { for (const f of document.querySelectorAll('#kdecks iframe')) f.contentWindow.__rig.canvas().style.setProperty('visibility', 'hidden', 'important'); });
      await wait(150);
      const s = stats(await shot(p));
      assert(s.lit === 0 && s.luma < 1, id + ': only the canvas shows (lit ' + s.lit + ', luma ' + s.luma.toFixed(2) + ')');
      await p.evaluate(() => { for (const f of document.querySelectorAll('#kdecks iframe')) f.contentWindow.__rig.canvas().style.removeProperty('visibility'); });
    }
    await c.close();
  });

  await test('mirrored controls: listed per scene, clicks change the scene and the pressed state', async () => {
    const c = await ctx(); const p = await open(c, '?i=kctl' + Q);
    if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); }
    await kodama(p);
    await p.evaluate(() => PHVJ.show('pk17', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'pk17' && PHVJ.state.kready);
    await p.click('[data-tab=scene]');
    const labels = await p.$$eval('#k-ctrls button', bs => bs.map(b => b.textContent));
    assert(labels.join() === 'cycle,dawn,day,dusk,night,cycle,low,high', 'pk17 controls ' + labels);
    await p.click('#k-ctrls button[data-sel=\'[data-t="0.25"]\']'); // day
    await p.evaluate(() => { document.getElementById('k-speed').value = '3'; document.getElementById('k-speed').dispatchEvent(new Event('input')); });
    await wait(2500);
    const day = await shot(p);
    assert(await p.getAttribute('#k-ctrls button[data-sel=\'[data-t="0.25"]\']', 'aria-pressed') === 'true', 'day pressed');
    await p.click('#k-ctrls button[data-sel=\'[data-t="0.75"]\']'); // night
    await wait(2500);
    const night = await shot(p);
    assert(await p.getAttribute('#k-ctrls button[data-sel=\'[data-t="0.75"]\']', 'aria-pressed') === 'true', 'night pressed');
    assert(await p.getAttribute('#k-ctrls button[data-sel=\'[data-t="0.25"]\']', 'aria-pressed') === 'false', 'day released');
    const sd = stats(day), sn = stats(night);
    assert(Math.abs(sd.luma - sn.luma) > 3 || diff(day, night) > 6, 'day vs night differ: luma ' + sd.luma.toFixed(1) + ' / ' + sn.luma.toFixed(1) + ', diff ' + diff(day, night).toFixed(1));
    // a scene without buttons says so
    await p.evaluate(() => PHVJ.show('kv01', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'kv01');
    assert(/No buttons/.test(await p.textContent('#k-ctrls')), 'kv01 has no buttons');
    await c.close();
  });

  await test('speed slider halves and doubles the scene clock; turntable 0 stops, 2x doubles, reverse turns back', async () => {
    const c = await ctx(); const p = await open(c, '?i=kspd' + Q);
    if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); }
    await kodama(p);
    await p.evaluate(() => PHVJ.show('pk18', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'pk18' && PHVJ.state.kready && PHVJ.state.kframes === 1);
    const set = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input')); }, [id, v]);
    // scene time gained per wall-clock second, measured inside the page
    const rate = () => p.evaluate(() => new Promise(res => {
      const r = PHVJ.kRig(), v0 = r.virt, a0 = r.angle(), t0 = performance.now();
      setTimeout(() => res({ v: (r.virt - v0) / (performance.now() - t0), a: (r.angle() - a0) / ((r.virt - v0) / 1000 || 1) }), 2000);
    }));
    await set('k-speed', 1); await set('k-tt', 1); const r1 = await rate();
    await set('k-speed', 0.5); const rh = await rate();
    await set('k-speed', 2); const r2 = await rate();
    assert(Math.abs(r1.v - 1) < 0.12, 'speed 1: scene clock ' + r1.v.toFixed(3));
    assert(Math.abs(rh.v / r1.v - 0.5) < 0.08, 'speed 0.5 halves: ' + (rh.v / r1.v).toFixed(3));
    assert(Math.abs(r2.v / r1.v - 2) < 0.2, 'speed 2 doubles: ' + (r2.v / r1.v).toFixed(3));
    await set('k-speed', 1);
    await set('k-tt', 0); const t0 = await rate();
    await set('k-tt', 1); const t1 = await rate();
    await set('k-tt', 2); const t2 = await rate();
    assert(Math.abs(t0.a) < 1e-6, 'turntable 0 stops: ' + t0.a);
    assert(t1.a > 0 && Math.abs(t2.a / t1.a - 2) < 0.1, 'turntable 2x doubles: ' + t1.a.toFixed(5) + ' / ' + t2.a.toFixed(5));
    await p.evaluate(() => { const el = document.getElementById('k-rev'); el.checked = true; el.dispatchEvent(new Event('change')); });
    const tr = await rate();
    assert(Math.abs(tr.a + t2.a) < Math.abs(t2.a) * 0.1, 'reverse turns back: ' + tr.a.toFixed(5));
    assert((await p.evaluate(() => PHVJ.kRig().spin)) === 'camA', 'turntable through the scene orbit angle');
    await c.close();
  });

  await test('palettes change the pixels as expected (grayscale has no chroma, B/W has two values)', async () => {
    const c = await ctx(); const p = await open(c, '?i=kpal' + Q);
    if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); }
    await kodama(p);
    await p.evaluate(() => PHVJ.show('pk17', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'pk17' && PHVJ.state.kready && PHVJ.state.kframes === 1);
    await wait(500);
    const pal = async ch => { await p.evaluate(ch => PHVJ.setPal(ch), ch); await wait(300); return stats(await shot(p)); };
    const orig = await pal({ style: 'original', int: 1, con: 1 });
    assert(orig.chroma > 40, 'original has color: ' + orig.chroma);
    const gray = await pal({ style: 'grayscale' });
    assert(gray.chroma <= 3, 'grayscale chroma ' + gray.chroma);
    const bw = await pal({ style: 'bw', thr: 0.1 });
    const bwShot = await shot(p);
    const vals = new Set();
    for (let i = 0; i < bwShot.data.length; i += 4) vals.add(bwShot.data[i] > 127 ? 255 : 0) && (bwShot.data[i] > 3 && bwShot.data[i] < 252 ? vals.add('mid:' + bwShot.data[i]) : 0);
    assert([...vals].every(v => v === 0 || v === 255) && bw.chroma === 0 && vals.size === 2, 'B/W two values: ' + [...vals].slice(0, 6));
    const mono = await pal({ style: 'mono', mono: '#ff0000' });
    assert(mono.chromaAvg > gray.chromaAvg + 1, 'mono tints: ' + mono.chromaAvg.toFixed(2));
    const duo = await pal({ style: 'duotone', pre: 'cm', a: '#00b7c7', b: '#e0309e' });
    assert(duo.chromaAvg > 5, 'duotone colors: ' + duo.chromaAvg.toFixed(2));
    const rg = await pal({ style: 'rg' });
    const rgShot = await shot(p);
    let blue = 0;
    for (let i = 0; i < rgShot.data.length; i += 16) blue = Math.max(blue, rgShot.data[i + 2]);
    assert(blue <= 3 && rg.chroma > 20, 'red/green map: no blue (' + blue + '), chroma ' + rg.chroma);
    const half = await pal({ style: 'grayscale', int: 0.5 });
    assert(half.chroma > gray.chroma + 10, 'intensity mixes the original back: ' + half.chroma);
    const lowc = await pal({ style: 'original', int: 1, con: 0.5 });
    assert(Math.abs(lowc.luma - 127.5 * 0.5) < Math.abs(orig.luma - 127.5 * 0.5) || lowc.luma > orig.luma, 'contrast 0.5 lifts the dark scene toward gray: ' + orig.luma.toFixed(1) + ' -> ' + lowc.luma.toFixed(1));
    // per item palette override, saved with the playlist
    await p.evaluate(() => PHVJ.setPal({ style: 'grayscale', int: 1, con: 1 }));
    await p.click('[data-tab=playlist]');
    await p.click('#pl-list li[data-id="pk17"] [data-act=pal]');
    // the mode palette back to original on another scene (on pk17 the controls edit its own palette)
    await p.evaluate(() => PHVJ.show('pk18', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'pk18' && PHVJ.state.kready);
    await p.evaluate(() => PHVJ.setPal({ style: 'original' }));
    await p.evaluate(() => PHVJ.show('pk17', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'pk17' && PHVJ.state.kready && PHVJ.state.kframes === 1);
    await wait(500);
    assert((await st(p)).pal.style === 'grayscale' && stats(await shot(p)).chroma <= 3, 'item palette wins over the mode palette');
    await p.reload(); await p.waitForFunction(() => window.PHVJ && PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 15000 });
    assert((await st(p)).list.find(i => i.id === 'pk17').pal.style === 'grayscale', 'item palette survives reload');
    await c.close();
  });

  await test('autoplay, crossfade, cut, mode switch through black; iframes torn down after each fade', async () => {
    const c = await ctx(); const p = await open(c, '?i=kauto' + Q);
    if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); }
    await p.waitForFunction(() => PHVJ.state.kscenes > 0, null, { timeout: 15000 });
    // the switch fades through black
    await p.click('#b-mk');
    await wait(250);
    const mid = await p.evaluate(() => Number(getComputedStyle(document.getElementById('mfade')).opacity));
    assert(mid > 0.3, 'fading to black: ' + mid);
    await p.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 15000 });
    await wait(700);
    assert(await p.evaluate(() => Number(getComputedStyle(document.getElementById('mfade')).opacity)) < 0.05, 'back from black');
    let s = await st(p);
    assert(s.dur === 90 || s.list.find(i => i.id === s.cur).dur === 90, 'kodama default duration 90 s');
    assert(['pk26', 'pk27', 'pk28', 'pk29'].every(id => s.list.some(i => i.id === id)), 'approved pk26 to pk29 in the default playlist');
    assert(!s.list.some(i => ['pk30', 'pk31', 'pk32', 'pk33', 'pk34', 'pk35'].includes(i.id)), 'drafts pk30 to pk35 not in the default playlist');
    // short durations, crossfade 1 s, play
    await p.evaluate(() => {
      for (const li of document.querySelectorAll('#pl-list li input[data-act=dur]')) { li.value = '3'; li.dispatchEvent(new Event('change', { bubbles: true })); }
      const x = document.getElementById('n-xfade'); x.value = '1'; x.dispatchEvent(new Event('change'));
      PHVJ.setPlaying(true);
    });
    const seen = [], maxFrames = [];
    let sawFade = false;
    for (let k = 0; k < 90; k++) {
      await wait(100);
      s = await st(p);
      if (seen[seen.length - 1] !== s.cur) seen.push(s.cur);
      if (s.fading) sawFade = true;
      maxFrames.push(s.kframes);
    }
    assert(seen.length >= 3, 'autoplay advanced: ' + seen.join(' '));
    assert(sawFade, 'crossfaded');
    assert(Math.max(...maxFrames) <= 2, 'never more than 2 scene iframes: ' + Math.max(...maxFrames));
    await p.evaluate(() => PHVJ.setPlaying(false));
    await wait(1500);
    s = await st(p);
    assert(s.kframes === 1 && !s.fading, 'one iframe after the fade: ' + s.kframes);
    // cut
    await p.selectOption('#s-trans', 'cut');
    const before = s.cur;
    await p.click('#b-next');
    await p.waitForFunction(b => PHVJ.state.cur !== b && PHVJ.state.kready && PHVJ.state.kframes === 1, before, { timeout: 15000 });
    // a scene that throws is skipped, never shown
    await p.evaluate(() => PHVJ.addTestKodama('kbad', '<!doctype html><html><head></head><body><canvas id="c"></canvas><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script><script>requestAnimationFrame(function a(){requestAnimationFrame(a);throw new Error("kodama kaput")});</script></body></html>'));
    await p.evaluate(() => PHVJ.show('kbad', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.failed.includes('kbad') && PHVJ.state.cur !== 'kbad', null, { timeout: 15000 });
    assert(/kodama kaput/.test(await p.textContent('#log')), 'logged');
    // back to Hydras: the sketch plays again on the hydra decks
    await p.click('#b-mh');
    await p.waitForFunction(() => PHVJ.state.mode === 'hydra' && PHVJ.state.cur && PHVJ.state.kframes === 0, null, { timeout: 5000 });
    await wait(800);
    s = await st(p);
    assert(s.hydras === 2 && s.opacity.includes('1'), 'hydra deck on screen, still 2 hydra instances');
    assert(stats(await shot(p)).lit > 0.05, 'hydra sketch renders after the switch');
    await c.close();
  });

  await test('output window follows mode, scene, controls, speed, turntable and palette', async () => {
    const c = await ctx(); const p = await open(c, '?i=kout' + Q);
    if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); }
    await kodama(p);
    await p.evaluate(() => PHVJ.show('pk17', { cut: true }));
    await p.waitForFunction(() => PHVJ.state.cur === 'pk17' && PHVJ.state.kready);
    const [out] = await Promise.all([c.waitForEvent('page'), p.click('[data-tab=live]').then(() => p.click('#out-open'))]);
    out.on('pageerror', e => consoleProblems.push('out pageerror: ' + e.message));
    await out.waitForFunction(() => window.PHVJ && PHVJ.state.mode === 'kodama' && PHVJ.state.cur === 'pk17' && PHVJ.state.kready, null, { timeout: 20000 });
    await p.click('[data-tab=scene]');
    await p.evaluate(() => { for (const [id, v] of [['k-speed', '2'], ['k-tt', '0']]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); } });
    await p.evaluate(() => PHVJ.setPal({ style: 'grayscale', int: 1, con: 1 }));
    await p.click('#k-ctrls button[data-sel=\'[data-f="1"]\']');
    await out.waitForFunction(() => PHVJ.state.k.speed === 2 && PHVJ.state.k.tt === 0 && PHVJ.state.pal && PHVJ.state.pal.style === 'grayscale', null, { timeout: 5000 });
    assert(await out.evaluate(() => PHVJ.kRig().on(['[data-f="1"]']).length === 1), 'output scene got the flood click');
    await p.click('#b-next');
    const cur = (await st(p)).cur;
    await out.waitForFunction(id => PHVJ.state.cur === id && PHVJ.state.kready, cur, { timeout: 15000 });
    await p.click('#b-mh');
    await out.waitForFunction(() => PHVJ.state.mode === 'hydra' && PHVJ.state.kframes === 0, null, { timeout: 10000 });
    await c.close();
  });

  // ---- handoff-6: view (orbit, pan, zoom), View override, palette UI ----
  const unlock = async p => { if (!LOCAL) { await p.click('[data-tab=gallery]'); await p.fill('#k-pass', PASS); await p.click('#k-go'); } };
  const onScene = async (p, id) => {
    await p.evaluate(id => { PHVJ.setPlaying(false); PHVJ.show(id, { cut: true }); }, id);
    await p.waitForFunction(id => PHVJ.state.cur === id && PHVJ.state.kready && PHVJ.state.kframes === 1 && PHVJ.view(), id, { timeout: 15000 });
    await wait(300);
  };
  async function dragOn(p, sel, dx, dy, opts = {}) {
    const b = await p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    if (opts.shift) await p.keyboard.down('Shift');
    await p.mouse.move(b.x, b.y);
    await p.mouse.down({ button: opts.button || 'left' });
    for (let k = 1; k <= 8; k++) await p.mouse.move(b.x + dx * k / 8, b.y + dy * k / 8);
    await p.mouse.up({ button: opts.button || 'left' });
    if (opts.shift) await p.keyboard.up('Shift');
  }
  const near = (a, b, eps) => Math.abs(a - b) <= eps;

  await test('view: drag orbits, shift-drag and right-drag pan, wheel zooms, inside the scene limits; the pad; Reset view', async () => {
    const c = await ctx(); const p = await open(c, '?i=kcam' + Q);
    await unlock(p); await kodama(p); await onScene(p, 'pk17');
    const cfg = await p.evaluate(() => PHVJ.camCfg());
    assert(cfg.r && cfg.y && cfg.pan > 0, 'registry camera entry for pk17: ' + JSON.stringify(cfg));
    const v0 = await p.evaluate(() => PHVJ.view());
    const before = await shot(p);
    await dragOn(p, '#stage', 160, -60);
    const v1 = await p.evaluate(() => PHVJ.view());
    assert(Math.abs(v1.a - v0.a) > 0.2 && v1.y > v0.y, 'drag orbits: a ' + v0.a.toFixed(2) + ' -> ' + v1.a.toFixed(2) + ', y ' + v0.y.toFixed(1) + ' -> ' + v1.y.toFixed(1));
    await wait(300);
    assert(diff(before, await shot(p)) > 2, 'the picture moved with the drag');
    // the scene's own limits hold
    await dragOn(p, '#stage', 0, -2000);
    assert(near((await p.evaluate(() => PHVJ.view())).y, cfg.y[1], 0.01), 'camY stops at the scene limit ' + cfg.y[1]);
    await dragOn(p, '#stage', 0, 4000);
    assert(near((await p.evaluate(() => PHVJ.view())).y, cfg.y[0], 0.01), 'camY stops at the scene limit ' + cfg.y[0]);
    // zoom
    const r0 = (await p.evaluate(() => PHVJ.view())).r;
    const mid = await p.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await p.mouse.move(mid[0], mid[1]);
    await p.mouse.wheel(0, 300); await wait(150);
    const r1 = (await p.evaluate(() => PHVJ.view())).r;
    assert(r1 > r0, 'wheel zooms out: ' + r0 + ' -> ' + r1);
    for (let k = 0; k < 8; k++) await p.mouse.wheel(0, 3000);
    await wait(150);
    assert(near((await p.evaluate(() => PHVJ.view())).r, cfg.r[1], 0.01), 'zoom stops at the scene limit ' + cfg.r[1]);
    // pan, by shift-drag and by right-drag
    await dragOn(p, '#stage', 120, 40, { shift: true });
    const v2 = await p.evaluate(() => PHVJ.view());
    assert(Math.hypot(v2.px, v2.pz) > 1, 'shift-drag pans: ' + JSON.stringify(v2));
    await dragOn(p, '#stage', -260, 0, { button: 'right' });
    const v3 = await p.evaluate(() => PHVJ.view());
    assert(Math.hypot(v3.px - v2.px, v3.pz - v2.pz) > 1 && Math.hypot(v3.px, v3.pz) <= cfg.pan + 1e-6, 'right-drag pans, inside the pan limit: ' + JSON.stringify(v3));
    // the pad in the Scene tab
    await p.click('[data-tab=scene]');
    assert(await p.isVisible('#k-pad') && await p.isVisible('#k-view-reset'), 'pad and Reset view in the Scene tab');
    const a4 = (await p.evaluate(() => PHVJ.view())).a;
    await dragOn(p, '#k-pad', 50, 0);
    assert(Math.abs((await p.evaluate(() => PHVJ.view())).a - a4) > 0.2, 'pad drag orbits');
    // Reset view: the scene's own start
    await p.click('#k-view-reset');
    const v5 = await p.evaluate(() => PHVJ.view()), z = await p.evaluate(() => PHVJ.view0());
    assert(near(v5.a, z.a, 0.01) && near(v5.y, z.y, 0.01) && near(v5.r, z.r, 0.01) && !v5.px && !v5.py && !v5.pz, 'Reset view back to the start ' + JSON.stringify([v5, z]));
    // Hydra mode: dragging does nothing (and nothing breaks)
    await c.close();
  });

  await test('turntable rests while steering and resumes 2 s after from the new angle', async () => {
    const c = await ctx(); const p = await open(c, '?i=ktt' + Q);
    await unlock(p); await kodama(p); await onScene(p, 'pk18');
    const a0 = await p.evaluate(() => PHVJ.angle());
    await wait(600);
    assert((await p.evaluate(() => PHVJ.angle())) - a0 > 0.005, 'turning before the drag');
    await dragOn(p, '#stage', 120, 0);
    const a1 = await p.evaluate(() => PHVJ.angle());
    await wait(1200);
    const a2 = await p.evaluate(() => PHVJ.angle());
    assert(near(a2, a1, 0.002), 'rests after the drag: ' + a1.toFixed(4) + ' -> ' + a2.toFixed(4));
    await wait(1800);
    const a3 = await p.evaluate(() => PHVJ.angle());
    assert(a3 - a2 > 0.005, 'resumes from the new angle: ' + a2.toFixed(4) + ' -> ' + a3.toFixed(4));
    await c.close();
  });

  await test('output window follows the view, and steering in the output reports back', async () => {
    const c = await ctx(); const p = await open(c, '?i=kvout' + Q);
    await unlock(p); await kodama(p); await onScene(p, 'pk17');
    await p.evaluate(() => { const el = document.getElementById('k-tt'); el.value = '0'; el.dispatchEvent(new Event('input')); });
    const [out] = await Promise.all([c.waitForEvent('page'), p.click('[data-tab=live]').then(() => p.click('#out-open'))]);
    out.on('pageerror', e => consoleProblems.push('out pageerror: ' + e.message));
    out.on('console', m => { if (m.type() === 'error') consoleProblems.push('out: ' + m.text()); });
    await out.waitForFunction(() => window.PHVJ && PHVJ.state.cur === 'pk17' && PHVJ.state.kready && PHVJ.view(), null, { timeout: 20000 });
    await dragOn(p, '#stage', 140, -50);
    await dragOn(p, '#stage', 60, 20, { shift: true });
    await wait(400);
    let vc = await p.evaluate(() => PHVJ.view()), vo = await out.evaluate(() => PHVJ.view());
    assert(near(vc.a, vo.a, 0.01) && near(vc.y, vo.y, 0.01) && near(vc.px, vo.px, 0.01) && near(vc.pz, vo.pz, 0.01), 'output follows the controller ' + JSON.stringify([vc, vo]));
    // the pad steers the projector view
    await p.click('[data-tab=scene]');
    await dragOn(p, '#k-pad', -40, 10);
    await p.mouse.move(5, 5);
    await p.evaluate(() => {}); await wait(400);
    vc = await p.evaluate(() => PHVJ.view()); vo = await out.evaluate(() => PHVJ.view());
    assert(near(vc.a, vo.a, 0.01), 'pad steers the output ' + vc.a + ' ' + vo.a);
    // dragging in the output window itself
    await out.bringToFront();
    await dragOn(out, '#stage', -150, 30);
    await out.mouse.wheel(0, 200);
    await wait(500);
    vc = await p.evaluate(() => PHVJ.view()); vo = await out.evaluate(() => PHVJ.view());
    assert(near(vc.a, vo.a, 0.01) && near(vc.r, vo.r, 0.01), 'controller follows a drag in the output ' + JSON.stringify([vc, vo]));
    await c.close();
  });

  await test('View override per playlist item: saved from the scene, applied when it plays again, kept on reload', async () => {
    const c = await ctx(); const p = await open(c, '?i=kview' + Q);
    await unlock(p); await kodama(p); await onScene(p, 'pk17');
    await dragOn(p, '#stage', 200, -40);
    await p.mouse.move(400, 300);
    await p.mouse.wheel(0, 250); await wait(200);
    await p.click('[data-tab=playlist]');
    await p.click('#pl-list li[data-id="pk17"] [data-act=view]');
    const saved = (await st(p)).list.find(i => i.id === 'pk17').view;
    assert(saved && Number.isFinite(saved.a), 'view saved on the item');
    assert(await p.getAttribute('#pl-list li[data-id="pk17"] [data-act=view]', 'aria-pressed') === 'true', 'View button shows it is on');
    await onScene(p, 'pk18');
    await onScene(p, 'pk17');
    const v = await p.evaluate(() => PHVJ.view());
    assert(near(v.y, saved.y, 0.01) && near(v.r, saved.r, 0.01) && near(v.a, saved.a, 0.15), 'saved view applied ' + JSON.stringify([v, saved]));
    await p.reload(); await p.waitForFunction(() => window.PHVJ && PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 15000 });
    assert((await st(p)).list.find(i => i.id === 'pk17').view, 'view override survives reload');
    await c.close();
  });

  await test('palette UI: menu bar dropdown and P in Kodama mode, kept across scenes and mode switches, item override shown and edited', async () => {
    const c = await ctx(); const p = await open(c, '?i=kpui' + Q);
    await unlock(p); await kodama(p); await onScene(p, 'pk17');
    assert(await p.isVisible('#b-pal'), 'palette dropdown in the menu bar');
    await p.selectOption('#b-pal', 'grayscale');
    await wait(300);
    assert((await st(p)).pal.style === 'grayscale' && stats(await shot(p)).chroma <= 3, 'menu bar dropdown sets grayscale');
    // a scene switch keeps it
    await onScene(p, 'pk18'); await wait(300);
    assert(stats(await shot(p)).chroma <= 3, 'grayscale kept on the next scene');
    // a trip to Hydras and back keeps it
    await p.click('#b-mh');
    await p.waitForFunction(() => PHVJ.state.mode === 'hydra', null, { timeout: 5000 });
    assert(!(await p.isVisible('#b-pal')), 'no kodama palette dropdown in Hydras');
    await p.click('#b-mk');
    await p.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 15000 });
    await wait(400);
    assert((await st(p)).pal.style === 'grayscale', 'palette kept after Hydras and back: ' + (await st(p)).pal.style);
    // P cycles
    await p.mouse.click(5, 300); await p.keyboard.press('p');
    assert((await st(p)).pal.style === 'bw', 'P cycles to the next style: ' + (await st(p)).pal.style);
    // the start palette applies at once too
    await p.click('[data-tab=scene]');
    await p.selectOption('#p-kdef', 'mono');
    assert((await st(p)).pal.style === 'mono', 'On start palette applies now');
    // an item's own palette is shown, and the controls edit it
    await onScene(p, 'pk17');
    await p.click('[data-tab=playlist]');
    await p.click('#pl-list li[data-id="pk17"] [data-act=pal]');
    await p.click('[data-tab=scene]');
    assert(await p.isVisible('#p-item') && /pk17|Ayutthaya/i.test(await p.textContent('#p-item-t')), 'own palette shown in the Scene tab');
    await p.selectOption('#p-style', 'duotone');
    let s = await st(p);
    assert(s.list.find(i => i.id === 'pk17').pal.style === 'duotone' && s.settings.pal.kodama.style === 'mono', 'controls edit the item palette, not the mode palette');
    assert(await p.evaluate(() => document.getElementById('b-pal').value) === 'duotone', 'menu bar shows the palette on screen');
    await p.click('#p-item-x');
    s = await st(p);
    assert(!s.list.find(i => i.id === 'pk17').pal && s.pal.style === 'mono', 'Use the mode palette clears the override');
    await c.close();
  });
}

if (LOCAL) await test('offline: kodama mode requests nothing off this server (three.js is vendored)', async () => {
  assert(!offsite.length, 'off-server requests: ' + offsite.slice(0, 5).join(' '));
});
await test('zero console errors or warnings', async () => {
  assert(!consoleProblems.length, consoleProblems.slice(0, 5).join(' | '));
});

await browser.close();
const ok = results.filter(r => r.ok).length;
console.log('\n' + ok + '/' + results.length + ' passed against ' + BASE);
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(path.join('test-results', 'e2e-kodama' + (LOCAL ? '' : '-live') + (HEADED ? '-headed' : '') + '.json'), JSON.stringify({ base: BASE, gpu, results }, null, 1));
process.exit(ok === results.length ? 0 : 1);
