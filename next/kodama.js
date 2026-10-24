// kodama.js: the kodama pack and the kodama decks for POST/HUMAN · VJ.
// © 2026 Marko Manriquez. All rights reserved. Kodama scenes are Marko's original work, all rights reserved.
//
// The pack is plain, with no password: local/kodamas/ (gitignored; served by `node serve.mjs` on the
// show laptops) or kodamas/, the public copy GitHub Pages carries (Marko's call, 24 Oct: no password
// on the live sites). Every scene file is read into memory when the pack opens, so loading a scene
// onto a deck never waits on the network.
//
// A scene plays in a same-origin iframe (srcdoc): its three.js tag points at vendor/three.r128.min.js,
// its manifest script is inlined, and kodama-rig.js runs ahead of everything else.
(() => {
  'use strict';
  const BASE = window.PHKODA_BASE || ''; // the app root, relative to this page (the preflight harness lives in tools/)
  const abs = rel => new URL(BASE + rel, location.href).href;
  const THREE_TAG = /<script\s+src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"\s*><\/script>/;
  const MANIFEST_TAG = /<script\s+src="phylla-kodama-manifest\.js"\s*><\/script>/;

  const P = { mode: 'none', why: '', scenes: [], files: new Map(), thumbs: new Map(), manifest: '', rig: '', reg: {} };

  async function getText(url) {
    const r = await fetch(BASE + url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return r.text();
  }

  async function common() {
    if (!P.rig) P.rig = await getText('kodama-rig.js');
    try { P.reg = JSON.parse(await getText('data/kodama-controls.json')); } catch (e) { P.reg = {}; }
  }

  // a plain pack: dir/index.json and the scene files beside it
  async function openPlain(dir, mode) {
    let idx;
    try { idx = JSON.parse(await getText(dir + 'index.json')); } catch (e) { return false; }
    await common();
    const files = new Map();
    // a scene whose file is missing from the folder is left out rather than closing the whole pack
    await Promise.all(idx.scenes.map(async s => { try { files.set(s.file, await getText(dir + s.file)); } catch (e) { /* missing */ } }));
    idx.scenes = idx.scenes.filter(s => files.has(s.file));
    try { P.manifest = await getText(dir + 'phylla-kodama-manifest.js'); } catch (e) { P.manifest = ''; }
    P.thumbs = new Map(idx.scenes.filter(s => s.thumb).map(s => [s.id, BASE + dir + s.thumb]));
    P.files = files; P.scenes = idx.scenes; P.mode = mode; P.why = '';
    return true;
  }

  // the local folder first, then the public copy
  async function open() {
    try { localStorage.removeItem('phvj:kodama-key'); } catch (e) { /* the old encrypted pack's key */ }
    // ?kpack=pub tests the public copy on a server that also has the local folder; Pages never has
    // local/ (gitignored), so it is not probed there (a 404 would land in the console)
    const hosted = /\.github\.io$/.test(location.hostname);
    if (!hosted && !/[?&]kpack=pub(&|$)/.test(location.search) && await openPlain('local/kodamas/', 'local')) return P;
    if (await openPlain('kodamas/', 'public')) return P;
    P.mode = 'none'; P.why = 'Kodama pack not loaded';
    return P;
  }

  // the scene, ready for a deck: local three.js, inline manifest, the rig first
  function prep(scene, size) {
    const html = P.files.get(scene.file);
    if (!html) return null;
    const r = (P.reg[scene.id] && P.reg[scene.id].turntable) || {};
    const cfg = { id: scene.id, spinVar: r.spinVar || '', rate: r.rate || 0.0008, ownSpin: !!r.ownSpin, w: size ? size.w : 0, h: size ? size.h : 0 };
    const head = '<script>window.__KCFG=' + JSON.stringify(cfg) + ';</script><script>' + P.rig + '\n</script>';
    let out = html.replace(THREE_TAG, '<script src="' + abs('vendor/three.r128.min.js') + '"></script><script>window.__rig&&__rig.afterThree();</script>');
    out = out.replace(MANIFEST_TAG, () => '<script>' + P.manifest + '\n</script>');
    // ahead of every scene script: right after <head> (or at the very top)
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + head) : head + out;
    return out;
  }

  window.PHKODA = { P, open, prep };
})();
