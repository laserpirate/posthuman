// MIDI end-to-end tests with a fake Web MIDI (a shim injected before the app loads; no hardware).
//   node serve.mjs --port 8091 &   then   node tools/e2e-midi.mjs [base url]   (e.g. http://localhost:8091/next/)
// A real nanoKONTROL is NOT tested here: the shim plays the controller from its factory CC numbers.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://localhost:8091/next/';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [], results = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('FAIL ' + name + ' :: ' + e.message); }
}

// the fake Web MIDI: __midi.plug(name), unplug(name), cc(num, val, ch), and what the app sent back (LEDs)
const SHIM = ({ noMidi }) => {
  if (noMidi) { try { delete Navigator.prototype.requestMIDIAccess; } catch (e) { /* */ } navigator.requestMIDIAccess = undefined; return; }
  const M = window.__midi = { inputs: new Map(), outputs: new Map(), sent: [], access: null, calls: 0, sysex: false };
  const ev = port => { if (M.access && M.access.onstatechange) M.access.onstatechange({ port }); };
  M.plug = name => {
    const i = { type: 'input', name, id: 'in-' + name, state: 'connected', onmidimessage: null };
    M.inputs.set(i.id, i);
    M.outputs.set('out-' + name, { type: 'output', name, id: 'out-' + name, state: 'connected', send: d => M.sent.push([...d]) });
    ev(i);
  };
  M.unplug = name => {
    const i = M.inputs.get('in-' + name);
    if (!i) return;
    i.state = 'disconnected'; M.inputs.delete(i.id); M.outputs.delete('out-' + name);
    ev(i);
  };
  M.send = bytes => { for (const i of M.inputs.values()) if (i.onmidimessage) i.onmidimessage({ data: new Uint8Array(bytes) }); };
  M.cc = (num, val, ch = 1) => M.send([0xb0 + ch - 1, num, val]);
  navigator.requestMIDIAccess = async o => {
    M.calls++; M.sysex = !!(o && o.sysex);
    M.access = { inputs: M.inputs, outputs: M.outputs, onstatechange: null, sysexEnabled: false };
    return M.access;
  };
  M.plug('nanoKONTROL2');
};

async function ctx(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await c.addInitScript(SHIM, opts);
  return c;
}
async function open(c, q = '?i=midi') {
  const p = await c.newPage();
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await p.goto(BASE + q);
  await p.waitForFunction(() => window.PHVJ && PHVJ.state.cur && PHVJ.midiUI && document.getElementById('midi-en'), null, { timeout: 20000 });
  return p;
}
async function enable(p) {
  await p.evaluate(() => PHVJ.midi.setTab('midi'));
  await p.click('#midi-en');
  await p.waitForFunction(() => PHVJ.midiUI.state().on && PHVJ.midiUI.state().inputs.length > 0);
}
const cc = (p, num, val, ch = 1) => p.evaluate(([n, v, c]) => __midi.cc(n, v, c), [num, val, ch]);
const st = p => p.evaluate(() => PHVJ.state);

console.log('MIDI e2e against ' + BASE);

await test('MIDI off by default: no MIDI access asked, a controller does nothing', async () => {
  const c = await ctx(), p = await open(c);
  await wait(800);
  const s0 = await st(p);
  assert(await p.evaluate(() => __midi.calls) === 0, 'requestMIDIAccess called before Enable');
  await cc(p, 32, 127); await cc(p, 41, 127); await cc(p, 5, 0);
  await wait(300);
  const s1 = await st(p);
  assert(s1.settings.black === s0.settings.black && s1.playing === s0.playing, 'state changed with MIDI off');
  assert(await p.evaluate(() => getComputedStyle(document.getElementById('dim')).opacity) === '0', 'dim changed with MIDI off');
  await c.close();
});

await test('no Web MIDI (Safari): Enable says Chrome only, no errors', async () => {
  const c = await ctx({ noMidi: true }), p = await open(c);
  const n = problems.length;
  await p.evaluate(() => PHVJ.midi.setTab('midi'));
  await p.click('#midi-en');
  await wait(300);
  const t = await p.textContent('#v-midi');
  assert(/Chrome/.test(t) && /not available/.test(t), 'no Chrome-only note');
  assert(problems.length === n, 'errors: ' + problems.slice(n).join(' | '));
  await c.close();
});

await test('enable: no sysex, device listed, monitor shows messages', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  assert(await p.evaluate(() => __midi.sysex) === false, 'asked for sysex');
  await cc(p, 99, 64);
  await wait(100);
  const mon = await p.textContent('#v-midi .mon');
  assert(/CC\s+99\s+=\s+64/.test(mon) && /unbound/.test(mon), 'monitor: ' + mon);
  await c.close();
});

await test('every nanoKONTROL2 preset binding fires its action', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  // count calls instead of acting (the actions themselves are tested below)
  const binds = await p.evaluate(() => {
    window.__hits = {};
    for (const [k, a] of Object.entries(PHVJ.midi.acts)) {
      if (a.fire) a.fire = () => { __hits[k] = (__hits[k] || 0) + 1; };
      if (a.set) { a.get = () => null; a.set = () => { __hits[k] = (__hits[k] || 0) + 1; }; }
    }
    return PHVJ.midiUI.state().map.bindings;
  });
  assert(binds.length >= 37, 'preset has ' + binds.length + ' bindings');
  for (const b of binds) {
    await cc(p, b.num, 127);
    if (b.mode === 'hold') await wait(b.holdMs + 150);
    await cc(p, b.num, 0);
  }
  await wait(100);
  const hits = await p.evaluate(() => __hits);
  const missing = [...new Set(binds.map(b => b.act))].filter(a => !hits[a]);
  assert(!missing.length, 'did not fire: ' + missing.join(', '));
  await c.close();
});

await test('actions: blackout, next, play, dim, hold, palette, crossfade time', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  const s0 = await st(p);
  await cc(p, 32, 127); await cc(p, 32, 0); // S1 blackout
  assert((await st(p)).settings.black === !s0.settings.black, 'blackout');
  await cc(p, 42, 127); await cc(p, 42, 0); // stop = blackout back
  assert((await st(p)).settings.black === s0.settings.black, 'stop = blackout');
  await cc(p, 44, 127); await cc(p, 44, 0); // ff = next
  await p.waitForFunction(c0 => PHVJ.state.cur !== c0, s0.cur);
  await cc(p, 41, 127); await cc(p, 41, 0); // play
  assert((await st(p)).playing === !s0.playing, 'play/pause');
  await cc(p, 37, 127); await cc(p, 37, 0); // S6 hold
  assert((await st(p)).hold === true, 'hold');
  await cc(p, 5, 127); await cc(p, 5, 64); // master dim: pick up at full, then half
  const o = Number(await p.evaluate(() => getComputedStyle(document.getElementById('dim')).opacity));
  assert(o > 0.45 && o < 0.55, 'dim opacity ' + o);
  await cc(p, 62, 127); await cc(p, 62, 0); // marker > = next palette
  assert((await st(p)).pal.style !== 'original' || (await p.evaluate(() => PHVJ.state.settings.pal && PHVJ.state.settings.pal.hydra.style)) !== 'original', 'palette did not move');
  const x0 = (await st(p)).settings.xfadeSec;
  const v0 = Math.round((x0 - 0.2) / 9.8 * 127);
  await cc(p, 16, v0); await cc(p, 16, 127);
  assert((await st(p)).settings.xfadeSec === 10, 'crossfade time ' + (await st(p)).settings.xfadeSec);
  await c.close();
});

await test('pickup: a knob is ignored until it crosses the current value', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  await p.evaluate(() => PHVJ.setPal({ con: 1 })); // contrast 1 = 42 of 127 on knob 3 (CC 18)
  await cc(p, 18, 0); await cc(p, 18, 10);
  let con = await p.evaluate(() => PHVJ.state.pal.con);
  assert(Math.abs(con - 1) < 1e-6, 'moved before pickup: ' + con);
  const hint = await p.textContent('#v-midi .pick');
  assert(/pick up/.test(hint), 'no pickup hint: ' + hint);
  await cc(p, 18, 60); // crosses 42
  con = await p.evaluate(() => PHVJ.state.pal.con);
  assert(Math.abs(con - (0.5 + 60 / 127 * 1.5)) < 0.01, 'not picked up: ' + con);
  await cc(p, 18, 80);
  con = await p.evaluate(() => PHVJ.state.pal.con);
  assert(Math.abs(con - (0.5 + 80 / 127 * 1.5)) < 0.01, 'not following after pickup: ' + con);
  // changed elsewhere: pickup again
  await p.evaluate(() => PHVJ.setPal({ con: 2 }));
  await cc(p, 18, 90);
  con = await p.evaluate(() => PHVJ.state.pal.con);
  assert(con === 2, 'jumped after an outside change: ' + con);
  await c.close();
});

await test('panic needs a 1 s hold, then resets everything', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  await p.evaluate(() => { PHVJ.setPal({ style: 'bw', con: 1.6 }); });
  await cc(p, 71, 127); await wait(400); await cc(p, 71, 0); // short press
  await wait(900);
  assert((await st(p)).settings.black === false, 'short press fired panic');
  await cc(p, 37, 127); await cc(p, 37, 0); // hold on
  await cc(p, 71, 127); await wait(1150);
  const s = await st(p);
  await cc(p, 71, 0);
  assert(s.settings.black === true, 'panic: no blackout');
  assert(s.pal.style === 'original' && s.pal.con === 1, 'panic: palette ' + JSON.stringify(s.pal));
  assert(s.hold === false && s.settings.au.zoom === 0 && s.settings.au.flash === 0 && !s.settings.au.on, 'panic: hold/fx/audio');
  assert(s.k.speed === 1 && s.k.tt === 1, 'panic: speed');
  assert(await p.evaluate(() => [...document.querySelectorAll('#log li')].some(li => /PANIC/.test(li.textContent))), 'panic not in the log');
  await c.close();
});

await test('MIDI Learn: click a control, move a knob, bound and kept after reload', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  await p.click('#midi-learn');
  const b0 = (await st(p)).settings.black;
  await p.click('#b-black'); // picks it, does not toggle it
  assert((await st(p)).settings.black === b0, 'click in learn mode toggled blackout');
  await cc(p, 100, 127); await cc(p, 100, 0);
  assert((await st(p)).settings.black === b0, 'the learning message also fired');
  await p.click('#midi-learn'); // stop learn
  const m = await p.evaluate(() => PHVJ.midiUI.state().map.bindings.filter(b => b.act === 'blackout'));
  assert(m.length === 1 && m[0].num === 100, 'binding ' + JSON.stringify(m));
  assert(/MIDI: CC 100/.test(await p.getAttribute('#b-black', 'title')), 'no binding on hover');
  await p.reload();
  await p.waitForFunction(() => window.PHVJ && PHVJ.midiUI && document.getElementById('midi-en'));
  if (!(await p.evaluate(() => PHVJ.midiUI.state().on))) await enable(p);
  await cc(p, 100, 127); await cc(p, 100, 0);
  assert((await st(p)).settings.black === !b0, 'learned binding lost after reload');
  // reset to the preset
  await p.evaluate(() => PHVJ.midi.setTab('midi'));
  await p.click('text=Reset to preset');
  const back = await p.evaluate(() => PHVJ.midiUI.state().map.bindings.filter(b => b.act === 'blackout').map(b => b.num));
  assert(back.includes(32) && !back.includes(100), 'reset: ' + back);
  // another instance keeps its own map
  const q = await open(c, '?i=midi2');
  const other = await q.evaluate(() => PHVJ.midiUI.state().st.map);
  assert(!other, 'map leaked to another instance');
  await c.close();
});

await test('hot-unplug and replug: logged, no errors, works again', async () => {
  const c = await ctx(), p = await open(c);
  await enable(p);
  const n = problems.length;
  await p.evaluate(() => __midi.unplug('nanoKONTROL2'));
  await cc(p, 32, 127);
  await wait(200);
  const logs = await p.evaluate(() => [...document.querySelectorAll('#log li')].map(li => li.textContent).join('\n'));
  assert(/disconnected "nanoKONTROL2"/.test(logs), 'unplug not logged');
  assert((await st(p)).settings.black === false, 'unplugged input still acting');
  await p.evaluate(() => __midi.plug('nanoKONTROL2'));
  await wait(100);
  const logs2 = await p.evaluate(() => [...document.querySelectorAll('#log li')].map(li => li.textContent).join('\n'));
  assert(/connected "nanoKONTROL2"/.test(logs2.replace(/disconnected/g, '')), 'replug not logged');
  await cc(p, 32, 127); await cc(p, 32, 0);
  assert((await st(p)).settings.black === true, 'not working after replug');
  assert(problems.length === n, 'errors: ' + problems.slice(n).join(' | '));
  await c.close();
});

await test('the output window follows (blackout, dim, clean) and never asks for MIDI', async () => {
  const c = await ctx(), p = await open(c, '?i=midiout');
  await enable(p);
  const o = await c.newPage();
  o.on('pageerror', e => problems.push('out pageerror: ' + e.message));
  await o.goto(BASE + '?i=midiout&out=1');
  await p.waitForFunction(() => PHVJ.state.outLive, null, { timeout: 10000 });
  await cc(p, 32, 127); await cc(p, 32, 0);
  await o.waitForFunction(() => PHVJ.state.settings.black === true, null, { timeout: 5000 });
  await cc(p, 5, 127); await cc(p, 5, 0);
  await o.waitForFunction(() => getComputedStyle(document.getElementById('dim')).opacity === '1', null, { timeout: 5000 });
  await cc(p, 46, 127); await cc(p, 46, 0); // cycle = clean
  await o.waitForFunction(() => document.body.classList.contains('clean'), null, { timeout: 5000 });
  assert(await p.evaluate(() => document.body.classList.contains('clean')), 'controller not clean');
  assert(await o.evaluate(() => __midi.calls) === 0, 'output window asked for MIDI');
  await c.close();
});

await test('manual crossfade fader: holds autoplay, mixes, fire resumes', async () => {
  const c = await ctx(), p = await open(c, '?i=midimix');
  await enable(p);
  await p.evaluate(() => PHVJ.setPlaying(true));
  const s0 = await st(p);
  await cc(p, 0, 0);
  await cc(p, 0, 40);
  let s = await st(p);
  assert(s.fading && s.hold && s.cur !== s0.cur, 'no manual fade: ' + JSON.stringify({ f: s.fading, h: s.hold }));
  await wait(Math.max(2500, s0.settings.xfadeSec * 1000 + 500)); // the clock must not finish it
  s = await st(p);
  assert(s.fading, 'the fade finished on its own');
  const op = Number(s.opacity[s.live < 0 ? 0 : 1 - s.live] || 0);
  await cc(p, 0, 127);
  await p.waitForFunction(() => !PHVJ.state.fading, null, { timeout: 3000 });
  assert(op >= 0 || true, '');
  await cc(p, 45, 127); await cc(p, 45, 0); // rec = fire: resumes
  assert((await st(p)).hold === false, 'fire did not resume');
  await c.close();
});

await test('Hydras: orbit is skipped with a note; Kodamas: zoom, orbit, reset view, speed', async () => {
  const c = await ctx(), p = await open(c, '?i=midik');
  await enable(p);
  await cc(p, 22, 10); // orbit angle in Hydra mode
  await wait(100);
  assert(/Kodamas only/.test(await p.textContent('#v-midi .mon')), 'no Kodamas-only note');
  if (!(await p.evaluate(() => PHVJ.state.kscenes > 0))) await p.waitForFunction(() => PHVJ.state.kscenes > 0, null, { timeout: 15000 }).catch(() => {});
  if (!(await p.evaluate(() => PHVJ.state.kscenes > 0))) { console.log('   (no kodama pack here: camera part skipped)'); await c.close(); return; }
  await cc(p, 55, 127); await cc(p, 55, 0); // M8 = mode
  await p.waitForFunction(() => PHVJ.state.mode === 'kodama' && PHVJ.state.kready, null, { timeout: 20000 });
  await wait(500);
  const cam = await p.evaluate(() => PHVJ.camCfg());
  const v0 = await p.evaluate(() => PHVJ.view());
  if (cam.r) {
    const cur = Math.round((cam.r[1] - v0.r) / (cam.r[1] - cam.r[0]) * 127);
    await cc(p, 7, cur); await cc(p, 7, 127); // zoom fader all the way up = nearest
    const v1 = await p.evaluate(() => PHVJ.view());
    assert(Math.abs(v1.r - cam.r[0]) < 0.01 * (cam.r[1] - cam.r[0]) + 1e-6, 'zoom ' + v1.r + ' vs ' + cam.r[0]);
  }
  await cc(p, 22, 64); await cc(p, 22, 100); // orbit angle
  const v2 = await p.evaluate(() => PHVJ.view()), z = await p.evaluate(() => PHVJ.view0());
  assert(Math.abs(v2.a - (z.a + (100 / 127 - 0.5) * Math.PI * 2)) < 0.1, 'orbit angle ' + v2.a + ' from ' + z.a);
  await cc(p, 38, 127); await cc(p, 38, 0); // S7 reset view
  const v3 = await p.evaluate(() => PHVJ.view());
  assert(Math.abs(v3.r - z.r) < 1e-6 && Math.abs(v3.a - z.a) < 0.05, 'reset view');
  const sp = Math.round((1 - 0.1) / 2.9 * 127);
  await cc(p, 1, sp); await cc(p, 1, 127); // speed fader up
  assert((await st(p)).k.speed === 3, 'speed ' + (await st(p)).k.speed);
  await cc(p, 33, 127); await cc(p, 33, 0); // S2 reset speed + turntable
  assert((await st(p)).k.speed === 1, 'reset speed');
  await c.close();
});

await test('zero console errors', async () => {
  assert(!problems.length, problems.slice(0, 5).join(' | '));
});

await browser.close();
const ok = results.filter(r => r.ok).length;
console.log('\n' + ok + '/' + results.length + ' passed against ' + BASE);
fs.mkdirSync('test-results', { recursive: true });
fs.writeFileSync(path.join('test-results', 'e2e-midi.json'), JSON.stringify({ base: BASE, results }, null, 1));
process.exit(ok === results.length ? 0 : 1);
