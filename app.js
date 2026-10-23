// POST/HUMAN · VJ: gallery, playlists and autoplay for Hydra gallery sketches.
// © 2026 Marko Manriquez. All rights reserved. Sketches CC BY-NC-SA 4.0 by their authors; hydra-synth AGPL-3.0.
//
// Provenance: the hydra runner (with(h) eval, autoLoop:false, one rAF loop, hush + time reset before
// each eval), the quality levels and the fps guard are copied from posthuman3026/build/src/app.js
// (2026-10-18) and adapted here: two decks only, no compositor instance.
//
// Reliability rules: exactly two hydra instances (A/B), made once and reused for every sketch; the
// deck that is not on screen is not ticked; every eval and tick is wrapped; a sketch that throws or
// stays black or white for more than 3 s is skipped and logged in the controller, never on the output.
(() => {
  'use strict';

  const D = window.PH_DATA;
  const SK = new Map(D.sketches.map(s => [s.id, s]));
  const LICENSE = 'CC BY-NC-SA 4.0';
  const $ = sel => document.querySelector(sel);
  const body = document.body;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
    return el;
  }
  const clamp = (v, lo, hi, fb) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb; };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---- instance and storage: ?i=<name> keeps its own playlists and settings ------------------

  const params = new URLSearchParams(location.search);
  const INST = (params.get('i') || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'main';
  // ?out=1: an output-only window driven by the controller window of the same instance. It reads the
  // instance's saved state but never writes it.
  const OUT = params.get('out') === '1';
  const KEY = k => 'phvj:' + INST + ':' + k;
  function load(k, fb) {
    try { const v = localStorage.getItem(KEY(k)); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
  }
  function save(k, v) {
    if (OUT) return;
    try { localStorage.setItem(KEY(k), JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
  }

  // audio bands: each is a chain of biquads (none for full) into its own analyser
  // saved edits (variants) join the pool before the playlists are checked against it
  const VARIANTS = load('variants', []).filter(v => v && typeof v.code === 'string' && typeof v.id === 'string' && SK.has(v.base));
  for (const v of VARIANTS) addVariantToPool(v);

  const BANDS = ['full', 'low', 'mid', 'high', 'custom'];
  const BAND_LABEL = { full: 'Full', low: 'Low (kick/bass)', mid: 'Mid', high: 'High (hats)', custom: 'Custom Hz' };
  const bandFilters = (b, lo, hi) => ({
    full: [],
    low: [['lowpass', 150]],
    mid: [['highpass', 1000], ['lowpass', 3000]],
    high: [['highpass', 6000]],
    custom: [['highpass', lo], ['lowpass', hi]],
  })[b];
  const bandDef = () => ({ sens: 8, smooth: 0.85, thr: 0.05 });
  const DEF = {
    defaultDur: 30, transition: 'xfade', xfadeSec: 2, random: false, scope: 'playlist',
    quality: 'med', autoDrop: true, credits: true, clean: false, menuHidden: false, black: false,
    tab: 'playlist', pullN: 5, pullFrom: 'pool',
    bpm: 120, bars: 0, outPreview: false,
    au: {
      on: false, dev: '', lo: 40, hi: 120,
      bands: { full: bandDef(), low: bandDef(), mid: bandDef(), high: bandDef(), custom: bandDef() },
      zoomSrc: 'low', zoom: 0.08, flashSrc: 'high', flash: 0.5,
    },
  };
  const S = (() => {
    const v = Object.assign({}, DEF, load('settings', {}));
    v.defaultDur = clamp(v.defaultDur, 1, 3600, DEF.defaultDur);
    v.xfadeSec = clamp(v.xfadeSec, 0.2, 10, DEF.xfadeSec);
    v.pullN = clamp(v.pullN, 1, 58, DEF.pullN);
    if (!['xfade', 'cut'].includes(v.transition)) v.transition = DEF.transition;
    if (!['playlist', 'pool'].includes(v.scope)) v.scope = DEF.scope;
    if (!['low', 'med', 'high'].includes(v.quality)) v.quality = DEF.quality;
    if (!['pool', 'starred'].includes(v.pullFrom)) v.pullFrom = DEF.pullFrom;
    if (!['playlist', 'gallery', 'live', 'code', 'credits', 'log'].includes(v.tab)) v.tab = DEF.tab;
    for (const k of ['random', 'autoDrop', 'credits', 'clean', 'menuHidden', 'black', 'outPreview']) v[k] = !!v[k];
    v.bpm = clamp(v.bpm, 40, 240, DEF.bpm);
    v.bars = [0, 4, 8, 16, 32].includes(Number(v.bars)) ? Number(v.bars) : 0;
    const au = Object.assign({}, DEF.au, v.au && typeof v.au === 'object' ? v.au : {});
    au.on = !!au.on;
    au.dev = typeof au.dev === 'string' ? au.dev : '';
    au.lo = clamp(au.lo, 20, 18000, DEF.au.lo);
    au.hi = clamp(au.hi, au.lo + 10, 20000, Math.max(DEF.au.hi, au.lo + 10));
    const bands = {};
    for (const b of BANDS) {
      const x = Object.assign(bandDef(), au.bands && au.bands[b] ? au.bands[b] : {});
      bands[b] = { sens: clamp(x.sens, 0.5, 40, 8), smooth: clamp(x.smooth, 0, 0.97, 0.85), thr: clamp(x.thr, 0, 0.9, 0.05) };
    }
    au.bands = bands;
    for (const k of ['zoomSrc', 'flashSrc']) if (au[k] !== 'off' && !BANDS.includes(au[k])) au[k] = DEF.au[k];
    au.zoom = clamp(au.zoom, 0, 0.3, DEF.au.zoom);
    au.flash = clamp(au.flash, 0, 1.5, DEF.au.flash);
    for (const k of ['band', 'sens', 'smooth']) delete au[k]; // v0.1 single-band settings
    v.au = au;
    return v;
  })();
  const saveSettings = () => save('settings', S);

  // a playlist is [{id, dur}], no duplicate ids, only known sketches
  function cleanList(items) {
    const seen = new Set(), out = [];
    for (const it of Array.isArray(items) ? items : []) {
      const id = it && typeof it.id === 'string' ? it.id : null;
      if (!id || !SK.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, dur: clamp(it.dur, 1, 3600, S.defaultDur) });
    }
    return out;
  }
  function cleanLists(v) {
    if (!v || typeof v !== 'object' || !v.lists || typeof v.lists !== 'object') return null;
    const lists = {};
    for (const [name, items] of Object.entries(v.lists)) {
      const n = String(name).trim().slice(0, 40);
      if (n) lists[n] = cleanList(items);
    }
    const names = Object.keys(lists);
    if (!names.length) return null;
    return { active: names.includes(v.active) ? v.active : names[0], lists };
  }
  let LISTS = cleanLists(load('lists', null)) ||
    { active: 'Favorites', lists: { Favorites: D.favorites.map(id => ({ id, dur: S.defaultDur })) } };
  const saveLists = () => save('lists', LISTS);
  const stars = new Set((load('stars', null) || D.favorites).filter(id => SK.has(id)));
  const saveStars = () => save('stars', [...stars]);
  const banned = new Set((load('banned', null) || []).filter(id => SK.has(id)));
  const saveBanned = () => save('banned', [...banned]);

  const PLAY = (() => {
    const v = Object.assign({ id: null, pos: 0, elapsed: 0, playing: false, hold: false, cue: null, bag: [], hist: [] }, load('play', {}));
    if (!SK.has(v.id)) v.id = null;
    if (!SK.has(v.cue)) v.cue = null;
    v.pos = clamp(v.pos, 0, 999, 0);
    v.elapsed = clamp(v.elapsed, 0, 3600e3, 0);
    v.playing = !!v.playing && !OUT; // the output window never runs its own clock
    v.hold = !!v.hold;
    v.bag = Array.isArray(v.bag) ? v.bag.filter(id => SK.has(id)) : [];
    v.hist = Array.isArray(v.hist) ? v.hist.filter(id => SK.has(id)).slice(-100) : [];
    return v;
  })();
  function savePlay() {
    PLAY.id = RT.cur;
    PLAY.elapsed = Math.round(RT.elapsed);
    save('play', PLAY);
  }

  const list = () => LISTS.lists[LISTS.active];

  // ---- runtime state --------------------------------------------------------------------------

  const RT = {
    cur: null, elapsed: 0, fade: null, live: -1, decks: [], failed: new Set(),
    errors: 0, ctxLost: 0, hydras: 0, skips: 0, fps: 0, level: S.quality, code: false, fs: false,
    outSeen: -1e9, fx: 0, evals: 0, // outSeen: last hello from an output window (performance.now starts near 0)
  };

  // ---- controller log (never shown on the output) ---------------------------------------------

  const logEl = $('#log'), logN = $('#log-n');
  let unseen = 0;
  function log(msg, warn) {
    const t = new Date().toTimeString().slice(0, 8);
    logEl.prepend(h('li', { class: warn ? 'w' : '', text: t + '  ' + msg }));
    while (logEl.children.length > 300) logEl.lastChild.remove();
    if (warn && S.tab !== 'log') { unseen++; logN.textContent = String(unseen); logN.hidden = false; }
  }
  window.addEventListener('error', e => { RT.errors++; log('Error: ' + (e.message || 'unknown'), true); });
  window.addEventListener('unhandledrejection', e => {
    RT.errors++;
    log('Error: ' + ((e.reason && e.reason.message) || String(e.reason)), true);
  });

  // ---- quality ----------------------------------------------------------------------------------

  const LEVELS = ['low', 'med', 'high'];
  const LEVEL = {
    low: { w: 960, h: 540, fps: 30 },
    med: { w: 1280, h: 720, fps: 30 },
    high: { w: 1920, h: 1080, fps: 60 },
  };

  // fps meter: after `secs` whole seconds under `min` fps, calls onDrop once and starts over
  function makeGuard(onDrop, min = 24, secs = 5) {
    let n = 0, t0 = 0, slow = 0, fps = 0;
    return {
      get fps() { return fps; },
      frame(now) {
        if (!t0 || now - t0 > 2000) { n = 0; t0 = now; return; } // first frame or back from a stall
        n++;
        if (now - t0 < 1000) return;
        fps = n * 1000 / (now - t0);
        n = 0; t0 = now;
        slow = fps < min ? slow + 1 : 0;
        if (slow >= secs) { slow = 0; onDrop(fps); }
      },
      idle() { n = 0; t0 = 0; slow = 0; },
    };
  }
  const guard = makeGuard(fps => {
    if (!S.autoDrop || RT.level === 'low') return;
    RT.level = LEVELS[LEVELS.indexOf(RT.level) - 1];
    log('Quality dropped to ' + RT.level + ' (' + fps.toFixed(0) + ' fps)', true);
    applyQuality();
  });
  function applyQuality() {
    const c = LEVEL[RT.level];
    for (const d of RT.decks) if (d.canvas.width !== c.w || d.canvas.height !== c.h) d.hy.setResolution(c.w, c.h);
    guard.idle();
    renderBar();
  }

  function gpuName() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return 'no WebGL';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return name;
    } catch (e) { return 'unknown GPU'; }
  }

  // ---- decks: two hydra instances, made once ----------------------------------------------------

  // sketches that read audio (a.fft) get silent bands; audio input is off in the core app
  const audioStub = () => ({
    fft: [0, 0, 0, 0], vol: 0, bins: [], beat: {}, settings: [],
    setBins() {}, setSmooth() {}, setCutoff() {}, setScale() {}, show() {}, hide() {}, onBeat() {},
  });

  function mkDeck(canvas) {
    const c = LEVEL[RT.level];
    canvas.width = c.w; canvas.height = c.h;
    const hy = new window.Hydra({
      canvas, width: c.w, height: c.h, autoLoop: false, makeGlobal: false,
      detectAudio: false, enableStreamCapture: false,
    });
    RT.hydras++;
    if (!hy.synth.a) hy.synth.a = audioStub();
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      RT.ctxLost++;
      log('WebGL context lost. Reloading in 2 s; playlist and position are saved.', true);
      savePlay();
      setTimeout(() => location.reload(), 2000);
    });
    return { hy, canvas, id: null, badSince: 0, tickErr: '' };
  }

  // hush, clear the feedback buffers, reset time, then eval. Returns the error, or null.
  function loadInto(d, sk) {
    const hy = d.hy, s = hy.synth, c = LEVEL[RT.level];
    try {
      if (d.canvas.width !== c.w || d.canvas.height !== c.h) hy.setResolution(c.w, c.h);
      // hush() gives each source a fresh 1x1 texture without freeing the old one (4 leaked
      // textures per switch); free them first. Only the idle deck is ever reloaded.
      for (const src of hy.s || []) { try { if (src.tex) src.tex.destroy(); } catch (e) { /* already gone */ } }
      hy.hush();
      s.speed = 1; s.bpm = 30; s.fps = undefined;
      if (!s.a || !s.a.fft) s.a = audioStub();
      hy.tick(16); hy.tick(16);
    } catch (e) { /* a broken previous sketch; the eval below decides */ }
    s.time = 0;
    d.tickErr = '';
    d.edited = false;
    RT.evals++;
    try {
      new Function('h', 'with(h){' + sk.code + '\n}')(s);
      tickSafe(d, 16);
      return null;
    } catch (e) {
      try { hy.hush(); } catch (e2) { /* ignore */ }
      return e;
    }
  }

  // hydra-synth catches errors thrown inside sketch functions (uniform callbacks) and prints
  // console.warn('ERROR', err) every frame. While a deck ticks, that warning marks the deck as failed.
  let tickDeck = null;
  const warn = console.warn.bind(console);
  console.warn = (...args) => {
    if (tickDeck && args[0] === 'ERROR') {
      if (!tickDeck.tickErr) tickDeck.tickErr = (args[1] && args[1].message) || String(args[1]);
      return;
    }
    warn(...args);
  };
  function tickSafe(d, dt) {
    tickDeck = d;
    try { d.hy.tick(dt); } finally { tickDeck = null; }
    if (d.tickErr) throw new Error(d.tickErr);
  }

  const curDeck = () => (RT.fade ? RT.decks[RT.fade.to] : RT.live >= 0 ? RT.decks[RT.live] : null);

  function finishFade() {
    const f = RT.fade;
    if (!f) return;
    RT.decks[f.to].canvas.style.opacity = '1';
    RT.decks[f.from].canvas.style.opacity = '0';
    RT.live = f.to;
    RT.fade = null;
  }

  // put a sketch on the idle deck and transition to it
  function show(id, opts = {}) {
    const sk = SK.get(id);
    if (!sk) return false;
    finishFade();
    const idle = RT.live < 0 ? 0 : 1 - RT.live, d = RT.decks[idle];
    const err = loadInto(d, sk);
    if (err) {
      d.id = null;
      RT.failed.add(id);
      RT.skips++;
      log('Skipped "' + sk.title + '" (' + id + '): ' + (err.message || err), true);
      return false;
    }
    d.id = id; d.badSince = 0;
    RT.cur = id; RT.elapsed = opts.elapsed || 0;
    if (PLAY.cue === id) PLAY.cue = null;
    const old = RT.live >= 0 ? RT.decks[RT.live] : null;
    const cut = !!(opts.cut || S.transition === 'cut' || !old);
    post({ t: 'show', id, cut, xfadeSec: S.xfadeSec });
    d.canvas.style.zIndex = '2';
    if (old) old.canvas.style.zIndex = '1';
    if (cut) {
      d.canvas.style.opacity = '1';
      if (old) old.canvas.style.opacity = '0';
      RT.live = idle;
    } else {
      d.canvas.style.opacity = '0';
      RT.fade = { from: RT.live, to: idle, t0: performance.now(), ms: S.xfadeSec * 1000 };
    }
    const idx = list().findIndex(it => it.id === id);
    if (idx >= 0) PLAY.pos = idx;
    savePlay();
    renderNow();
    return true;
  }

  // a deck failed while running (throws on tick, or stays black or white)
  function failDeck(d, reason) {
    const id = d.id, sk = SK.get(id);
    d.id = null;
    RT.failed.add(id);
    RT.skips++;
    log('Skipped "' + (sk ? sk.title : id) + '" (' + id + '): ' + reason, true);
    const f = RT.fade;
    if (f && RT.decks[f.from] === d) { finishFade(); return; } // the outgoing one died mid fade
    if (f && RT.decks[f.to] === d) { d.canvas.style.opacity = '0'; RT.fade = null; }
    else if (RT.decks[RT.live] === d) d.canvas.style.opacity = '0';
    if (RT.cur === id) RT.cur = null;
    // the output window does not pick what plays: it reports and waits for the controller
    if (OUT) { if (chan) chan.postMessage({ t: 'failed', id, reason }); return; }
    advance(1, { cut: true, from: id });
  }

  // ---- what plays next ------------------------------------------------------------------------

  const playable = id => { const s = SK.get(id); return !!s && !s.quarantine && !RT.failed.has(id) && !banned.has(id); };
  // with tempo sync on, every sketch runs N bars of 4 beats; otherwise its own duration
  const durOf = id => {
    if (S.bars) return S.bars * 4 * 60 / S.bpm;
    const it = list().find(x => x.id === id);
    return it ? it.dur : S.defaultDur;
  };
  const universe = () => (S.scope === 'pool' ? D.sketches.map(s => s.id) : list().map(it => it.id)).filter(playable);

  function pickNext(dir, from) {
    if (dir > 0 && PLAY.cue) {
      const id = PLAY.cue;
      PLAY.cue = null;
      if (playable(id) && id !== from) return id;
    }
    if (S.random && dir > 0) {
      const all = universe();
      PLAY.bag = PLAY.bag.filter(id => all.includes(id) && id !== from);
      if (!PLAY.bag.length) PLAY.bag = all.filter(id => id !== from);
      if (!PLAY.bag.length) return all.includes(from) ? from : null;
      return PLAY.bag.splice(Math.floor(Math.random() * PLAY.bag.length), 1)[0];
    }
    if (S.random && dir < 0) {
      while (PLAY.hist.length) { const id = PLAY.hist.pop(); if (id !== from && playable(id)) return id; }
    }
    const L = list();
    if (!L.length) return null;
    let base = L.findIndex(it => it.id === from);
    if (base < 0) base = dir > 0 ? PLAY.pos - 1 : PLAY.pos;
    for (let j = 1; j <= L.length; j++) {
      const k = (((base + dir * j) % L.length) + L.length) % L.length;
      if (playable(L[k].id)) return L[k].id;
    }
    return null;
  }

  function advance(dir, opts = {}) {
    let from = 'from' in opts ? opts.from : RT.cur;
    for (let tries = 0; tries < SK.size + 1; tries++) {
      const id = pickNext(dir, from);
      if (!id) {
        RT.elapsed = 0;
        if (!curDeck() || !curDeck().id) stageMsg('Nothing playable. Add sketches to the playlist.');
        renderNow();
        return false;
      }
      if (S.random && dir > 0 && RT.cur) { PLAY.hist.push(RT.cur); if (PLAY.hist.length > 100) PLAY.hist.shift(); }
      if (show(id, opts)) { stageMsg(''); return true; }
      from = id;
    }
    return false;
  }
  const next = () => advance(1);
  const prev = () => advance(-1);

  function setPlaying(on) {
    PLAY.playing = !!on;
    if (on && !RT.cur) advance(1);
    savePlay();
    renderBar();
  }

  // ---- the one loop -----------------------------------------------------------------------------

  const probe = document.createElement('canvas');
  probe.width = 160; probe.height = 90;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  function blankness(canvas) {
    pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    const px = pctx.getImageData(0, 0, probe.width, probe.height).data;
    let hi = 0, lo = 255;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx > hi) hi = mx;
      if (mn < lo) lo = mn;
    }
    return hi < 10 ? 'black' : lo > 245 ? 'white' : '';
  }

  let last = 0, lastProbe = 0, lastUi = 0, lastSave = 0;
  const ticks = [0, 0];
  function frame(now) {
    requestAnimationFrame(frame);
    const cap = LEVEL[RT.level].fps;
    if (last && now - last < 1000 / cap - 8) return; // 8 ms slack: 30 fps holds on 60 Hz with frame jitter
    const dt = last ? Math.min(now - last, 250) : 16;
    last = now;
    guard.frame(now);

    const f = RT.fade;
    if (f) {
      const k = (now - f.t0) / f.ms;
      if (k >= 1) finishFade();
      else RT.decks[f.to].canvas.style.opacity = k.toFixed(3);
    }
    // with an output window open, this preview can rest (the output checks its own frames)
    const rest = previewResting();
    // tick only what is on screen: the live deck, plus the incoming one during a fade
    for (let i = 0; i < 2 && !rest; i++) {
      const d = RT.decks[i];
      if (!d.id || (i !== RT.live && !(RT.fade && RT.fade.to === i))) continue;
      try { tickSafe(d, dt); ticks[i]++; } catch (e) {
        if (d.edited) edRecover(d, e.message || String(e)); // a live edit: never skip, put the last good code back
        else failDeck(d, 'runtime error: ' + (e.message || e));
        return;
      }
    }
    if (!OUT) { audioFrame(); knobFrame(now); }
    const d = curDeck();
    if (!rest && d && d.id && !d.edited && now - lastProbe > 1000) {
      lastProbe = now;
      let bad = '';
      try { bad = blankness(d.canvas); } catch (e) { /* readback unavailable */ }
      if (!bad) d.badSince = 0;
      else if (!d.badSince) d.badSince = now;
      else if (now - d.badSince > 3000) { failDeck(d, 'rendered ' + bad + ' for 3 s'); return; }
    }
    if (PLAY.playing && !PLAY.hold && RT.cur) {
      RT.elapsed += dt;
      if (RT.elapsed >= durOf(RT.cur) * 1000) advance(1);
    }
    if (now - lastUi > 250) { lastUi = now; renderClock(); }
    if (now - lastSave > 2000) { lastSave = now; savePlay(); }
  }

  // ---- UI: bar, stage --------------------------------------------------------------------------

  const btn = id => $('#b-' + id);
  const press = (el, on) => el.setAttribute('aria-pressed', String(!!on));
  function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

  function renderClock() {
    const c = $('#count');
    if (!RT.cur) c.textContent = '-:--';
    else {
      const rem = durOf(RT.cur) - RT.elapsed / 1000;
      c.textContent = (!PLAY.playing ? 'paused ' : PLAY.hold ? 'hold ' : '') + fmt(rem);
    }
    $('#fps').textContent = (rest => (rest ? 'rest' : (guard.fps ? guard.fps.toFixed(0) : '--') + ' fps'))(previewResting());
    if (!OUT) {
      const live = outLive();
      $('#out-st').textContent = live ? 'Output window connected' + (previewResting() ? '. Preview resting.' : '') : 'Not open';
      stageMsg(previewResting() ? 'Preview resting while the output window is open' : RT.cur ? '' : $('#stage-msg').textContent);
    }
  }

  function renderBar() {
    $('#inst').textContent = INST;
    btn('play').textContent = PLAY.playing ? 'Pause' : 'Play';
    press(btn('play'), PLAY.playing);
    press(btn('rand'), S.random);
    press(btn('code'), RT.code);
    press(btn('cred'), S.credits);
    press(btn('clean'), S.clean);
    press(btn('black'), S.black);
    press(btn('full'), RT.fs);
    press(btn('hide'), S.menuHidden);
    $('#s-scope').value = S.scope;
    $('#s-trans').value = S.transition;
    $('#n-xfade').value = String(S.xfadeSec);
    $('#n-xfade').disabled = S.transition === 'cut';
    $('#s-q').value = RT.level;
    body.classList.toggle('clean', S.clean);
    body.classList.toggle('menu-off', S.menuHidden && !S.clean);
    $('#peek').hidden = !(S.menuHidden && !S.clean && !RT.fs);
    $('#black').hidden = !S.black;
    $('#code-ov').hidden = !RT.code;
    $('#credit').hidden = !S.credits;
    // live tab
    press(btn('hold'), PLAY.hold);
    $('#out-prev').checked = S.outPreview;
    $('#n-bpm').value = String(S.bpm);
    $('#s-bars').value = String(S.bars);
    $('#au-on').checked = S.au.on;
    $('#au-zsrc').value = S.au.zoomSrc; $('#au-fsrc').value = S.au.flashSrc;
    $('#au-zoom').value = String(S.au.zoom); $('#au-flash').value = String(S.au.flash);
    $('#au-lo').value = String(S.au.lo); $('#au-hi').value = String(S.au.hi);
    const cue = SK.get(PLAY.cue);
    $('#cue-st').textContent = cue ? 'Cued next: ' + cue.title : '';
    renderClock();
  }

  function renderNow() {
    const sk = SK.get(RT.cur);
    $('#now').textContent = sk ? sk.title + ' · ' + sk.author : '';
    $('#credit').textContent = sk ? sk.title + ' · ' + sk.author + ' · ' + LICENSE : '';
    $('#code-ov').textContent = sk ? sk.code : '';
    for (const li of $('#pl-list').children) li.classList.toggle('cur', li.dataset.id === RT.cur);
    for (const c of $('#g-grid').children) c.classList.toggle('cur', c.dataset.id === RT.cur);
    if (!OUT) { renderStar(); if (ED.id !== RT.cur) edLoad(RT.cur); }
    renderClock();
  }

  function stageMsg(t) { const m = $('#stage-msg'); m.textContent = t; m.hidden = !t; }

  function setCode(on) { RT.code = !!on; renderBar(); postState(); }
  function setBlack(on) { S.black = !!on; saveSettings(); renderBar(); postState(); }
  function setClean(on) { S.clean = !!on; saveSettings(); renderBar(); }
  function setMenuHidden(on) { S.menuHidden = !!on; saveSettings(); renderBar(); poke(); }

  // full screen: menu auto-hides after 3 s without mouse movement
  let idleT = 0;
  function poke() {
    body.classList.remove('idle');
    clearTimeout(idleT);
    if (RT.fs) idleT = setTimeout(() => { if (RT.fs && !$('#bar').matches(':hover')) body.classList.add('idle'); else poke(); }, 3000);
  }
  // Chrome sends synthetic mousemoves with no movement (cursor hidden, layout change); only real
  // movement brings the menu back
  let mx = -1, my = -1;
  document.addEventListener('mousemove', e => {
    if (e.clientX === mx && e.clientY === my) return;
    mx = e.clientX; my = e.clientY;
    poke();
  });
  function setFs(on) {
    RT.fs = !!on;
    body.classList.toggle('fs', RT.fs);
    if (RT.fs) setCode(false); // code never shows in full screen unless toggled on there
    renderBar();
    poke();
  }
  document.addEventListener('fullscreenchange', () => setFs(!!document.fullscreenElement));
  if (!OUT) $('#stage').addEventListener('dblclick', toggleFull);
  // the Fullscreen API when the browser allows it; otherwise the same layout as a full-window mode
  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => setFs(false)); return; }
    if (RT.fs) { setFs(false); return; } // leaving the full-window fallback
    const el = document.documentElement;
    if (!el.requestFullscreen) { log('Full screen API unavailable; using full window'); setFs(true); return; }
    el.requestFullscreen().catch(e => { log('Full screen refused (' + (e.message || e) + '); using full window', true); setFs(true); });
  }

  // ---- UI: tabs ---------------------------------------------------------------------------------

  function setTab(t) {
    S.tab = t; saveSettings();
    for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const v of ['playlist', 'gallery', 'live', 'code', 'credits', 'log']) $('#v-' + v).hidden = v !== t;
    if (t === 'log') { unseen = 0; logN.hidden = true; }
    if (t === 'gallery' && !$('#g-grid').children.length) renderGallery();
  }

  // ---- UI: playlist -----------------------------------------------------------------------------

  const plList = $('#pl-list');
  function renderPlaylist() {
    const sel = $('#pl-sel');
    sel.replaceChildren(...Object.keys(LISTS.lists).map(n => h('option', { value: n, text: n + ' (' + LISTS.lists[n].length + ')' })));
    sel.value = LISTS.active;
    $('#def-dur').value = String(S.defaultDur);
    $('#pull-n').value = String(S.pullN);
    $('#pull-from').value = S.pullFrom;
    const L = list();
    plList.replaceChildren(...L.map((it, i) => {
      const sk = SK.get(it.id);
      const q = sk.quarantine ? ' (quarantined: ' + sk.quarantine + ')' : '';
      const cls = [it.id === RT.cur ? 'cur' : '', sk.quarantine ? 'q' : '', PLAY.cue === it.id ? 'cued' : '', banned.has(it.id) ? 'ban' : ''];
      return h('li', { 'data-id': it.id, class: cls.join(' ').trim() },
        h('span', { class: 'h', title: 'Drag to reorder', text: '≡' }),
        h('span', { class: 'i', text: String(i + 1) }),
        h('button', { class: 'star', 'data-act': 'star', title: 'Star', 'aria-pressed': String(stars.has(it.id)), text: stars.has(it.id) ? '★' : '☆' }),
        h('span', { class: 't', title: 'Play now' + q, 'data-act': 'play' }, sk.title, h('small', { text: sk.author })),
        h('input', { type: 'number', min: 1, max: 3600, step: 1, value: it.dur, title: 'Seconds', 'data-act': 'dur' }),
        h('button', { 'data-act': 'cue', title: 'Play this next', text: 'Cue', 'aria-pressed': String(PLAY.cue === it.id) }),
        h('button', { 'data-act': 'ban', class: 'warn', title: 'Ban: never autoplay on this instance', text: 'Ban', 'aria-pressed': String(banned.has(it.id)) }),
        h('button', { 'data-act': 'up', title: 'Move up', text: '↑', disabled: i === 0 }),
        h('button', { 'data-act': 'down', title: 'Move down', text: '↓', disabled: i === L.length - 1 }),
        h('button', { 'data-act': 'rm', title: 'Remove', text: '✕' }));
    }));
    $('#pl-empty').hidden = L.length > 0;
    for (const c of $('#g-grid').children) markInList(c);
  }
  function changed() { saveLists(); renderPlaylist(); }

  function move(from, to) {
    const L = list();
    if (from < 0 || from >= L.length || to < 0 || to >= L.length || from === to) return;
    const [it] = L.splice(from, 1);
    L.splice(to, 0, it);
    changed();
  }
  function addToList(id) {
    const L = list();
    if (L.some(it => it.id === id)) { log('Already in "' + LISTS.active + '": ' + SK.get(id).title); return false; }
    L.push({ id, dur: S.defaultDur });
    changed();
    return true;
  }
  function pull(n, from) {
    const L = list(), have = new Set(L.map(it => it.id));
    const src = D.sketches.filter(s => !s.quarantine && !have.has(s.id) && (from !== 'starred' || stars.has(s.id)));
    const got = shuffle(src.map(s => s.id)).slice(0, n);
    for (const id of got) L.push({ id, dur: S.defaultDur });
    log('Pulled ' + got.length + ' random from ' + from + (got.length < n ? ' (only ' + got.length + ' left)' : ''));
    changed();
    return got;
  }
  function uniqueName(base) {
    let n = base, k = 2;
    while (LISTS.lists[n]) n = base + ' ' + k++;
    return n;
  }
  function switchList(name) {
    if (!LISTS.lists[name]) return;
    LISTS.active = name;
    PLAY.pos = 0; PLAY.bag = [];
    changed();
  }

  plList.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'), li = e.target.closest('li');
    if (!el || !li) return;
    const i = list().findIndex(it => it.id === li.dataset.id), act = el.dataset.act;
    if (act === 'play') { show(li.dataset.id) || log('Could not play ' + li.dataset.id, true); }
    else if (act === 'up') move(i, i - 1);
    else if (act === 'down') move(i, i + 1);
    else if (act === 'rm') { list().splice(i, 1); changed(); }
    else if (act === 'star') toggleStar(li.dataset.id);
    else if (act === 'cue') setCue(PLAY.cue === li.dataset.id ? null : li.dataset.id);
    else if (act === 'ban') setBan(li.dataset.id, !banned.has(li.dataset.id));
  });
  plList.addEventListener('change', e => {
    if (e.target.dataset.act !== 'dur') return;
    const it = list().find(x => x.id === e.target.closest('li').dataset.id);
    // save without re-rendering: the input may be mid-blur
    if (it) { it.dur = clamp(e.target.value, 1, 3600, it.dur); e.target.value = String(it.dur); saveLists(); renderClock(); }
  });

  // drag to reorder, from the handle
  let dragId = null;
  plList.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li && e.target.closest('.h')) li.draggable = true; });
  plList.addEventListener('mouseup', e => { const li = e.target.closest('li'); if (li && !dragId) li.draggable = false; });
  plList.addEventListener('dragstart', e => {
    const li = e.target.closest('li');
    if (!li || !li.draggable) { e.preventDefault(); return; }
    dragId = li.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    li.classList.add('dragging');
  });
  const clearOver = () => { for (const li of plList.children) li.classList.remove('over-top', 'over-bot'); };
  plList.addEventListener('dragover', e => {
    const li = e.target.closest('li');
    if (!dragId || !li) return;
    e.preventDefault();
    const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    clearOver();
    li.classList.add(after ? 'over-bot' : 'over-top');
  });
  plList.addEventListener('drop', e => {
    const li = e.target.closest('li');
    if (!dragId || !li) return;
    e.preventDefault();
    const L = list(), from = L.findIndex(it => it.id === dragId);
    const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    let to = L.findIndex(it => it.id === li.dataset.id) + (after ? 1 : 0);
    if (from < to) to--;
    dragId = null;
    move(from, to);
  });
  plList.addEventListener('dragend', () => {
    dragId = null;
    clearOver();
    for (const li of plList.children) { li.draggable = false; li.classList.remove('dragging'); }
  });

  $('#pl-sel').addEventListener('change', e => { switchList(e.target.value); e.target.blur(); });
  $('#pl-new').addEventListener('click', () => {
    const n = (prompt('Name for the new playlist', uniqueName('Playlist')) || '').trim().slice(0, 40);
    if (!n) return;
    const name = uniqueName(n);
    LISTS.lists[name] = [];
    switchList(name);
  });
  $('#pl-ren').addEventListener('click', () => {
    const n = (prompt('Rename playlist', LISTS.active) || '').trim().slice(0, 40);
    if (!n || n === LISTS.active) return;
    const name = uniqueName(n), lists = {};
    for (const [k, v] of Object.entries(LISTS.lists)) lists[k === LISTS.active ? name : k] = v;
    LISTS.lists = lists; LISTS.active = name;
    changed();
  });
  $('#pl-del').addEventListener('click', () => {
    if (!confirm('Delete playlist "' + LISTS.active + '"?')) return;
    delete LISTS.lists[LISTS.active];
    if (!Object.keys(LISTS.lists).length) LISTS.lists.Playlist = [];
    switchList(Object.keys(LISTS.lists)[0]);
  });
  $('#pull').addEventListener('click', () => {
    S.pullN = clamp($('#pull-n').value, 1, 58, 5); S.pullFrom = $('#pull-from').value; saveSettings();
    pull(S.pullN, S.pullFrom);
  });
  $('#pl-shuf').addEventListener('click', () => { shuffle(list()); changed(); });
  $('#pl-clear').addEventListener('click', () => {
    if (!list().length || !confirm('Clear all items from "' + LISTS.active + '"?')) return;
    list().length = 0;
    changed();
  });
  $('#def-dur').addEventListener('change', e => { S.defaultDur = clamp(e.target.value, 1, 3600, S.defaultDur); e.target.value = String(S.defaultDur); saveSettings(); });
  $('#pl-apply').addEventListener('click', () => {
    S.defaultDur = clamp($('#def-dur').value, 1, 3600, S.defaultDur); saveSettings();
    for (const it of list()) it.dur = S.defaultDur;
    changed();
  });

  // export / import: every playlist of this instance
  function exportData() {
    return { format: 'posthuman-vj-playlists', version: 1, instance: INST, active: LISTS.active, lists: LISTS.lists };
  }
  function importData(v) {
    if (!v || v.format !== 'posthuman-vj-playlists') throw new Error('not a POST/HUMAN · VJ playlist file');
    const got = cleanLists(v);
    if (!got) throw new Error('no playlists in file');
    Object.assign(LISTS.lists, got.lists);
    switchList(got.active);
    log('Imported ' + Object.keys(got.lists).length + ' playlist(s)');
  }
  $('#pl-exp').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'posthuman-vj-' + INST + '-playlists.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#pl-imp').addEventListener('click', () => $('#pl-file').click());
  $('#pl-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { importData(JSON.parse(await f.text())); } catch (err) { log('Import failed: ' + err.message, true); }
  });

  // share: the active playlist in the URL hash
  const b64u = str => { let s = ''; for (const b of new TextEncoder().encode(str)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return new TextDecoder().decode(Uint8Array.from(atob(s), ch => ch.charCodeAt(0))); };
  function shareLink() {
    const payload = { v: 1, n: LISTS.active, items: list().map(it => [it.id, it.dur]) };
    return location.origin + location.pathname + '#pl=' + b64u(JSON.stringify(payload));
  }
  function openShared(hash) {
    const m = /^#pl=([A-Za-z0-9_-]+)$/.exec(hash || '');
    if (!m) return false;
    try {
      const p = JSON.parse(unb64u(m[1]));
      const items = cleanList((p.items || []).map(([id, dur]) => ({ id, dur })));
      const base = String(p.n || 'Shared').trim().slice(0, 32) || 'Shared';
      const same = LISTS.lists[base] && JSON.stringify(LISTS.lists[base]) === JSON.stringify(items);
      const name = same ? base : uniqueName(LISTS.lists[base] ? base + ' (shared)' : base);
      LISTS.lists[name] = items;
      switchList(name);
      log('Opened shared playlist "' + name + '" (' + items.length + ' items)');
    } catch (e) { log('Share link could not be read', true); }
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }
  $('#pl-share').addEventListener('click', () => {
    const out = $('#share-out'), url = shareLink();
    out.value = url; out.hidden = false; out.select();
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => log('Share link copied'), () => log('Share link ready to copy'));
  });

  // ---- UI: gallery ------------------------------------------------------------------------------

  const grid = $('#g-grid');
  function markInList(card) {
    const b = card.querySelector('[data-act="add"]');
    const inList = list().some(it => it.id === card.dataset.id);
    b.textContent = inList ? 'Added' : 'Add';
    b.disabled = inList;
  }
  function editLink(sk) { return 'https://hydra.ojack.xyz/?code=' + encodeURIComponent(sk.hydraCode); }
  function renderGallery() {
    const q = $('#g-q').value.trim().toLowerCase(), onlyStar = $('#g-star').checked;
    const shown = D.sketches.filter(s => (!onlyStar || stars.has(s.id)) &&
      (!q || s.title.toLowerCase().includes(q) || s.author.toLowerCase().includes(q)));
    grid.replaceChildren(...shown.map(s => {
      const img = h('img', { src: s.thumb, alt: s.title, loading: 'lazy', width: 320, height: 180 });
      img.addEventListener('error', () => { img.removeAttribute('src'); }, { once: true });
      const card = h('div', { class: 'cardg' + (s.id === RT.cur ? ' cur' : ''), 'data-id': s.id },
        img,
        h('div', { class: 'meta' }, h('b', { text: s.title }), h('span', { text: s.author })),
        s.quarantine ? h('div', { class: 'qb', text: 'Quarantined: ' + s.quarantine }) : null,
        banned.has(s.id) ? h('div', { class: 'qb ban', text: 'Banned on this instance' }) : null,
        h('div', { class: 'acts' },
          h('button', { class: 'star', 'data-act': 'star', title: 'Star', 'aria-pressed': String(stars.has(s.id)), text: stars.has(s.id) ? '★' : '☆' }),
          h('button', { 'data-act': 'add', text: 'Add' }),
          h('button', { 'data-act': 'play', text: 'Play' }),
          h('a', { href: editLink(s), target: '_blank', rel: 'noopener', text: 'Edit in Hydra' })));
      markInList(card);
      return card;
    }));
    $('#g-n').textContent = shown.length + ' / ' + D.sketches.length;
  }
  grid.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'), card = e.target.closest('.cardg');
    if (!el || !card) return;
    const id = card.dataset.id;
    if (el.dataset.act === 'star') toggleStar(id);
    else if (el.dataset.act === 'add') addToList(id);
    else if (el.dataset.act === 'play') { show(id) || log('Could not play ' + id, true); }
  });
  // one star set per instance: gallery cards, playlist rows and the menu bar all show it
  function toggleStar(id) {
    if (!SK.has(id)) return;
    if (stars.has(id)) stars.delete(id); else stars.add(id);
    saveStars();
    renderPlaylist();
    if ($('#g-star').checked) renderGallery();
    else for (const b of grid.querySelectorAll('.cardg[data-id="' + id + '"] .star')) { press(b, stars.has(id)); b.textContent = stars.has(id) ? '★' : '☆'; }
    renderStar();
  }
  function renderStar() {
    const b = btn('star'), on = !!RT.cur && stars.has(RT.cur);
    press(b, on); b.textContent = on ? '★' : '☆'; b.disabled = !RT.cur;
  }
  btn('star').addEventListener('click', () => RT.cur && toggleStar(RT.cur));
  $('#pl-fromstar').addEventListener('click', () => {
    const ids = D.sketches.filter(s => stars.has(s.id) && !s.quarantine).map(s => s.id);
    if (!ids.length) { log('No starred sketches yet', true); return; }
    LISTS.lists.Starred = ids.map(id => ({ id, dur: S.defaultDur }));
    switchList('Starred');
    log('Playlist "Starred" made from ' + ids.length + ' starred sketches');
  });
  $('#g-q').addEventListener('input', renderGallery);
  $('#g-star').addEventListener('change', renderGallery);

  function renderCredits() {
    $('#cr-table tbody').replaceChildren(...D.sketches.map(s => h('tr', {},
      h('td', { text: s.title }),
      h('td', {}, s.href ? h('a', { href: s.href, target: '_blank', rel: 'noopener', text: s.author }) : s.author,
        s.link && !s.href ? h('span', { class: 'dim', text: ' ' + s.link }) : null),
      h('td', { text: LICENSE }))));
  }

  // ---- output window: ?i=<name>&out=1, synced over BroadcastChannel -------------------------------
  // The controller owns the clock and the playlist; it sends what to show. The output window renders
  // the same sketch on its own two decks, says hello once a second and reports failures back.

  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('phvj:' + INST) : null;
  function post(m) { if (chan && !OUT) try { chan.postMessage(m); } catch (e) { /* closed */ } }
  function postState() { post({ t: 'state', black: S.black, code: RT.code, level: RT.level }); }
  const outLive = () => !OUT && performance.now() - RT.outSeen < 3000;
  const previewResting = () => outLive() && !S.outPreview;
  if (chan) chan.onmessage = ({ data: m }) => {
    if (!m || typeof m !== 'object') return;
    if (OUT) {
      if (m.t === 'show' || m.t === 'sync') {
        if (m.t === 'show' || m.id !== RT.cur) {
          if (m.t === 'show') { S.transition = m.cut ? 'cut' : 'xfade'; S.xfadeSec = clamp(m.xfadeSec, 0.2, 10, 2); }
          if (m.id && SK.has(m.id)) show(m.id, { cut: m.t === 'sync' || m.cut });
        }
      }
      if (m.t === 'state' || m.t === 'sync') {
        S.black = !!m.black; RT.code = !!m.code;
        if (LEVEL[m.level] && m.level !== RT.level) { RT.level = m.level; applyQuality(); }
        renderBar();
      }
      if (m.t === 'fx') applyFx(m.A, m.fx || S.au);
      if (m.t === 'knobs' && m.slot) PHK[m.slot] = m.vals;
      if (m.t === 'run' && m.id === RT.cur && typeof m.code === 'string') {
        if (m.slot) PHK[m.slot] = m.vals;
        const err = evalLive(m.code);
        if (err) restoreGood(); else ED.goodEval = m.code;
      }
      return;
    }
    if (m.t === 'hello') {
      const fresh = !outLive() || m.first; // m.first: a new or reloaded output window
      RT.outSeen = performance.now();
      if (fresh) {
        log('Output window connected');
        post({ t: 'sync', id: RT.cur, black: S.black, code: RT.code, level: RT.level });
        if (ED.liveCode) post({ t: 'run', id: RT.cur, code: ED.liveCode, slot: ED.active ? ED.slot : 0, vals: PHK[ED.slot] });
      }
    } else if (m.t === 'failed' && SK.has(m.id) && !RT.failed.has(m.id)) {
      RT.failed.add(m.id);
      RT.skips++;
      log('Output window skipped "' + SK.get(m.id).title + '" (' + m.id + '): ' + m.reason, true);
      if (RT.cur === m.id) advance(1, { cut: true });
    }
  };
  if (OUT) {
    body.classList.add('out');
    document.title = 'POST/HUMAN · VJ output · ' + INST;
    const hello = first => chan && chan.postMessage({ t: 'hello', first: !!first });
    hello(true);
    setInterval(() => hello(false), 1000);
    document.addEventListener('dblclick', toggleFull);
  }
  $('#out-open').addEventListener('click', () => {
    const w = window.open(location.pathname + '?i=' + encodeURIComponent(INST) + '&out=1', 'phvj-out-' + INST, 'popup,width=960,height=560');
    if (!w) log('The browser blocked the output window. Allow pop-ups for this page.', true);
  });
  $('#out-prev').addEventListener('change', e => { S.outPreview = e.target.checked; saveSettings(); });

  // ---- hold, cue, ban ------------------------------------------------------------------------------

  function setHold(on) { PLAY.hold = !!on; savePlay(); renderBar(); }
  function setCue(id) {
    PLAY.cue = id && SK.has(id) ? id : null;
    if (PLAY.cue) log('Cued next: ' + SK.get(PLAY.cue).title);
    savePlay(); renderPlaylist(); renderBar();
  }
  function setBan(id, on) {
    if (!SK.has(id)) return;
    if (on) banned.add(id); else banned.delete(id);
    saveBanned();
    log((on ? 'Banned ' : 'Unbanned ') + SK.get(id).title);
    if (PLAY.cue === id && on) PLAY.cue = null;
    renderPlaylist();
    if ($('#g-grid').children.length) renderGallery();
    if (on && RT.cur === id) advance(1);
  }
  btn('hold').addEventListener('click', () => setHold(!PLAY.hold));
  btn('ban').addEventListener('click', () => RT.cur && setBan(RT.cur, true));
  btn('unban').addEventListener('click', () => { banned.clear(); saveBanned(); log('Unbanned all'); renderPlaylist(); if ($('#g-grid').children.length) renderGallery(); });

  // ---- tempo: tap, or type a BPM; switch every N bars ------------------------------------------------

  const taps = [];
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const span = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      S.bpm = clamp(Math.round(600000 / span) / 10, 40, 240, S.bpm);
      saveSettings();
    }
    // four taps on the one: the next switch lands on a bar line
    if (taps.length >= 4 && S.bars) RT.elapsed = 0;
    renderBar();
  }
  btn('tap').addEventListener('click', tap);
  $('#n-bpm').addEventListener('change', e => { S.bpm = clamp(e.target.value, 40, 240, S.bpm); saveSettings(); renderBar(); });
  $('#s-bars').addEventListener('change', e => { S.bars = Number(e.target.value) || 0; saveSettings(); renderBar(); e.target.blur(); });

  // ---- audio: five bands, each through its own filters into an analyser ------------------------------
  // Levels are 0..1 in window.A (A.full, A.low, A.mid, A.high, A.custom) so edited code can use them.
  // Effects stay after the sketch: a zoom pump and a brightness flash on the deck wrapper, each driven
  // by the band you pick. The output window gets the levels from the controller.

  const A = window.A = { full: 0, low: 0, mid: 0, high: 0, custom: 0 };
  const AU = { ctx: null, stream: null, src: null, bands: {}, buf: null };
  const decksEl = $('#decks');
  function applyFx(levels, fx = S.au) {
    for (const b of BANDS) A[b] = clamp(levels && levels[b], 0, 1, 0);
    const z = fx.zoomSrc === 'off' ? 0 : A[fx.zoomSrc] || 0, f = fx.flashSrc === 'off' ? 0 : A[fx.flashSrc] || 0;
    const zoom = clamp(fx.zoom, 0, 0.3, 0), flash = clamp(fx.flash, 0, 1.5, 0);
    RT.fx = Math.max(z, f);
    decksEl.style.transform = z * zoom > 0.0005 ? 'scale(' + (1 + z * zoom).toFixed(4) + ')' : '';
    decksEl.style.filter = f * flash > 0.001 ? 'brightness(' + (1 + f * flash).toFixed(3) + ')' : '';
    if (!OUT) for (const b of BANDS) { const m = document.getElementById('au-m-' + b); if (m) m.style.width = (A[b] * 100).toFixed(1) + '%'; }
  }
  function buildBand(b) {
    const ctx = AU.ctx, an = ctx.createAnalyser();
    an.fftSize = 1024;
    let node = AU.src;
    const filters = bandFilters(b, S.au.lo, S.au.hi).map(([type, f]) => {
      const n = ctx.createBiquadFilter();
      n.type = type; n.frequency.value = f; n.Q.value = 0.707;
      node.connect(n); node = n;
      return n;
    });
    node.connect(an);
    AU.bands[b] = { an, filters, v: 0 };
  }
  function setCustom() {
    const c = AU.bands.custom;
    if (!c) return;
    c.filters[0].frequency.value = S.au.lo;
    c.filters[1].frequency.value = S.au.hi;
  }
  async function listInputs() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      const sel = $('#au-dev');
      sel.replaceChildren(h('option', { value: '', text: 'Default input' }),
        ...devs.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => h('option', { value: d.deviceId, text: d.label || 'Input ' + (i + 1) })));
      sel.value = [...sel.options].some(o => o.value === S.au.dev) ? S.au.dev : '';
    } catch (e) { /* no media devices */ }
  }
  const fxSettings = () => ({ zoomSrc: S.au.zoomSrc, zoom: S.au.zoom, flashSrc: S.au.flashSrc, flash: S.au.flash });
  function audioStop() {
    if (AU.stream) for (const t of AU.stream.getTracks()) t.stop();
    if (AU.ctx) AU.ctx.close().catch(() => {});
    AU.ctx = AU.stream = AU.src = null;
    AU.bands = {};
    applyFx(null);
    post({ t: 'fx', A: { ...A }, fx: fxSettings() });
  }
  async function audioStart() {
    audioStop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { log('Audio input is not available here (needs https or localhost)', true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: S.au.dev ? { exact: S.au.dev } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!S.au.on) { for (const t of stream.getTracks()) t.stop(); return; }
      AU.ctx = new AudioContext();
      AU.stream = stream;
      AU.src = AU.ctx.createMediaStreamSource(stream);
      for (const b of BANDS) buildBand(b);
      AU.buf = new Float32Array(1024);
      if (AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {});
      log('Audio on: ' + (stream.getAudioTracks()[0] || {}).label);
      listInputs();
    } catch (e) {
      log('Audio input failed: ' + (e.message || e.name), true);
      S.au.on = false; saveSettings(); renderBar();
    }
  }
  // per band: RMS x sensitivity, gated by the threshold, attack at once, release by the smoothing
  function audioFrame() {
    if (!AU.ctx) return;
    const lv = {};
    for (const b of BANDS) {
      const x = AU.bands[b], p = S.au.bands[b];
      x.an.getFloatTimeDomainData(AU.buf);
      let sum = 0;
      for (let i = 0; i < AU.buf.length; i++) sum += AU.buf[i] * AU.buf[i];
      const raw = Math.min(1, Math.sqrt(sum / AU.buf.length) * p.sens);
      const gated = raw <= p.thr ? 0 : (raw - p.thr) / (1 - p.thr);
      x.v = Math.max(gated, x.v * p.smooth);
      lv[b] = x.v;
    }
    applyFx(lv);
    if (outLive()) post({ t: 'fx', A: lv, fx: fxSettings() });
  }

  // band rows: name, live meter, sensitivity, smoothing, threshold
  function slider(min, max, step, value, on) {
    const el = h('input', { type: 'range', min, max, step, value: String(value) });
    el.addEventListener('input', () => on(Number(el.value)));
    el.addEventListener('change', () => { saveSettings(); el.blur(); });
    return el;
  }
  $('#au-bands').replaceChildren(...BANDS.map(b => h('div', { class: 'band', 'data-band': b },
    h('b', { text: BAND_LABEL[b] }),
    h('div', { class: 'meter', title: 'Filtered level' }, h('div', { id: 'au-m-' + b })),
    h('label', {}, 'Sens', slider(0.5, 40, 0.5, S.au.bands[b].sens, v => { S.au.bands[b].sens = v; })),
    h('label', {}, 'Smooth', slider(0, 0.97, 0.01, S.au.bands[b].smooth, v => { S.au.bands[b].smooth = v; })),
    h('label', {}, 'Threshold', slider(0, 0.9, 0.01, S.au.bands[b].thr, v => { S.au.bands[b].thr = v; })))));
  for (const sel of [$('#au-zsrc'), $('#au-fsrc')]) sel.replaceChildren(h('option', { value: 'off', text: 'Off' }), ...BANDS.map(b => h('option', { value: b, text: BAND_LABEL[b] })));

  $('#au-on').addEventListener('change', e => { S.au.on = e.target.checked; saveSettings(); if (S.au.on) audioStart(); else { audioStop(); log('Audio off'); } });
  $('#au-dev').addEventListener('change', e => { S.au.dev = e.target.value; saveSettings(); if (S.au.on) audioStart(); e.target.blur(); });
  $('#au-zsrc').addEventListener('change', e => { S.au.zoomSrc = e.target.value; saveSettings(); e.target.blur(); });
  $('#au-fsrc').addEventListener('change', e => { S.au.flashSrc = e.target.value; saveSettings(); e.target.blur(); });
  for (const k of ['zoom', 'flash']) {
    const el = $('#au-' + k);
    el.addEventListener('input', () => { S.au[k] = Number(el.value); });
    el.addEventListener('change', () => { saveSettings(); el.blur(); });
  }
  function setRange(lo, hi) {
    S.au.lo = clamp(lo, 20, 18000, S.au.lo);
    S.au.hi = clamp(hi, S.au.lo + 10, 20000, S.au.lo + 10);
    saveSettings(); setCustom(); renderBar();
  }
  $('#au-lo').addEventListener('change', () => setRange($('#au-lo').value, $('#au-hi').value));
  $('#au-hi').addEventListener('change', () => setRange($('#au-lo').value, $('#au-hi').value));
  for (const b of document.querySelectorAll('[data-hz]')) b.addEventListener('click', () => { const [lo, hi] = b.dataset.hz.split('-').map(Number); setRange(lo, hi); });

  // ---- live edit: code panel, run without a time reset, revert, variants, knobs ----------------------
  // Controller only. Run evals on the deck that is on screen with no hush and no time reset, so the
  // visual keeps flowing; a failed edit leaves the last good code running. Knobs turn the numeric
  // literals that are direct float arguments of hydra functions into getters, ()=>PHK[slot][i], so a
  // slider changes a uniform without another eval.

  const PHK = window.PHK = {};
  const ED = { id: null, orig: '', text: '', good: '', goodEval: '', shown: '', knobs: [], links: [], slot: 0, active: false, liveCode: '' };
  const edText = $('#ed-text'), edGut = $('#ed-gutter'), edErr = $('#ed-err');
  let slotSeq = 0;

  // numeric literals that are whole float arguments of a hydra function call
  function parseKnobs(code) {
    const T = RT.decks[0].hy.generator.glslTransforms;
    const out = [], stack = [];
    const n = code.length;
    let i = 0, prev = '', prevIdent = '', prevIdentDotted = false, prevIdentEnd = -1;
    const isId = c => /[A-Za-z0-9_$]/.test(c);
    const back = j => { while (j >= 0 && /\s/.test(code[j])) j--; return j; };
    const fwd = j => { while (j < n && /\s/.test(code[j])) j++; return j; };
    while (i < n) {
      const c = code[i];
      if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
      if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        i++;
        while (i < n && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
        i++; prev = 'str'; continue;
      }
      if (/\s/.test(c)) { i++; continue; }
      if (/[A-Za-z_$]/.test(c)) {
        const s = i;
        while (i < n && isId(code[i])) i++;
        prevIdent = code.slice(s, i); prevIdentEnd = i;
        const d = back(s - 1);
        // callee rule: not a property of something else (Math.sin), unless chained on a call result
        prevIdentDotted = d >= 0 && code[d] === '.' && code[back(d - 1)] !== ')';
        prev = 'id'; continue;
      }
      const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(code.slice(i, i + 32));
      if (num && !(prev === 'id' && prevIdentEnd === i)) {
        const s = i, e = i + num[0].length;
        let start = s;
        let b = back(s - 1);
        if (b >= 0 && code[b] === '-') { const bb = back(b - 1); if (bb >= 0 && (code[bb] === '(' || code[bb] === ',')) { start = b; b = bb; } }
        const top = stack[stack.length - 1], after = code[fwd(e)];
        if (top && top.ch === '(' && top.fn && b >= 0 && (code[b] === '(' || code[b] === ',') && (after === ',' || after === ')')) {
          const inp = T[top.fn] && T[top.fn].inputs[top.arg];
          if (inp && inp.type === 'float') {
            out.push({ start, end: e, value: Number(code.slice(start, e).replace(/\s+/g, '')), fn: top.fn, name: inp.name, arg: top.arg });
          }
        }
        i = e; prev = 'num'; continue;
      }
      if (c === '(') {
        const callee = prev === 'id' && back(i - 1) === prevIdentEnd - 1 && !prevIdentDotted && T[prevIdent] ? prevIdent : null;
        stack.push({ ch: '(', fn: callee, arg: 0 });
      } else if (c === '[' || c === '{') stack.push({ ch: c });
      else if (c === ')' || c === ']' || c === '}') stack.pop();
      else if (c === ',' && stack.length) stack[stack.length - 1].arg = (stack[stack.length - 1].arg || 0) + 1;
      prev = c;
      i++;
    }
    return out;
  }
  const fmtNum = v => String(Math.round(v * 1000) / 1000);
  function spliceKnobs(code, knobs, rep) {
    let s = code;
    for (let k = knobs.length - 1; k >= 0; k--) s = s.slice(0, knobs[k].start) + rep(knobs[k], k) + s.slice(knobs[k].end);
    return s;
  }

  function knobRange(v) {
    let min = v < 0 ? 4 * v : 0, max = v > 0 ? 4 * v : 0;
    if (max - min < 1) max = min + 1;
    return { min, max };
  }
  function setKnobs(code, keepLinks) {
    const old = ED.links;
    ED.knobs = parseKnobs(code);
    ED.links = ED.knobs.map((kn, k) => {
      const r = knobRange(kn.value), o = keepLinks && old[k] && old[k].fn === kn.fn ? old[k] : null;
      return { fn: kn.fn, v: kn.value, min: o ? Math.min(o.min, kn.value) : r.min, max: o ? Math.max(o.max, kn.value) : r.max, band: o ? o.band : 'none', depth: o ? o.depth : 0.5 };
    });
    ED.active = false;
    renderKnobs();
  }
  const knobVal = l => l.v + (l.band !== 'none' ? l.depth * (A[l.band] || 0) * (l.max - l.min) : 0);

  function edLoad(id) {
    const sk = SK.get(id);
    ED.id = id;
    ED.orig = ED.text = ED.good = ED.goodEval = sk ? sk.code : '';
    ED.liveCode = '';
    edText.value = ED.shown = ED.text;
    $('#ed-title').textContent = sk ? sk.title + ' · ' + sk.author : 'Nothing on screen';
    edError('');
    setKnobs(ED.text, false);
    gutter();
  }
  function gutter() {
    const lines = edText.value.split('\n').length;
    let s = '';
    for (let k = 1; k <= lines; k++) s += k + '\n';
    edGut.textContent = s;
    edGut.scrollTop = edText.scrollTop;
  }
  function edError(msg) { edErr.textContent = msg; edErr.hidden = !msg; }

  // eval on the deck that is on screen: no hush, no time reset
  function evalLive(code) {
    finishFade();
    const d = curDeck();
    if (!d || !d.id) return new Error('nothing on screen');
    d.tickErr = '';
    RT.evals++;
    try {
      new Function('h', 'with(h){' + code + '\n}')(d.hy.synth);
      tickSafe(d, 0);
      d.edited = true;
      return null;
    } catch (e) { return e; }
  }
  function restoreGood() {
    const d = curDeck();
    if (d) d.tickErr = '';
    const e = evalLive(ED.goodEval);
    if (e && d) { d.edited = false; failDeck(d, 'edited code failed and the last good version did not recover: ' + (e.message || e)); }
  }
  // a runtime error from an edited deck (seen while ticking): show it, put the last good code back
  function edRecover(d, msg) {
    edError('Runtime error: ' + msg + '. Last good version restored.');
    restoreGood();
  }
  function edRun(text, opts = {}) {
    if (!RT.cur) return false;
    const err = evalLive(text);
    if (err) {
      edError((err.name === 'SyntaxError' ? 'Syntax error: ' : 'Error: ') + (err.message || err) + '. Last good version still playing.');
      restoreGood();
      return false;
    }
    edError('');
    ED.text = ED.good = ED.shown = text;
    ED.goodEval = text;
    ED.liveCode = text;
    setKnobs(text, opts.keepLinks);
    if (PLAY.playing && !PLAY.hold) { setHold(true); log('Hold on while editing (G to release)'); }
    post({ t: 'run', id: RT.cur, code: text });
    return true;
  }
  // first slider move: swap in the getter version, same look, no time reset
  function activateKnobs() {
    if (ED.active || !ED.knobs.length) return ED.active;
    const slot = ++slotSeq;
    PHK[slot] = ED.links.map(knobVal);
    const code = spliceKnobs(ED.good, ED.knobs, (kn, k) => '()=>PHK[' + slot + '][' + k + ']');
    const err = evalLive(code);
    if (err) { edError('Knobs could not attach: ' + (err.message || err)); restoreGood(); return false; }
    delete PHK[slot - 4]; // a fading deck may still read the previous slots
    ED.slot = slot; ED.active = true; ED.goodEval = code; ED.liveCode = code;
    post({ t: 'run', id: RT.cur, code, slot, vals: PHK[slot] });
    return true;
  }
  // the text shows the slider values as plain literals
  function knobsToText() {
    const text = spliceKnobs(ED.good, ED.knobs, (kn, k) => fmtNum(ED.links[k].v));
    ED.good = text;
    ED.knobs = parseKnobs(text);
    // only when the box holds what was last run (no unsaved typing to lose)
    if (edText.value === ED.shown) { const st = edText.scrollTop; edText.value = ED.shown = text; edText.scrollTop = st; gutter(); }
  }
  let knobSent = 0;
  function knobFrame(now) {
    if (!ED.active || !PHK[ED.slot]) return;
    const vals = PHK[ED.slot];
    let changed = false;
    ED.links.forEach((l, k) => { const v = knobVal(l); if (v !== vals[k]) { vals[k] = v; changed = true; } });
    if (changed && outLive() && now - knobSent > 30) { knobSent = now; post({ t: 'knobs', slot: ED.slot, vals }); }
  }

  function renderKnobs() {
    const box = $('#knobs');
    if (!ED.knobs.length) { box.replaceChildren(h('p', { class: 'dim', text: 'No knobs: no plain numbers as hydra function arguments.' })); return; }
    const bandOpts = ['none', ...BANDS];
    box.replaceChildren(...ED.knobs.map((kn, k) => {
      const l = ED.links[k];
      const range = h('input', { type: 'range', min: l.min, max: l.max, step: 'any', value: l.v });
      const num = h('input', { type: 'number', step: 'any', value: fmtNum(l.v), title: 'Value' });
      const lo = h('input', { type: 'number', step: 'any', value: fmtNum(l.min), title: 'Range min' });
      const hi = h('input', { type: 'number', step: 'any', value: fmtNum(l.max), title: 'Range max' });
      const band = h('select', { title: 'Audio link' }, ...bandOpts.map(b => h('option', { value: b, text: b === 'none' ? 'No audio' : BAND_LABEL[b] })));
      band.value = l.band;
      const depth = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: l.depth, title: 'Audio depth' });
      const set = v => {
        if (!activateKnobs()) return;
        l.v = v; num.value = fmtNum(v); range.value = String(v);
        knobsToText();
      };
      range.addEventListener('input', () => set(Number(range.value)));
      num.addEventListener('change', () => { const v = Number(num.value); if (Number.isFinite(v)) { if (v < l.min) { l.min = v; range.min = v; lo.value = fmtNum(v); } if (v > l.max) { l.max = v; range.max = v; hi.value = fmtNum(v); } set(v); } });
      const setRange = () => {
        const a = Number(lo.value), b = Number(hi.value);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) { l.min = a; l.max = b; range.min = a; range.max = b; }
      };
      lo.addEventListener('change', setRange); hi.addEventListener('change', setRange);
      band.addEventListener('change', () => { if (activateKnobs()) l.band = band.value; else band.value = 'none'; band.blur(); });
      depth.addEventListener('input', () => { l.depth = Number(depth.value); });
      return h('div', { class: 'knob', 'data-k': k },
        h('span', { class: 'kl', text: kn.fn + ' · ' + kn.name }), range, num,
        h('div', { class: 'kx' }, h('span', { text: 'range' }), lo, hi, band, depth));
    }));
  }

  // variants: edited code saved in this instance, credited to the original
  function addVariantToPool(v) {
    const base = SK.get(v.base);
    const sk = {
      id: v.id, title: v.title, author: 'edited from ' + base.title + ' by ' + base.author, link: base.link, href: base.href,
      code: v.code, hydraCode: btoa(encodeURIComponent(v.code)), thumb: base.thumb, quarantine: '', variant: v.base,
    };
    SK.set(v.id, sk);
    D.sketches.push(sk);
  }
  function saveVariant() {
    if (!ED.id) return null;
    const cur = SK.get(ED.id), base = cur.variant ? SK.get(cur.variant) : cur;
    const v = { id: 'v_' + base.id + '_' + Date.now().toString(36), base: base.id, title: base.title + ' (edit)', code: ED.good };
    VARIANTS.push(v);
    save('variants', VARIANTS);
    addVariantToPool(v);
    if ($('#g-grid').children.length) renderGallery();
    renderCredits();
    log('Saved variant "' + v.title + '" (' + v.id + ')');
    return v.id;
  }

  edText.addEventListener('input', gutter);
  edText.addEventListener('scroll', () => { edGut.scrollTop = edText.scrollTop; });
  edText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); edRun(edText.value, { keepLinks: true }); }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); edText.setRangeText('  ', edText.selectionStart, edText.selectionEnd, 'end'); gutter(); }
  });
  $('#ed-run').addEventListener('click', () => edRun(edText.value, { keepLinks: true }));
  $('#ed-revert').addEventListener('click', () => { edText.value = ED.orig; gutter(); edRun(ED.orig); });
  $('#ed-bake').addEventListener('click', () => { if (ED.active) { edText.value = ED.good; edRun(ED.good); log('Knob values baked into the code'); } });
  $('#ed-save').addEventListener('click', () => { if (!edRun(edText.value, { keepLinks: true })) return; saveVariant(); });
  $('#ed-hydra').addEventListener('click', () => {
    window.open('https://hydra.ojack.xyz/?code=' + encodeURIComponent(btoa(encodeURIComponent(edText.value))), '_blank', 'noopener');
  });

  // ---- bar controls and keys ----------------------------------------------------------------------

  btn('play').addEventListener('click', () => setPlaying(!PLAY.playing));
  btn('next').addEventListener('click', next);
  btn('prev').addEventListener('click', prev);
  btn('rand').addEventListener('click', () => toggleRandom());
  btn('code').addEventListener('click', () => setCode(!RT.code));
  btn('cred').addEventListener('click', () => { S.credits = !S.credits; saveSettings(); renderBar(); });
  btn('clean').addEventListener('click', () => setClean(!S.clean));
  btn('black').addEventListener('click', () => setBlack(!S.black));
  btn('full').addEventListener('click', toggleFull);
  btn('hide').addEventListener('click', () => setMenuHidden(true));
  btn('help').addEventListener('click', () => { $('#help').hidden = !$('#help').hidden; });
  $('#help-x').addEventListener('click', () => { $('#help').hidden = true; });
  $('#peek').addEventListener('click', () => setMenuHidden(false));
  $('#s-scope').addEventListener('change', e => { S.scope = e.target.value; PLAY.bag = []; saveSettings(); e.target.blur(); });
  $('#s-trans').addEventListener('change', e => { S.transition = e.target.value; saveSettings(); renderBar(); e.target.blur(); });
  $('#n-xfade').addEventListener('change', e => { S.xfadeSec = clamp(e.target.value, 0.2, 10, S.xfadeSec); saveSettings(); renderBar(); });
  // Enter in a number field commits it and hands the keys back to the shortcuts
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input[type=number]')) e.target.blur(); });
  $('#s-q').addEventListener('change', e => {
    S.quality = RT.level = e.target.value; saveSettings();
    log('Quality set to ' + RT.level);
    applyQuality(); e.target.blur();
  });
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('#log-clear').addEventListener('click', () => { logEl.replaceChildren(); unseen = 0; logN.hidden = true; });

  function toggleRandom() {
    S.random = !S.random; PLAY.bag = []; saveSettings(); renderBar();
    log('Random mode ' + (S.random ? 'on' : 'off'));
  }

  const typing = t => t && t.matches && t.matches('input:not([type=checkbox]), select, textarea');
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target) && e.key !== 'Escape') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (OUT) { if (k === 'f') { e.preventDefault(); toggleFull(); } return; } // the controller drives the rest
    const acts = {
      t: tap,
      s: () => RT.cur && toggleStar(RT.cur),
      g: () => setHold(!PLAY.hold),
      x: () => RT.cur && setBan(RT.cur, true),
      ' ': () => setPlaying(!PLAY.playing),
      ArrowRight: next,
      ArrowLeft: prev,
      f: toggleFull,
      h: () => (S.clean ? (setClean(false), setMenuHidden(false)) : setMenuHidden(!S.menuHidden)),
      c: () => setCode(!RT.code),
      b: () => setBlack(!S.black),
      r: toggleRandom,
      '?': () => { $('#help').hidden = !$('#help').hidden; },
      Escape: () => {
        if (!$('#help').hidden) $('#help').hidden = true;
        else if (RT.fs && !document.fullscreenElement) setFs(false);
        else if (S.clean) setClean(false);
        if (typing(e.target)) e.target.blur();
      },
    };
    if (!acts[k]) return;
    e.preventDefault();
    if (e.repeat && k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 't') return;
    acts[k]();
  });
  // a focused button must not also fire on Space
  document.addEventListener('keyup', e => { if (e.key === ' ' && !typing(e.target)) e.preventDefault(); });

  // ---- boot -----------------------------------------------------------------------------------------

  const gpu = gpuName();
  $('#gpu').textContent = 'GPU: ' + gpu;
  RT.decks = [mkDeck($('#deck-a')), mkDeck($('#deck-b'))];
  openShared(location.hash);
  window.addEventListener('hashchange', () => { if (openShared(location.hash)) renderPlaylist(); });
  renderPlaylist();
  renderCredits();
  setTab(S.tab);
  renderBar();
  log('Ready. Instance "' + INST + '", ' + D.sketches.length + ' sketches, ' + D.sketches.filter(s => s.quarantine).length + ' quarantined. GPU: ' + gpu);

  // restore the sketch that was on, where it was; else the first playable item
  const restoreId = PLAY.id;
  if (restoreId && SK.has(restoreId) && !SK.get(restoreId).quarantine && !banned.has(restoreId) && show(restoreId, { cut: true, elapsed: PLAY.elapsed })) { /* restored */ }
  else advance(1, { cut: true, from: null });
  renderBar();
  requestAnimationFrame(frame);
  if (!OUT) { listInputs(); if (S.au.on) audioStart(); }

  // test and debug handle
  window.PHVJ = {
    get state() {
      return {
        inst: INST, cur: RT.cur, playing: PLAY.playing, elapsed: RT.elapsed, live: RT.live,
        fading: !!RT.fade, level: RT.level, fps: guard.fps, hydras: RT.hydras, errors: RT.errors,
        ctxLost: RT.ctxLost, skips: RT.skips, failed: [...RT.failed], ticks: ticks.slice(),
        deckIds: RT.decks.map(d => d.id), opacity: RT.decks.map(d => d.canvas.style.opacity),
        fs: RT.fs, code: RT.code, settings: { ...S }, active: LISTS.active,
        list: list().map(it => ({ ...it })), lists: Object.keys(LISTS.lists), stars: [...stars],
        out: OUT, outLive: outLive(), resting: previewResting(), hold: PLAY.hold, cue: PLAY.cue, banned: [...banned],
        time: curDeck() ? curDeck().hy.synth.time : 0, evals: RT.evals, edited: !!(curDeck() && curDeck().edited),
        knobs: ED.knobs.map((kn, k) => kn.fn + '.' + kn.name + '=' + ED.links[k].v), knobVals: (PHK[ED.slot] || []).slice(), edActive: ED.active,
        edErr: edErr.textContent, variants: VARIANTS.map(v => v.id),
        fx: RT.fx, audio: !!AU.ctx, A: { ...A }, dur: RT.cur ? durOf(RT.cur) : 0,
      };
    },
    next, prev, show, setPlaying, toggleRandom, shareLink, exportData, importData, setFs,
    addTestSketch(id, code) {
      SK.set(id, { id, title: 'Test ' + id, author: 'test', link: '', href: '', code, hydraCode: '', thumb: '', quarantine: '' });
    },
    addToList, pull, edRun, saveVariant, parseKnobs,
  };
})();
