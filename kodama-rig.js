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
//  - pins devicePixelRatio to 1 (the iframe is sized to the quality level and scaled to the stage).
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

  let q = [], seq = 0;
  W.requestAnimationFrame = cb => { q.push([++seq, cb]); return seq; };
  W.cancelAnimationFrame = id => { q = q.filter(x => x[0] !== id); };
  W.addEventListener('error', e => { if (!rig.err) rig.err = (e.message || 'error') + (e.lineno ? ' (line ' + e.lineno + ')' : ''); });
  W.addEventListener('unhandledrejection', e => { if (!rig.err) rig.err = String((e.reason && e.reason.message) || e.reason); });

  // visuals only: nothing but the canvas shows; no pointer input reaches the scene
  const css = document.createElement('style');
  css.textContent = 'html,body{background:#000 !important;cursor:none !important;overflow:hidden !important}' +
    'body *{visibility:hidden !important;pointer-events:none !important;transition:none !important;animation:none !important}' +
    'canvas{visibility:visible !important}';
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
        render.call(this, scene, camera);
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
    if (G) G.set(G.get() + rate * (tt - (cfg.spinVar || !cfg.ownSpin ? 0 : 1)));
    else rig.rootAng -= rate * (tt - 1);
  }

  // one displayed frame: run as many 1/60 s steps as the speed asks for, render only the last
  let acc = 0;
  rig.step = (dtMs, speed, tt) => {
    if (!q.length) return 0; // the scene has not started its loop yet
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
