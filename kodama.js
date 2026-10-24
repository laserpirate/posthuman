// kodama.js: the kodama pack and the kodama decks for POST/HUMAN · VJ.
// © 2026 Marko Manriquez. All rights reserved. Kodama scenes are Marko's original work, all rights reserved.
//
// The pack is either plain, in local/kodamas/ (gitignored; served by `node serve.mjs` on the show
// laptops), or encrypted, in kodamas/ (AES-GCM, key from a password through PBKDF2), which is what
// GitHub Pages carries. Every scene file is read into memory when the pack opens, so loading a
// scene onto a deck never waits on the network.
//
// A scene plays in a same-origin iframe (srcdoc): its three.js tag points at vendor/three.r128.min.js,
// its manifest script is inlined, and kodama-rig.js runs ahead of everything else.
(() => {
  'use strict';
  const KEYSTORE = 'phvj:kodama-key'; // per laptop, shared by every ?i= instance
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
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
  async function getBytes(url) {
    const r = await fetch(BASE + url, { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  async function common() {
    if (!P.rig) P.rig = await getText('kodama-rig.js');
    try { P.reg = JSON.parse(await getText('data/kodama-controls.json')); } catch (e) { P.reg = {}; }
  }

  // plain pack (show laptops): local/kodamas/index.json and the scene files beside it
  async function openLocal() {
    let idx;
    try { idx = JSON.parse(await getText('local/kodamas/index.json')); } catch (e) { return false; }
    await common();
    const files = new Map();
    await Promise.all(idx.scenes.map(async s => { files.set(s.file, await getText('local/kodamas/' + s.file)); }));
    try { P.manifest = await getText('local/kodamas/phylla-kodama-manifest.js'); } catch (e) { P.manifest = ''; }
    P.thumbs = new Map(idx.scenes.filter(s => s.thumb).map(s => [s.id, BASE + 'local/kodamas/' + s.thumb]));
    P.files = files; P.scenes = idx.scenes; P.mode = 'local'; P.why = '';
    return true;
  }

  // encrypted pack (Pages): kodamas/pack.json says how to derive the key; every file is iv + ciphertext
  let packInfo = null;
  async function packMeta() {
    if (packInfo) return packInfo;
    try { packInfo = JSON.parse(await getText('kodamas/pack.json')); } catch (e) { packInfo = false; }
    return packInfo;
  }
  async function deriveKey(pass, info) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(info.salt), iterations: info.iter },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }
  const importRaw = raw => crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, true, ['decrypt']);
  async function decrypt(key, u8) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, key, u8.slice(12)));
  }
  async function openEncrypted(key, info) {
    const idx = JSON.parse(dec.decode(await decrypt(key, await getBytes('kodamas/' + info.index))));
    await common();
    const files = new Map(), thumbs = new Map();
    await Promise.all(idx.scenes.map(async s => {
      files.set(s.file, dec.decode(await decrypt(key, await getBytes('kodamas/' + idx.files[s.file]))));
      if (idx.thumbs && idx.thumbs[s.id]) {
        const img = await decrypt(key, await getBytes('kodamas/' + idx.thumbs[s.id]));
        thumbs.set(s.id, URL.createObjectURL(new Blob([img], { type: 'image/jpeg' })));
      }
    }));
    P.manifest = idx.manifest ? dec.decode(await decrypt(key, await getBytes('kodamas/' + idx.manifest))) : '';
    P.files = files; P.thumbs = thumbs; P.scenes = idx.scenes; P.mode = 'encrypted'; P.why = '';
    return true;
  }

  // open whatever pack this server has: plain first, then encrypted with a remembered key (or `key`)
  async function open(rawKey) {
    // ?kpack=enc tests the encrypted copy on a server that also has the plain folder; Pages never has
    // local/ (gitignored), so it is not probed there (a 404 would land in the console)
    const hosted = /\.github\.io$/.test(location.hostname);
    if (!hosted && !/[?&]kpack=enc(&|$)/.test(location.search) && await openLocal()) return P;
    const info = await packMeta();
    if (!info) { P.mode = 'none'; P.why = 'Kodama pack not loaded'; return P; }
    let raw = rawKey;
    if (!raw) try { raw = localStorage.getItem(KEYSTORE) || ''; } catch (e) { raw = ''; }
    if (!raw) { P.mode = 'locked'; P.why = 'Kodama pack locked: enter the password'; return P; }
    try { await openEncrypted(await importRaw(raw), info); P.raw = raw; }
    catch (e) { P.mode = 'locked'; P.why = 'Kodama pack locked: the saved key no longer opens it'; }
    return P;
  }
  async function unlock(pass, remember) {
    const info = await packMeta();
    if (!info) throw new Error('no encrypted pack on this server');
    const key = await deriveKey(pass, info);
    try { await openEncrypted(key, info); } catch (e) { throw new Error('wrong password'); }
    const raw = b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
    P.raw = raw;
    if (remember) try { localStorage.setItem(KEYSTORE, raw); } catch (e) { /* storage blocked */ }
    return P;
  }
  function forget() { try { localStorage.removeItem(KEYSTORE); } catch (e) { /* ignore */ } }

  // the scene, ready for a deck: local three.js, inline manifest, the rig first
  function prep(scene) {
    const html = P.files.get(scene.file);
    if (!html) return null;
    const r = (P.reg[scene.id] && P.reg[scene.id].turntable) || {};
    const cfg = { id: scene.id, spinVar: r.spinVar || '', rate: r.rate || 0.0008, ownSpin: !!r.ownSpin };
    const head = '<script>window.__KCFG=' + JSON.stringify(cfg) + ';</script><script>' + P.rig + '\n</script>';
    let out = html.replace(THREE_TAG, '<script src="' + abs('vendor/three.r128.min.js') + '"></script><script>window.__rig&&__rig.afterThree();</script>');
    out = out.replace(MANIFEST_TAG, () => '<script>' + P.manifest + '\n</script>');
    // ahead of every scene script: right after <head> (or at the very top)
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, m => m + head) : head + out;
    return out;
  }

  window.PHKODA = { P, open, unlock, forget, prep, KEYSTORE, packMeta };
})();
