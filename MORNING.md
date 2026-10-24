# MORNING

## Live

- **URL:** https://laserpirate.github.io/posthuman/ (tags `posthuman-v0.1.0`, `posthuman-v0.2.0`, `posthuman-v0.2.1`, `posthuman-v0.3.0`, `posthuman-v0.3.1`; safety tag `posthuman-v0.2.2-pre-kodama`)
- **Repo:** https://github.com/laserpirate/posthuman (public, `main`, Pages from `/`)
- **Local:** `Z:\_F26_Fall-2026\9_post-human\posthuman-vj\`

## What works

- **Gallery:** 58 sketches as still cards (title, author, star), search, starred filter, Edit in Hydra link. Quarantined sketches are badged and never autoplayed.
- **Playlists:** add, pull N random (pool or starred, no duplicates), remove, drag reorder plus up/down, shuffle, clear, per-item seconds, default plus "apply to all".
  - Several named playlists with a switcher. Export/import JSON. Share link (playlist in the URL hash).
  - "Playlist from starred". Everything saves to localStorage per `?i=` instance.
- **Autoplay:** in order with looping, or random (from the playlist or the whole pool; every item plays once per cycle).
  - Play/pause, next, previous, countdown.
  - Crossfade (settable seconds, default 2 s) or cut. Default 30 s per sketch.
- **Output:** large stage, Full screen (button, F, double-click; falls back to a full-window mode if the browser refuses), code overlay off by default (C).
  - The menu bar auto-hides after 3 s in full screen and comes back on mouse move. Clean output hides all UI.
  - Credits line in windowed mode only (none in full screen, per your answer). Blackout (B) above everything.
- **Reliability:** exactly 2 hydra instances for the whole session.
  - Every eval and tick is wrapped. A sketch that throws (including errors inside sketch functions, which hydra swallows) or stays black/white for more than 3 s is skipped and logged in the Log tab, never on the output.
  - Reload restores the playlist, position and settings.
- **Performance:** default Med 1280×720 at 30 fps, DPR capped at 1, Low/Med/High selector, auto-drop after 5 s under 24 fps, fps in the controller only.
- **Multi-instance:** `?i=left`, `?i=right` keep separate playlists/settings; the name shows in the menu bar.
- **Offline:** `node serve.mjs`. hydra-synth and the fonts are vendored; nothing loads from a CDN.
- **Credits view** and `LICENSE` (app © 2026 Marko Manriquez, all rights reserved; sketches CC BY-NC-SA 4.0; hydra-synth AGPL-3.0).

## v0.2.0 (handoff-3)

- **Full screen black, root cause:** in full screen the menu bar is `position: fixed`, so `#main` slid into the 0 px grid row and the stage had zero height. Grid rows are now pinned.
  - The same flaw hit the output window and Clean.
  - Also fixed: Chrome's no-movement mousemove events kept the full-screen menu from auto-hiding (seen only headed).
  - A refused Fullscreen API now falls back to a full-window mode. Double-click toggles full screen.
- **Stars everywhere:** gallery cards, playlist rows, menu bar (S). Starred filter, pull from starred, Playlist from starred.
- **Audio, five bands at once:** Full, Low (kick/bass), Mid, High (hats), Custom Hz, each with sensitivity, smoothing, threshold and a meter.
  - Zoom and flash each pick a band. `A.full/low/mid/high/custom` are globals for edited code. Off by default; the output window follows.
- **Live edit (Code tab):** textarea with line numbers. Ctrl+Enter runs on the live deck with no crossfade and no time reset. Errors show inline and the last good code keeps playing.
  - Revert, Save as variant (credited "edited from ... by ..."), Copy to Hydra.
  - **Knobs** for every plain float argument of a hydra function, named from hydra-synth's own definitions. Sliders change uniforms without re-eval. Range fields. Per-knob audio link with depth. Bake writes the values back.
- **Phone:** the controller fits 390 px again.
- **Show input (v0.2.1):** a Focusrite Scarlett is picked automatically when listed, ahead of the instance's last choice. The device name shows in the Live tab and the Log.
  - Unplugged: the Live tab says so in red, the visuals keep running without audio, and it reconnects by itself when the device is back.
  - Hookup checklist in `SHOWNIGHT.md`: USB, mixer booth/record out to input 1 (or 1+2), INST/Air/direct monitor off, gain ring green (amber on peaks, never red), Focusrite Control on Windows if not listed, plug in before opening the app.
- **Keys card:** adds S (star) and Ctrl+Enter (run).

## v0.3.0 (handoff-5): Kodama mode

- **Mode switch** "Hydras | Kodamas" in the menu bar; it fades through black (about 0.5 s). Each mode has its own library, playlists, stars, bans, position and palette, scoped per `?i=`. The output window follows. Hydra mode is unchanged (e2e 27/27, 10 min soak).
- **Library:** 36 scenes. pk17 to pk24, kv01 to kv25 (there is no kv22), and four new drafts pk26 to pk29. three.js r128 is vendored (`vendor/three.r128.min.js`), nothing from a CDN.
- **Loading the pack** (the scenes are not in the repo as plain files):
  - Local: `local\kodamas\` (gitignored; 36 scenes, thumbnails, `index.json`). Copy that folder to the same place on each laptop and run `node serve.mjs`.
  - Pages: `kodamas/` carries the same pack encrypted (AES-256-GCM, PBKDF2 250k). Gallery tab, enter the password, "Remember on this laptop". The password is only in `local\kodama-pass.txt` on Polaris.
  - Neither: the Kodamas mode says "Kodama pack not loaded" and Hydra keeps running.
- **New controls (Scene tab):**
  - The scene's own controls, mirrored from `data/kodama-controls.json` (90 controls over 36 scenes: TIME, FLOOD, CLIMATE, RIVER, LIGHT and so on). The scenes' own text, buttons and HUD never reach the output.
  - Speed 0.1x to 3x; turntable 0 to 3x plus Reverse; drag-to-orbit is off.
  - Palette per mode: Original, Grayscale, Black/white (threshold), Mono (hue), Duotone (red/green, cyan/magenta, amber/indigo presets, or two colors), Red/green gradient map; plus Intensity and Contrast. **Pal** on a playlist row saves a palette for that item. "Kodama start" (your three options and more) picks the palette on entering Kodama mode; default Original.
  - Default kodama duration 90 s. Crossfade, cut, random, hold, cue, ban, star all work as in Hydra mode.
- **Reliability:** at most 2 scene iframes at any time; the outgoing one is disposed (renderer dispose plus context loss) after the fade. A scene that throws, loses its context or shows no frame in 15 s is skipped and logged.
- **Palette cost** (SwiftShader software floor, High 1920x1080, pk18; baseline 60 fps): Grayscale 3.5%, B/W 9.7%, Mono 8.7%, Duotone 10.1%, Red/green 9.9%, Grayscale with intensity 0.5 and contrast 1.4 15.5%. **None over 20%.** At Low every palette holds the 30 fps cap.
- **New kodamas (drafts, pending your approval, not in the default playlist):** pk26 airfield, pk27 under-city, pk28 drowned towers, pk29 cloud city. Contact sheet: `local\kodamas\contact-sheet.jpg` (4-up). Copies also in `..\All_Kodamas\phylla-kodama-topo-26..29-*.html`. GPU 45 to 60 fps; SwiftShader at Low 22 to 30 fps.
- **Quarantine (kodamas):** none. All 36 passed preflight on the RTX 3080 (p95 frame cost at most 9.3 ms, no visible text).
- **Tests:** `tools/e2e-kodama.mjs` 9/9 (pack local and encrypted, wrong password, remembered key; visuals only; mirrored controls; speed and turntable; palettes; autoplay, crossfade, cut, mode switch, teardown, bad scene skipped; output window; offline; zero console errors). Hydra `tools/e2e.mjs` 27/27. Soaks (headless, RTX 3080, Med), both pass: Hydra 10 min, 61 switches, all 57 played, 30 fps, heap 3.6 to 3.9 MB; Kodama 15 min, 46 switches, all 36 played, fps min 29.5 avg 30, heap 6.7 to 7.1 MB, at most 2 iframes; both 0 context lost, 0 skips, 0 console errors.
- **Not built:** a camera height/zoom slider (scenes don't share one camera model).
- **Not verified:** Luna, the M4, Stardust, an Intel iGPU, any projector. Kodama mode ran only on Polaris (RTX 3080) and SwiftShader.

## Stretch done (all off by default or only active when used)

1. **Audio reactive:** input picker with voice processing off. Five bands at once (Full, Low, Mid, High, Custom Hz), each with sensitivity, smoothing, threshold and a meter.
   - Zoom pump and brightness flash each pick a band. Levels are exposed as `A.full/low/mid/high/custom`.
2. **Output window:** Live tab, `?i=<name>&out=1`, synced by BroadcastChannel.
   - The controller keeps the clock and the output reports failures back.
   - The controller preview rests while the output is open, to save GPU.
3. **Tap tempo (T)** and "switch every 4/8/16/32 bars".
4. **Hold (G), Cue next, Ban (X)**, per instance.

## Tests

- **E2E** (`tools/e2e.mjs`, Playwright on the RTX 3080) at v0.2.0: 26/26 local headless, 26/26 local headed, 25/25 against the live URL (the offline check is local only). v0.2.1 adds a show-input test (fake Scarlett: auto-pick, unplug, replug): 27/27 local headless and headed, 26/26 live.
  - Live edit: knob parsing; run changes the render with no time reset; syntax and runtime errors keep the last frame; revert; a slider changes a uniform with zero re-evals; an audio-linked knob moves with the fake input; bake; variant save, reload, gallery and playlist; instances separate.
  - Covers gallery and quarantine; every playlist operation; export/import round trip; autoplay timing and looping; random coverage; crossfade and cut; idle deck not ticking.
  - Full screen checked on real screen pixels through transitions, quality change, 20 toggles, button/F/double-click and the refused-API fallback.
  - Also: menu auto-hide; blackout from every state; 5 kinds of broken sketch skipped; reload restore; `?i=a`/`?i=b` separation; share link; phone width; 1366×768; offline (no off-server requests); zero console errors or warnings; all stretch features.
- `node --check` passes on every JS file.
- **Full screen black (your report):** in full screen the menu bar becomes `position: fixed`, leaves the grid flow, and `#main` slid into the 0 px grid row, so the stage had zero height. Pinned the rows; the pixel test now guards it.

## Soak (RTX 3080, autoplay through all 57 playable sketches at 10 s each, crossfade 2 s, Med)

**Soak 3 (pass), headless Chromium on the real GPU (ANGLE D3D11), code at `posthuman-v0.1.0`:**

| | |
|---|---|
| Duration | 32 min, 195 switches, all 57 playable sketches played |
| fps | min 27.5, avg 29.9, max 30 (cap 30) |
| JS heap after forced GC | 3.39 MB at start, 3.89 MB at end; first-third avg 3.61, last-third avg 3.91 |
| WebGL context lost | 0 |
| Reloads | 0 |
| Skips | 0 |
| Console errors/warnings | 0 |
| Hydra instances | 2 the whole time |

- **Soak 1** (headed, pre-fix code): 0 context losses, 28 fps. It failed on one favicon 404 and a heap that kept creeping. Heap snapshots found hydra-synth leaking 4 WebGL textures per switch in `hush()`. Fixed: the app frees them first, and the heap now levels off.
- **Soak 2** was stopped: the visible soak window was being driven by hand.
- Soak 3 shares the GPU with some short e2e runs (the one 27.5 fps sample).
- Leftover heap growth is about 0.3 MB in 30 min (V8 code for each eval, Chrome's capped layout-shift buffer); it flattens.
- **Soak 4 (pass), v0.2.0 code, headless on the real GPU, nothing else running:** 32 min, 192 switches, all 57 played; fps min 29, avg 29.9; heap 3.45 to 4.02 MB (thirds 3.69 to 3.99); 0 context lost, 0 reloads, 0 skips, 0 console errors; 2 hydra instances.

## Quarantine

- `flor_1` (Hydra Glitchy Slit Scan, Flor de Fuego): needs a camera (`s0.initCam()`).
- Every other sketch passed preflight on the RTX 3080: no errors, no black/white, p95 frame cost 2 to 7 ms at 1280×720 (`data/quarantine.json`).

## Known issues

- Not verified on Luna, the M4, Stardust, any projector, or a real audio interface. Audio was tested only with Chromium's fake microphone; the Scarlett auto-pick and unplug/replug were tested with a fake device renamed to "Focusrite USB (Scarlett 2i2 USB)". Check the real device name at soundcheck.
- On a GitHub project page, `robots.txt` and `ai.txt` sit under `/posthuman/`, where crawlers don't look. The `noindex/noai` meta tag is what applies.
- The Share link carries only the playlist, not `?i=`, by design.
- Sketches that read `a.fft` (audio in the original gallery) run with silent bands; they do not react to the Live tab audio.

## How to run it tomorrow

1. Chrome, https://laserpirate.github.io/posthuman/?i=left (each laptop its own name: `?i=right`, `?i=booth`).
2. Offline: open a terminal in `posthuman-vj`, run `node serve.mjs`, open http://localhost:8080/?i=left.
3. Playlist tab: pick or build a list; Space starts autoplay.
4. F (or double-click the stage) for full screen; Esc or F to leave.
5. H hides/shows the menu; in full screen it hides itself after 3 s.
6. B is blackout. It works in every state; press again to come back.
7. → and ← skip; R toggles random; C shows the code (off by default).
8. Projector as a second screen: Live tab, Open output window, drag it to the projector, press F there.
9. Quality menu: Low on weak laptops; it also drops by itself after 5 s under 24 fps.
10. Problems show in the Log tab only, never on the output.

## What landed where

- **Local:** `Z:\_F26_Fall-2026\9_post-human\posthuman-vj\` (git repo; `test-results/` holds e2e and soak JSON, not committed).
- **GitHub:** `laserpirate/posthuman`, `main`, tags `posthuman-v0.1.0`, `posthuman-v0.2.0`, `posthuman-v0.2.1`, `posthuman-v0.2.2-pre-kodama`, `posthuman-v0.3.0` and `posthuman-v0.3.1` (no 404 probe of `local/` on Pages).
- **Kodama pack:** `local\kodamas\` and `local\kodama-pass.txt`, gitignored, Polaris only. The encrypted copy is `kodamas/` in the repo and on Pages.
- **Pages:** https://laserpirate.github.io/posthuman/ from `main` `/`.
- The existing `posthuman\` folder (post-human26 gated site) was not touched.
