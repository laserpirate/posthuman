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
  const KEY = k => 'phvj:' + INST + ':' + k;
  function load(k, fb) {
    try { const v = localStorage.getItem(KEY(k)); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
  }
  function save(k, v) {
    try { localStorage.setItem(KEY(k), JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
  }

  const DEF = {
    defaultDur: 30, transition: 'xfade', xfadeSec: 2, random: false, scope: 'playlist',
    quality: 'med', autoDrop: true, credits: true, clean: false, menuHidden: false, black: false,
    tab: 'playlist', pullN: 5, pullFrom: 'pool',
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
    if (!['playlist', 'gallery', 'credits', 'log'].includes(v.tab)) v.tab = DEF.tab;
    for (const k of ['random', 'autoDrop', 'credits', 'clean', 'menuHidden', 'black']) v[k] = !!v[k];
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

  const PLAY = (() => {
    const v = Object.assign({ id: null, pos: 0, elapsed: 0, playing: false, bag: [], hist: [] }, load('play', {}));
    if (!SK.has(v.id)) v.id = null;
    v.pos = clamp(v.pos, 0, 999, 0);
    v.elapsed = clamp(v.elapsed, 0, 3600e3, 0);
    v.playing = !!v.playing;
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
      hy.hush();
      s.speed = 1; s.bpm = 30; s.fps = undefined;
      if (!s.a || !s.a.fft) s.a = audioStub();
      hy.tick(16); hy.tick(16);
    } catch (e) { /* a broken previous sketch; the eval below decides */ }
    s.time = 0;
    d.tickErr = '';
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
    const old = RT.live >= 0 ? RT.decks[RT.live] : null;
    d.canvas.style.zIndex = '2';
    if (old) old.canvas.style.zIndex = '1';
    if (opts.cut || S.transition === 'cut' || !old) {
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
    advance(1, { cut: true, from: id });
  }

  // ---- what plays next ------------------------------------------------------------------------

  const playable = id => { const s = SK.get(id); return !!s && !s.quarantine && !RT.failed.has(id); };
  const durOf = id => { const it = list().find(x => x.id === id); return it ? it.dur : S.defaultDur; };
  const universe = () => (S.scope === 'pool' ? D.sketches.map(s => s.id) : list().map(it => it.id)).filter(playable);

  function pickNext(dir, from) {
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
    if (last && now - last < 1000 / cap - 4) return;
    const dt = last ? Math.min(now - last, 250) : 16;
    last = now;
    guard.frame(now);

    const f = RT.fade;
    if (f) {
      const k = (now - f.t0) / f.ms;
      if (k >= 1) finishFade();
      else RT.decks[f.to].canvas.style.opacity = k.toFixed(3);
    }
    // tick only what is on screen: the live deck, plus the incoming one during a fade
    for (let i = 0; i < 2; i++) {
      const d = RT.decks[i];
      if (!d.id || (i !== RT.live && !(RT.fade && RT.fade.to === i))) continue;
      try { tickSafe(d, dt); ticks[i]++; } catch (e) { failDeck(d, 'runtime error: ' + (e.message || e)); return; }
    }
    const d = curDeck();
    if (d && d.id && now - lastProbe > 1000) {
      lastProbe = now;
      let bad = '';
      try { bad = blankness(d.canvas); } catch (e) { /* readback unavailable */ }
      if (!bad) d.badSince = 0;
      else if (!d.badSince) d.badSince = now;
      else if (now - d.badSince > 3000) { failDeck(d, 'rendered ' + bad + ' for 3 s'); return; }
    }
    if (PLAY.playing && RT.cur) {
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
      c.textContent = (PLAY.playing ? '' : 'paused ') + fmt(rem);
    }
    $('#fps').textContent = (guard.fps ? guard.fps.toFixed(0) : '--') + ' fps';
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
    renderClock();
  }

  function renderNow() {
    const sk = SK.get(RT.cur);
    $('#now').textContent = sk ? sk.title + ' · ' + sk.author : '';
    $('#credit').textContent = sk ? sk.title + ' · ' + sk.author + ' · ' + LICENSE : '';
    $('#code-ov').textContent = sk ? sk.code : '';
    for (const li of $('#pl-list').children) li.classList.toggle('cur', li.dataset.id === RT.cur);
    for (const c of $('#g-grid').children) c.classList.toggle('cur', c.dataset.id === RT.cur);
    renderClock();
  }

  function stageMsg(t) { const m = $('#stage-msg'); m.textContent = t; m.hidden = !t; }

  function setCode(on) { RT.code = !!on; renderBar(); }
  function setBlack(on) { S.black = !!on; saveSettings(); renderBar(); }
  function setClean(on) { S.clean = !!on; saveSettings(); renderBar(); }
  function setMenuHidden(on) { S.menuHidden = !!on; saveSettings(); renderBar(); poke(); }

  // full screen: menu auto-hides after 3 s without mouse movement
  let idleT = 0;
  function poke() {
    body.classList.remove('idle');
    clearTimeout(idleT);
    if (RT.fs) idleT = setTimeout(() => { if (RT.fs && !$('#bar').matches(':hover')) body.classList.add('idle'); else poke(); }, 3000);
  }
  document.addEventListener('mousemove', poke);
  function setFs(on) {
    RT.fs = !!on;
    body.classList.toggle('fs', RT.fs);
    if (RT.fs) setCode(false); // code never shows in full screen unless toggled on there
    renderBar();
    poke();
  }
  document.addEventListener('fullscreenchange', () => setFs(!!document.fullscreenElement));
  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(e => log('Full screen refused: ' + (e.message || e), true));
  }

  // ---- UI: tabs ---------------------------------------------------------------------------------

  function setTab(t) {
    S.tab = t; saveSettings();
    for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const v of ['playlist', 'gallery', 'credits', 'log']) $('#v-' + v).hidden = v !== t;
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
      return h('li', { 'data-id': it.id, class: [it.id === RT.cur ? 'cur' : '', sk.quarantine ? 'q' : ''].join(' ').trim() },
        h('span', { class: 'h', title: 'Drag to reorder', text: '≡' }),
        h('span', { class: 'i', text: String(i + 1) }),
        h('span', { class: 't', title: 'Play now' + q, 'data-act': 'play' }, sk.title, h('small', { text: sk.author })),
        h('input', { type: 'number', min: 1, max: 3600, step: 1, value: it.dur, title: 'Seconds', 'data-act': 'dur' }),
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
    if (el.dataset.act === 'star') {
      if (stars.has(id)) stars.delete(id); else stars.add(id);
      saveStars();
      if ($('#g-star').checked) renderGallery();
      else { press(el, stars.has(id)); el.textContent = stars.has(id) ? '★' : '☆'; }
    } else if (el.dataset.act === 'add') addToList(id);
    else if (el.dataset.act === 'play') { show(id) || log('Could not play ' + id, true); }
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
    const acts = {
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
        else if (S.clean) setClean(false);
        if (typing(e.target)) e.target.blur();
      },
    };
    if (!acts[k]) return;
    e.preventDefault();
    if (e.repeat && k !== 'ArrowRight' && k !== 'ArrowLeft') return;
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
  if (restoreId && SK.has(restoreId) && !SK.get(restoreId).quarantine && show(restoreId, { cut: true, elapsed: PLAY.elapsed })) { /* restored */ }
  else advance(1, { cut: true, from: null });
  renderBar();
  requestAnimationFrame(frame);

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
      };
    },
    next, prev, show, setPlaying, toggleRandom, shareLink, exportData, importData, setFs,
    addTestSketch(id, code) {
      SK.set(id, { id, title: 'Test ' + id, author: 'test', link: '', href: '', code, hydraCode: '', thumb: '', quarantine: '' });
    },
    addToList, pull,
  };
})();
