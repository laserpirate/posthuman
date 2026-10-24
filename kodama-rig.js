// kodama-rig.js: runs first inside every kodama scene iframe (same origin as the VJ app).
// © 2026 Marko Manriquez. All rights reserved.
//
// The scene files are never edited. This harness, injected ahead of the scene's own scripts:
//  - hides every element that is not a canvas (titles, legends, buttons, hints, footers), by
//    visibility, not by cropping; the buttons stay clickable from the controller;
//  - takes over requestAnimationFrame, performance.now and Date.now, so the parent's one loop
//    steps the scene. Each step is 1/60 s of scene time; the speed slider changes how many steps
//    run per displayed frame (several per frame above 1x, one every few frames below it), and only
//    the last step of a frame renders. Clock-based and per-frame animation scale together;
//  - drives the turntable through the scene's own orbit angle (camA) and switches off its own spin;
//  - pins devicePixelRatio to 1 and, in the app, reports the quality level's size as innerWidth /
//    innerHeight: the scene draws at that size and its canvas is stretched over the iframe, which the
//    app sizes to the stage. Scaling happens here, before the palette filter, so B/W stays two values;
//  - applies the palette inside the scene's own document, as a CSS filter on its WebGL canvas;
//  - gives the controller the scene's camera: its own orbit globals (camA, camY, camR) plus a pan
//    offset added to both the camera and its look point at render time. Pointer input is read by the
//    app on the stage (controller and output window alike) and set here, so the scene's handlers stay off.
(() => {
  'use strict';
  const W = window, cfg = W.__KCFG || {};
  const realNow = performance.now.bind(performance);
  const t0 = realNow(), d0 = Date.now();
  const STEP = 1000 / 60;
  const rig = W.__rig = { virt: 0, steps: 0, renders: 0, ready: false, err: '', skip: false, renderers: [], scene: null, spin: '' };
  performance.now = () => t0 + rig.virt;
  Date.now = () => d0 + Math.round(rig.virt);
  try { Object.defineProperty(W, 'devicePixelRatio', { get: () => 1, configurable: true }); } catch (e) { /* keep the real one */ }
  const size = { w: cfg.w || 0, h: cfg.h || 0 };
  if (size.w) {
    try {
      Object.defineProperty(W, 'innerWidth', { get: () => size.w, configurable: true });
      Object.defineProperty(W, 'innerHeight', { get: () => size.h, configurable: true });
    } catch (e) { size.w = 0; }
  }
  // a new quality level: the scene's own resize handler picks the new size up
  rig.setSize = (w, h) => {
    if (!size.w || (w === size.w && h === size.h)) return;
    size.w = w; size.h = h;
    W.dispatchEvent(new Event('resize'));
  };

  let q = [], seq = 0;
  W.requestAnimationFrame = cb => { q.push([++seq, cb]); return seq; };
  W.cancelAnimationFrame = id => { q = q.filter(x => x[0] !== id); };
  W.addEventListener('error', e => { if (!rig.err) rig.err = (e.message || 'error') + (e.lineno ? ' (line ' + e.lineno + ')' : ''); });
  W.addEventListener('unhandledrejection', e => { if (!rig.err) rig.err = String((e.reason && e.reason.message) || e.reason); });

  // visuals only: nothing but the canvas shows; no pointer input reaches the scene
  const css = document.createElement('style');
  css.textContent = 'html,body{background:#000 !important;cursor:none !important;overflow:hidden !important}' +
    'body *{visibility:hidden !important;pointer-events:none !important;transition:none !important;animation:none !important}' +
    'canvas{visibility:visible !important}' +
    (size.w ? 'canvas{position:fixed !important;left:0 !important;top:0 !important;width:100% !important;height:100% !important}' : '');
  document.documentElement.appendChild(css);

  // after three.js loads: wrap the renderer so catch-up steps skip rendering and teardown is complete
  rig.afterThree = () => {
    const T = W.THREE;
    if (!T || !T.WebGLRenderer || T.WebGLRenderer.__rig) return;
    const R = T.WebGLRenderer;
    const Wrapped = function (params) {
      const r = new R(params);
      const render = r.render;
      r.render = function (scene, camera) {
        rig.scene = scene;
        if (rig.skip) return;
        if (rig.spin === 'root' && scene) scene.rotation.y = rig.rootAng;
        const pan = rig.pan, panned = camera && (pan.x || pan.y || pan.z);
        if (panned) {
          // the scene placed the camera around its target this step; shift both by the pan
          const t = rig.lookTarget();
          camera.position.x += pan.x; camera.position.y += pan.y; camera.position.z += pan.z;
          if (t) camera.lookAt(t.x + pan.x, t.y + pan.y, t.z + pan.z);
        }
        try { render.call(this, scene, camera); } finally {
          if (panned) { camera.position.x -= pan.x; camera.position.y -= pan.y; camera.position.z -= pan.z; }
        }
        rig.renders++;
        rig.ready = true;
      };
      rig.renderers.push(r);
      return r;
    };
    Wrapped.prototype = R.prototype;
    Wrapped.__rig = true;
    T.WebGLRenderer = Wrapped;
  };

  // turntable: the scene's own orbit angle when it has one (all library scenes use a global camA),
  // else rotate the scene root
  let G = null;
  rig.rootAng = 0;
  rig.holdUntil = 0; // real time; while someone steers the view the turntable rests
  rig.hold = ms => { rig.holdUntil = realNow() + ms; };
  function spinStep(tt) {
    if (G === null) {
      try {
        G = (0, eval)('({get:()=>camA,set:v=>{camA=v}})');
        G.get();
        rig.spin = 'camA';
        if (cfg.spinVar) (0, eval)(cfg.spinVar + '=false'); // the harness turns it from here on
      } catch (e) { G = false; rig.spin = 'root'; }
    }
    const rate = cfg.rate || 0.0008;
    if (realNow() < rig.holdUntil) tt = 0; // held: no turn, and a scene's own spin is cancelled
    if (G) G.set(G.get() + rate * (tt - (cfg.spinVar || !cfg.ownSpin ? 0 : 1)));
    else rig.rootAng -= rate * (tt - 1);
  }

  // one displayed frame: run as many 1/60 s steps as the speed asks for, render only the last
  let acc = 0;
  rig.step = (dtMs, speed, tt) => {
    if (!q.length) return 0; // the scene has not started its loop yet
    if (!rig.view0) rig.view0 = rig.view(); // the scene's own starting view, for Reset view
    acc += Math.max(0, speed) * Math.min(dtMs, 250) / STEP;
    let n = Math.floor(acc);
    if (n > 8) { n = 8; acc = 0; } else acc -= n;
    for (let k = 0; k < n; k++) {
      rig.virt += STEP;
      rig.steps++;
      rig.skip = k < n - 1;
      spinStep(tt);
      const cbs = q;
      q = [];
      try { for (const [, cb] of cbs) cb(t0 + rig.virt); } finally { rig.skip = false; }
    }
    return n;
  };
  rig.angle = () => { try { return G ? G.get() : rig.rootAng; } catch (e) { return 0; } };
  rig.canvas = () => {
    const r = rig.renderers[0];
    return (r && r.domElement) || document.querySelector('canvas');
  };

  // camera: the scene's orbit globals, its look target, and the pan offset
  let C = null;
  function cam() {
    if (C === null) {
      try {
        C = (0, eval)('({get:()=>({a:camA,y:camY,r:camR}),set:v=>{if(isFinite(v.a))camA=v.a;if(isFinite(v.y))camY=v.y;if(isFinite(v.r))camR=v.r;}})');
        C.get();
      } catch (e) { C = false; }
    }
    return C;
  }
  let T = null;
  rig.lookTarget = () => {
    if (T === null) { try { T = (0, eval)('target'); if (!T || !T.isVector3) T = false; } catch (e) { T = false; } }
    return T || null;
  };
  rig.pan = { x: 0, y: 0, z: 0 };
  rig.view0 = null;
  rig.view = () => {
    const c = cam();
    if (!c) return null;
    const v = c.get();
    return { a: v.a, y: v.y, r: v.r, px: rig.pan.x, py: rig.pan.y, pz: rig.pan.z };
  };
  rig.setView = v => {
    const c = cam();
    if (!c || !v) return false;
    c.set(v);
    for (const k of ['x', 'y', 'z']) if (isFinite(v['p' + k])) rig.pan[k] = v['p' + k];
    return true;
  };

  // palette: an SVG filter defined in this document, on every canvas here
  rig.setPal = markup => {
    let f = document.getElementById('__phpal');
    if (!f) {
      const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;left:0;top:0';
      f = document.createElementNS(NS, 'filter');
      f.id = '__phpal';
      for (const [k, v] of [['x', '0'], ['y', '0'], ['width', '100%'], ['height', '100%'], ['color-interpolation-filters', 'sRGB']]) f.setAttribute(k, v);
      svg.appendChild(f);
      document.documentElement.appendChild(svg); // outside body: the overlay hiding never touches it
    }
    f.innerHTML = markup || '';
    rig.palOn = !!markup;
    rig.palCanvas();
  };
  rig.palOn = false;
  rig.palCanvas = () => {
    for (const c of document.querySelectorAll('canvas')) {
      c.style.setProperty('filter', 'none', 'important');
      void c.offsetWidth; // Chrome picks up new filter content only on a filter change
      c.style.setProperty('filter', rig.palOn ? 'url(#__phpal)' : 'none', 'important');
    }
  };

  // the scene's own buttons, mirrored by the controller
  rig.click = sel => { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; };
  rig.on = sels => sels.filter(sel => { const b = document.querySelector(sel); return !!b && (b.classList.contains('on') || b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true'); });

  rig.destroy = () => {
    q = [];
    for (const r of rig.renderers) {
      try { r.dispose(); } catch (e) { /* gone */ }
      try { r.forceContextLoss(); } catch (e) { /* gone */ }
    }
    rig.renderers = [];
    rig.scene = null;
  };
})();
