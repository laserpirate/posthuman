# MORNING

## Live

- **URL:** https://laserpirate.github.io/posthuman/ (tag `posthuman-v0.1.0`)
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

## Stretch done (all off by default or only active when used)

1. **Audio reactive:** input picker with voice processing off. Five bands at once (Full, Low, Mid, High, Custom Hz), each with sensitivity, smoothing, threshold and a meter.
   - Zoom pump and brightness flash each pick a band. Levels are exposed as `A.full/low/mid/high/custom`.
2. **Output window:** Live tab, `?i=<name>&out=1`, synced by BroadcastChannel.
   - The controller keeps the clock and the output reports failures back.
   - The controller preview rests while the output is open, to save GPU.
3. **Tap tempo (T)** and "switch every 4/8/16/32 bars".
4. **Hold (G), Cue next, Ban (X)**, per instance.

## Tests

- **E2E** (`tools/e2e.mjs`, Playwright on the RTX 3080): 22/22 local headless, 22/22 local headed, 21/21 against the live URL (the offline check is local only).
  - Covers gallery and quarantine; every playlist operation; export/import round trip; autoplay timing and looping; random coverage; crossfade and cut; idle deck not ticking.
  - Full screen checked on real screen pixels through transitions, quality change, 20 toggles, button/F/double-click and the refused-API fallback.
  - Also: menu auto-hide; blackout from every state; 5 kinds of broken sketch skipped; reload restore; `?i=a`/`?i=b` separation; share link; phone width; 1366×768; offline (no off-server requests); zero console errors or warnings; all stretch features.
- `node --check` passes on every JS file.
- **Full screen black (your report):** in full screen the menu bar becomes `position: fixed`, leaves the grid flow, and `#main` slid into the 0 px grid row, so the stage had zero height. Pinned the rows; the pixel test now guards it.

## Soak (RTX 3080, autoplay through all 57 playable sketches at 10 s each, crossfade 2 s, Med)

SOAK_RESULTS

## Quarantine

- `flor_1` (Hydra Glitchy Slit Scan, Flor de Fuego): needs a camera (`s0.initCam()`).
- Every other sketch passed preflight on the RTX 3080: no errors, no black/white, p95 frame cost 2 to 7 ms at 1280×720 (`data/quarantine.json`).

## Known issues

- Not verified on Luna, the M4, Stardust, any projector, or a real audio interface. Audio was tested only with Chromium's fake microphone.
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
- **GitHub:** `laserpirate/posthuman`, `main`, tag `posthuman-v0.1.0`.
- **Pages:** https://laserpirate.github.io/posthuman/ from `main` `/`.
- The existing `posthuman\` folder (post-human26 gated site) was not touched.
