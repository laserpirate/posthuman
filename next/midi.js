// MIDI control (Web MIDI, no sysex), controller window only. The output window never touches MIDI:
// the actions run here and travel over the app's BroadcastChannel like any other control.
// Off until "Enable MIDI" is clicked (or, after that, when Chrome already holds the permission).
// Maps are JSON (data/midi-maps/*.json): bindings of { act, type: 'cc'|'note', ch (1-16, 0 = any), num,
// mode: 'abs' (knob/fader) | 'toggle' | 'momentary' | 'hold', holdMs, smooth (0..0.9) }.
(() => {
  'use strict';
  const P = window.PHVJ && window.PHVJ.midi;
  if (!P || P.out) return;
  const ACTS = P.acts, LOG = P.log;
  const $ = s => document.querySelector(s);
  const KEY = 'phvj:' + P.inst + ':midi';
  const PRESETS = { auto: 'Auto (by device name)', nanokontrol: 'nanoKONTROL (scene 1)', nanokontrol2: 'nanoKONTROL2 (factory CC mode)', generic: 'Generic' };
  // Auto: nanoKONTROL2 when the port says so, else the original nanoKONTROL (Marko's controller)
  const autoPreset = () => (M.inputs.some(i => /nanokontrol\s*2/i.test(i.name)) ? 'nanokontrol2' : 'nanokontrol');
  // UI controls that MIDI Learn can target by clicking them
  const TARGETS = {
    blackout: '#b-black', play: '#b-play', next: '#b-next', prev: '#b-prev', star: '#b-star', clean: '#b-clean', menu: '#b-hide',
    hold: '#b-hold', xfadeTime: '#n-xfade', speed: '#k-speed', tt: '#k-tt', resetSpeed: '#k-speed-1', contrast: '#p-con',
    palInt: '#p-int', nextPal: '#p-style', hueThr: '#p-thr', audio: '#au-on', zoomFx: '#au-zoom', flashFx: '#au-flash',
    resetView: '#k-view-reset', mode: '#b-mk', orbitA: '#k-pad',
  };
  const BUTTON_MODES = ['toggle', 'momentary', 'hold'];

  const M = {
    access: null, inputs: [], monitor: [], learn: null, picks: new Map(), held: new Map(), smooth: new Map(), ledLast: new Map(),
    st: load(), presets: {},
  };
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* none */ }
    s = s && typeof s === 'object' ? s : {};
    return { enabled: !!s.enabled, dev: typeof s.dev === 'string' ? s.dev : '', led: !!s.led, preset: PRESETS[s.preset] ? s.preset : 'auto', map: s.map && Array.isArray(s.map.bindings) ? s.map : null };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(M.st)); } catch (e) { /* full or blocked */ } }
  const log = (t, w) => LOG('MIDI: ' + t, w);
  const presetKey = () => (M.st.preset === 'auto' ? autoPreset() : M.st.preset);
  const map = () => M.st.map || M.presets[presetKey()] || { name: 'empty', bindings: [] };

  function cleanMap(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.bindings)) throw new Error('not a MIDI map (no bindings)');
    const bindings = m.bindings.filter(b => b && ACTS[b.act] && (b.type === 'cc' || b.type === 'note') && Number.isInteger(b.num) && b.num >= 0 && b.num < 128).map(b => ({
      act: b.act, type: b.type, ch: Number.isInteger(b.ch) && b.ch >= 0 && b.ch <= 16 ? b.ch : 0, num: b.num,
      mode: ACTS[b.act].fire ? (BUTTON_MODES.includes(b.mode) ? b.mode : 'toggle') : 'abs',
      holdMs: Number.isFinite(b.holdMs) ? Math.min(5000, Math.max(0, b.holdMs)) : (b.act === 'panic' ? 1000 : 0),
      smooth: Number.isFinite(b.smooth) ? Math.min(0.9, Math.max(0, b.smooth)) : 0,
    }));
    // panic always needs a 1 s hold, whatever a map says
    for (const b of bindings) if (b.act === 'panic') { b.mode = 'hold'; b.holdMs = Math.max(1000, b.holdMs); }
    return { name: String(m.name || 'custom').slice(0, 60), device: m.device ? String(m.device).slice(0, 60) : '', layout: m.layout || null, bindings };
  }
  async function loadPresets() {
    await Promise.all(Object.keys(PRESETS).filter(k => k !== 'auto').map(async k => {
      try { const r = await fetch('data/midi-maps/' + k + '.json', { cache: 'no-store' }); if (r.ok) M.presets[k] = cleanMap(await r.json()); } catch (e) { /* offline without the file */ }
    }));
    if (M.st.map) try { M.st.map = cleanMap(M.st.map); } catch (e) { M.st.map = null; }
  }

  // ---- devices ---------------------------------------------------------------------------------------
  async function enable(user) {
    if (!navigator.requestMIDIAccess) { status('Web MIDI is not available in this browser. Use Chrome (Safari has no Web MIDI).'); if (user) log('Web MIDI not supported in this browser', true); return false; }
    try {
      M.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) { status('MIDI access refused: ' + (e.message || e)); log('access refused (' + (e.message || e) + ')', true); return false; }
    M.st.enabled = true; save();
    M.access.onstatechange = e => {
      const p = e.port;
      if (!p || p.type !== 'input') return;
      if (p.state === 'connected' && !M.inputs.includes(p)) log('connected "' + p.name + '"');
      if (p.state === 'disconnected') log('disconnected "' + p.name + '"', true);
      attach(); render();
    };
    attach();
    log('enabled, ' + M.inputs.length + ' input(s)' + (M.inputs.length ? ': ' + M.inputs.map(i => i.name).join(', ') : ''));
    render();
    return true;
  }
  function disable() {
    for (const i of M.inputs) i.onmidimessage = null;
    if (M.access) M.access.onstatechange = null;
    M.access = null; M.inputs = []; M.st.enabled = false; save();
    log('disabled');
    render();
  }
  // listen to the chosen input (by name), or to every input when none is chosen
  function attach() {
    if (!M.access) return;
    for (const i of M.inputs) i.onmidimessage = null;
    const all = [...M.access.inputs.values()].filter(i => i.state !== 'disconnected');
    M.inputs = M.st.dev ? all.filter(i => i.name === M.st.dev) : all;
    for (const i of M.inputs) i.onmidimessage = e => { try { onMsg(e.data, i.name); } catch (err) { log('error: ' + (err.message || err), true); } };
  }
  function outPort() {
    if (!M.access) return null;
    const norm = n => String(n || '').toLowerCase().replace(/midi(in|out)\d*\s*\(?|\)|\s+/g, '');
    const want = M.inputs[0] ? norm(M.inputs[0].name) : '';
    return [...M.access.outputs.values()].find(o => o.state !== 'disconnected' && want && norm(o.name) === want) || null;
  }

  // ---- messages --------------------------------------------------------------------------------------
  function onMsg(data, dev) {
    const st = data[0] & 0xf0, ch = (data[0] & 0x0f) + 1;
    let type, num, val;
    if (st === 0xb0) { type = 'cc'; num = data[1]; val = data[2]; }
    else if (st === 0x90 || st === 0x80) { type = 'note'; num = data[1]; val = st === 0x80 ? 0 : data[2]; }
    else return; // clock, sysex and the rest are ignored
    const note = [];
    if (M.learn && M.learn.act) { bindLearn(type, ch, num); mon(ch, type, num, val, 'learned ' + ACTS[M.learn.act].label); M.learn.act = null; render(); return; }
    const bs = map().bindings.filter(b => b.type === type && b.num === num && (!b.ch || b.ch === ch));
    for (const b of bs) { const r = handle(b, val / 127); note.push(ACTS[b.act].label + (r ? ' (' + r + ')' : '')); }
    mon(ch, type, num, val, note.join('; ') || 'unbound', dev);
  }
  function handle(b, x) {
    const a = ACTS[b.act];
    if (b.mode === 'abs' && a.set) return absolute(b, a, x);
    const down = x > 0.5, k = b.type + b.ch + ':' + b.num;
    if (b.mode === 'hold') {
      clearTimeout(M.held.get(k));
      M.held.delete(k);
      if (down) { M.held.set(k, setTimeout(() => { M.held.delete(k); run(a); }, b.holdMs || 1000)); return 'hold ' + ((b.holdMs || 1000) / 1000) + ' s'; }
      return '';
    }
    if (b.mode === 'momentary') return run(a); // on press and again on release
    return down ? run(a) : '';
  }
  function run(a) {
    const r = a.fire ? a.fire() : a.set(1);
    if (typeof r === 'string' && r) { log(a.label + ': ' + r); return r; }
    led();
    return '';
  }
  // soft takeover: the hardware is ignored until it crosses the app's current value
  function absolute(b, a, x) {
    const k = b.type + b.ch + ':' + b.num, p = M.picks.get(k) || { picked: false, last: null, set: null };
    M.picks.set(k, p);
    const cur = a.get ? a.get() : null;
    if (cur == null) p.picked = true;
    else {
      if (p.set != null && Math.abs(cur - p.set) > 0.02) p.picked = false; // moved by something else
      if (!p.picked && (Math.abs(x - cur) < 0.03 || (p.last != null && (p.last - cur) * (x - cur) <= 0))) p.picked = true;
    }
    p.last = x;
    if (!p.picked) { pickHint(a.label + ': move ' + (x < cur ? 'up' : 'down') + ' to ' + Math.round(cur * 127) + ' to pick up'); return 'pickup ' + Math.round(cur * 127); }
    pickHint('');
    if (b.smooth > 0) return smoothTo(k, b, a, x);
    const r = a.set(x);
    p.set = a.get ? a.get() : null;
    return typeof r === 'string' ? r : '';
  }
  function smoothTo(k, b, a, x) {
    let s = M.smooth.get(k);
    if (!s) { s = { v: a.get ? a.get() : x, to: x, raf: 0 }; M.smooth.set(k, s); }
    s.to = x;
    const step = () => {
      s.v += (s.to - s.v) * (1 - b.smooth);
      if (Math.abs(s.to - s.v) < 0.002) s.v = s.to;
      a.set(s.v);
      const p = M.picks.get(k); if (p) p.set = a.get ? a.get() : null;
      s.raf = s.v === s.to ? 0 : requestAnimationFrame(step);
    };
    if (!s.raf) s.raf = requestAnimationFrame(step);
    return '';
  }

  // ---- learn -----------------------------------------------------------------------------------------
  function ownMap() { if (!M.st.map) M.st.map = JSON.parse(JSON.stringify(map())); return M.st.map; }
  function bindLearn(type, ch, num) {
    const act = M.learn.act, m = ownMap(), a = ACTS[act];
    m.bindings = m.bindings.filter(b => !(b.type === type && b.num === num && (!b.ch || b.ch === ch)) && b.act !== act);
    m.bindings.push({ act, type, ch, num, mode: a.fire ? (act === 'panic' ? 'hold' : 'toggle') : 'abs', holdMs: act === 'panic' ? 1000 : 0, smooth: 0 });
    m.name = m.name.replace(/ \(edited\)$/, '') + ' (edited)';
    save(); titles();
    log('learned ' + a.label + ' = ' + type.toUpperCase() + ' ' + num + ' ch ' + ch);
  }
  function setLearn(on) {
    M.learn = on ? { act: null } : null;
    document.body.classList.toggle('midi-learn', !!on);
    render();
  }
  // in learn mode a click on a mapped control picks it instead of using it
  document.addEventListener('click', e => {
    if (!M.learn) return;
    const el = e.target.closest && e.target.closest('[data-midi]');
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    pickLearn(el.dataset.midi);
  }, true);
  for (const ev of ['pointerdown', 'mousedown', 'input', 'change']) document.addEventListener(ev, e => { if (M.learn && e.target.closest && e.target.closest('[data-midi]')) { e.preventDefault(); e.stopPropagation(); } }, true);
  function pickLearn(act) {
    M.learn = { act };
    for (const el of document.querySelectorAll('[data-midi]')) el.classList.toggle('learn-on', el.dataset.midi === act);
    render();
  }
  // the binding shows on hover
  function titles() {
    for (const [act, sel] of Object.entries(TARGETS)) {
      const el = $(sel);
      if (!el) continue;
      el.dataset.midi = act;
      if (el.dataset.midiTitle == null) el.dataset.midiTitle = el.title || '';
      const b = map().bindings.filter(x => x.act === act);
      el.title = el.dataset.midiTitle + (b.length ? (el.dataset.midiTitle ? '\n' : '') + 'MIDI: ' + b.map(desc).join(', ') : '');
    }
  }
  const desc = b => (b.type === 'cc' ? 'CC ' : 'note ') + b.num + (b.ch ? ' ch ' + b.ch : '') + (b.mode === 'hold' ? ' hold ' + (b.holdMs / 1000) + ' s' : b.mode === 'momentary' ? ' momentary' : '');

  // ---- LED feedback (Korg "External" LED mode) -------------------------------------------------------
  function led(force) {
    if (!M.st.led || !M.access) return;
    const o = outPort();
    if (!o) return;
    for (const b of map().bindings) {
      const a = ACTS[b.act];
      if (!a.on || b.type !== 'cc') continue;
      const v = a.on() ? 127 : 0, k = b.num + ':' + (b.ch || 1);
      if (!force && M.ledLast.get(k) === v) continue;
      M.ledLast.set(k, v);
      try { o.send([0xb0 + ((b.ch || 1) - 1), b.num, v]); } catch (e) { /* port gone */ }
    }
  }
  setInterval(() => led(false), 250); // states also change from the keyboard and the UI

  // ---- UI: the MIDI tab ------------------------------------------------------------------------------
  const view = $('#v-midi');
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v); }
    for (const c of kids) if (c != null) el.append(c);
    return el;
  };
  let stEl = null, monEl = null, pickEl = null;
  function status(t) { if (stEl) stEl.textContent = t; M.status = t; }
  function pickHint(t) { if (pickEl) pickEl.textContent = t; }
  function mon(ch, type, num, val, what, dev) {
    M.monitor.unshift({ ch, type, num, val, what, dev, t: Date.now() });
    M.monitor.length = Math.min(M.monitor.length, 40);
    renderMon();
  }
  function renderMon() {
    if (monEl) monEl.replaceChildren(...M.monitor.slice(0, 12).map(m => h('li', { text: 'ch ' + m.ch + '  ' + (m.type === 'cc' ? 'CC ' : 'note ') + String(m.num).padStart(3) + '  = ' + String(m.val).padStart(3) + '   ' + m.what })));
  }
  function render() {
    titles();
    const on = !!M.access, m = map();
    const devs = on ? [...M.access.inputs.values()].filter(i => i.state !== 'disconnected') : [];
    const sel = h('select', { title: 'MIDI input', onchange: e => { M.st.dev = e.target.value; save(); attach(); log('input: ' + (M.st.dev || 'all inputs')); render(); } },
      h('option', { value: '', text: 'All inputs' }), ...devs.map(d => h('option', { value: d.name, text: d.name })),
      M.st.dev && !devs.some(d => d.name === M.st.dev) ? h('option', { value: M.st.dev, text: M.st.dev + ' (not connected)' }) : null);
    sel.value = M.st.dev;
    const preset = h('select', { title: 'Preset', onchange: e => { M.st.preset = e.target.value; M.st.map = null; M.picks.clear(); save(); log('preset: ' + PRESETS[M.st.preset]); render(); } },
      ...Object.entries(PRESETS).map(([k, n]) => h('option', { value: k, text: n })));
    preset.value = M.st.preset;
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      try { M.st.map = cleanMap(JSON.parse(await f.text())); M.picks.clear(); save(); log('imported map "' + M.st.map.name + '" (' + M.st.map.bindings.length + ' bindings)'); } catch (err) { log('import failed: ' + (err.message || err), true); }
      render();
    } });
    stEl = h('p', { class: 'dim', text: M.status || (on ? 'MIDI on. Listening to ' + (M.inputs.length ? M.inputs.map(i => i.name).join(', ') : 'no inputs (plug the controller in)') + '.' : 'MIDI is off. Nothing is asked of the browser until you click Enable MIDI.') });
    M.status = '';
    monEl = h('ol', { class: 'mon' });
    pickEl = h('p', { class: 'pick' });
    const used = new Set(m.bindings.map(b => b.act));
    const rows = Object.entries(ACTS).map(([act, a]) => {
      const bs = m.bindings.filter(b => b.act === act);
      return h('tr', {},
        h('td', { text: a.label }),
        h('td', { text: bs.length ? bs.map(desc).join(', ') : '—' }),
        h('td', {}, h('button', { text: M.learn && M.learn.act === act ? 'Move a control…' : 'Learn', 'aria-pressed': String(!!(M.learn && M.learn.act === act)), onclick: () => { if (!M.learn) setLearn(true); pickLearn(act); } }),
          bs.length ? h('button', { text: 'Clear', onclick: () => { const o = ownMap(); o.bindings = o.bindings.filter(b => b.act !== act); save(); log('cleared ' + a.label); render(); } }) : null));
    });
    view.replaceChildren(...[
      h('h3', { text: 'MIDI' }),
      h('div', { class: 'row' },
        h('button', { text: on ? 'Disable MIDI' : 'Enable MIDI', class: 'wide', id: 'midi-en', onclick: () => (on ? disable() : enable(true)) }),
        on ? sel : null),
      stEl,
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: 'Map' }), preset,
        h('span', { class: 'dim', text: M.st.map ? M.st.map.name : M.st.preset === 'auto' ? '→ ' + PRESETS[presetKey()] : '' }),
        h('button', { text: 'Reset to preset', onclick: () => { M.st.map = null; M.picks.clear(); save(); log('map reset to ' + PRESETS[M.st.preset]); render(); } })),
      h('div', { class: 'row' },
        h('button', { text: M.learn ? 'Stop learn' : 'MIDI Learn', 'aria-pressed': String(!!M.learn), id: 'midi-learn', onclick: () => setLearn(!M.learn) }),
        h('button', { text: 'Export map', onclick: exportMap }),
        h('button', { text: 'Import map', onclick: () => file.click() }), file),
      M.learn ? h('p', { class: 'pick', text: M.learn.act ? 'Now move a knob, fader or button for: ' + ACTS[M.learn.act].label : 'Click a control in the app (dashed outline) or a Learn button below, then move a knob, fader or button.' }) : null,
      h('p', { class: 'dim', text: 'nanoKONTROL: keep the SCENE LED on 1 (SCENE switches the device\'s own scenes; the app ignores it). If a button fires only every other press, set it to Momentary in Korg Kontrol Editor.' }),
      h('div', { class: 'row' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: M.st.led || null, onchange: e => { M.st.led = e.target.checked; save(); M.ledLast.clear(); led(true); } }), ' LED feedback (nanoKONTROL2 only: set its LED mode to External in Korg Kontrol Editor)')),
      pickEl,
      h('h3', { text: 'Monitor (last messages)' }), monEl,
      h('h3', { text: 'Layout' }), drawing(m),
      h('p', { class: 'dim', text: 'Knobs and faders use pickup: after a change elsewhere, move the control past the current value to take over. PANIC needs a 1 s hold. The manual crossfade fader holds autoplay and mixes to the cued (or next) item; Fire (●) or Next resumes. Full screen: browsers allow it only from a click or a key, so the MIDI full-screen action switches Clean full-window mode (no UI, stage fills the window; the output window too). For true full screen press F, double-click, or start Chrome with --kiosk. Controls that do not apply in this mode (orbit in Hydras) are skipped with a note in the monitor.' }),
      h('h3', { text: 'Bindings' }),
      h('table', {}, h('tbody', {}, ...rows)),
      h('p', { class: 'dim', text: used.size + ' of ' + Object.keys(ACTS).length + ' actions bound. Chrome only (Safari has no Web MIDI).' }),
    ].filter(Boolean));
    renderMon();
  }
  function exportMap() {
    const m = map(), blob = new Blob([JSON.stringify(m, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'phvj-midi-' + P.inst + '.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    log('exported map "' + m.name + '"');
  }
  // a drawing of the controller with the current bindings, from the map's layout
  function drawing(m) {
    const NS = 'http://www.w3.org/2000/svg', L = m.layout || (M.presets[presetKey()] || {}).layout;
    const svg = document.createElementNS(NS, 'svg');
    const el = (tag, at, text) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); if (text) e.textContent = text; svg.append(e); return e; };
    const strips = L && L.strips ? L.strips : 8, tx = L && L.transport ? L.transport : [];
    const W = 120 + strips * 70, Hh = 170;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    const lab = (type, num) => { const b = m.bindings.filter(x => x.type === type && x.num === num); return b.length ? b.map(x => short(ACTS[x.act].label)).join('/') : ''; };
    const short = s => (s.length > 15 ? s.slice(0, 14) + '…' : s);
    el('rect', { x: 1, y: 1, width: W - 2, height: Hh - 2, rx: 6, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.4 });
    tx.forEach((t, i) => {
      const x = 10 + (i % 2) * 52, y = 14 + Math.floor(i / 2) * 22;
      el('rect', { x, y, width: 48, height: 16, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.6 });
      el('text', { x: x + 2, y: y + 7 }, t.name);
      el('text', { x: x + 2, y: y + 14, fill: 'var(--on)' }, lab('cc', t.cc));
    });
    for (let s = 0; s < strips; s++) {
      const x = 120 + s * 70;
      el('circle', { cx: x + 10, cy: 18, r: 8, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.6 });
      if (L) {
        el('text', { x: x + 21, y: 14 }, lab('cc', L.knob[s]));
        ['s', 'm', 'r'].forEach((row, j) => {
          if (!L[row]) return;
          el('rect', { x, y: 34 + j * 20, width: 12, height: 10, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.6 });
          el('text', { x: x + 2, y: 42 + j * 20 }, (L.rowNames && L.rowNames[row] ? L.rowNames[row][0] : row).toUpperCase());
          el('text', { x: x + 15, y: 42 + j * 20 }, lab('cc', L[row][s]));
        });
        el('rect', { x: x + 3, y: 98, width: 6, height: 52, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.6 });
        el('text', { x: x + 13, y: 126 }, lab('cc', L.fader[s]));
      }
      el('text', { x: x + 2, y: 162 }, String(s + 1));
    }
    if (!L) el('text', { x: 130, y: 80 }, 'No layout in this map; see the Bindings table.');
    return svg;
  }

  // test handle
  window.PHVJ.midiUI = { enable, disable, state: () => ({ on: !!M.access, inputs: M.inputs.map(i => i.name), map: map(), learn: M.learn, monitor: M.monitor.slice(), st: { ...M.st } }), setLearn, pickLearn };

  loadPresets().then(async () => {
    render();
    // MIDI stays off unless it was enabled here before and Chrome already grants it (no prompt)
    if (!M.st.enabled || !navigator.requestMIDIAccess || !navigator.permissions) return;
    try { const q = await navigator.permissions.query({ name: 'midi', sysex: false }); if (q.state === 'granted') enable(false); } catch (e) { /* no query for midi */ }
  });
})();
