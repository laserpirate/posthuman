# POST/HUMAN · VJ

A small, offline-capable VJ app for the 58 sketches of the Hydra gallery: gallery, playlists, autoplay with
crossfades, full-screen output, blackout. Built for Post Human at the GSD.

Live: https://laserpirate.github.io/posthuman/

## Run

- Online: open the live URL in Chrome.
- Offline: `node serve.mjs` in this folder, then open http://localhost:8080/ (no internet, no dependencies).
- One URL, several laptops: add `?i=<name>` (for example `?i=left`, `?i=right`). Each name keeps its own
  playlists and settings in that browser.
- Output on a projector: in the Live tab, Open output window (`?i=<name>&out=1`), move it to the projector, press F there.

Keys: Space play/pause, → next, ← previous, F full screen, H menu, C code, B blackout, R random, T tap tempo,
G hold, X ban current, Esc leave full screen, ? key card.

## Layout

```
index.html app.js app.css      the app (static, no build step)
data/sketches.js               58 sketches, decoded verbatim, with title/author/link and quarantine flags
data/quarantine.json           preflight report (GPU, per-sketch frame cost, reasons)
thumbs/                        stills captured on the GPU at build time
vendor/hydra-synth/            hydra-synth 1.4 (AGPL-3.0), vendored
fonts/                         Chakra Petch, Martian Mono (OFL)
serve.mjs                      offline static server
tools/                         build-data, preflight (+ harness.html), e2e, soak (Playwright)
```

## Rebuild and test

```sh
cd tools && npm install && cd ..
node tools/build-data.mjs tools/source/examples.json   # sketches -> data/sketches.js
node serve.mjs --port 8091 &
node tools/preflight.mjs                                # GPU preflight -> data/quarantine.json, thumbs/
node tools/build-data.mjs tools/source/examples.json   # fold quarantine flags in
node tools/e2e.mjs                                      # or: node tools/e2e.mjs https://laserpirate.github.io/posthuman/
node tools/soak.mjs 32                                  # 30+ min autoplay at 10 s per sketch
```

## License

App code © 2026 Marko Manriquez, all rights reserved. Sketches CC BY-NC-SA 4.0 by their authors.
hydra-synth AGPL-3.0. Fonts OFL 1.1. See `LICENSE`.
