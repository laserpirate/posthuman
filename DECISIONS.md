# DECISIONS

One line per judgment call. Newest at the bottom.

- Preflight answers (2026-10-22): repo `laserpirate/posthuman` public; 30 s default duration; crossfade 2 s; all 58 in pool, 7 favorites starred and as the starting playlist; no credits or title cards in full screen.
- Read "2 30 x" as 30 seconds.
- `Z:\_F26_Fall-2026\9_post-human\posthuman\` already holds the post-human26 gated site (remote post-human26), so the app lives in `posthuman-vj\`.
- Credits line shows only in windowed mode; it is never drawn in full screen or in Clean output (projector), per preflight answer 5. The Credits toggle controls the windowed line.
- Site served from the repo root on Pages (`main` `/`), with `.nojekyll`; build tools live in `tools/` and are public but harmless.
- Font: Chakra Petch 500/600 (UI) and Martian Mono 400 (code overlay, readouts), bundled woff2 from @fontsource, OFL.
- Accents: lime #c4f53c (on) and red #ff4f63 (warn/blackout/quarantine). Squared controls everywhere.
- Header reading for all 58 sketches is a fixed table in tools/build-data.mjs (headers are irregular); untitled sketches are titled "Untitled".
- "CNDSD" (Malitzin Cortés's handle in the header) is used as the author for malitzin_*; "e_e" for eerie_ear_*; "Naoto Hieda" for the @naoto_hieda sketches.
- Sketches that read `a.fft` get a silent audio stub (`a.fft = [0,0,0,0]`), so they run without mic input; sketch code stays verbatim.
- Before each eval: hush, reset speed/bpm/fps, two ticks to flush feedback buffers, time = 0.
- Pause stops the autoplay timer only; the current sketch keeps animating.
- A playlist cannot contain the same sketch twice; Add on a sketch already in the list is a no-op with a log line. Makes reorder/current tracking unambiguous.
- Quarantined sketches can still be played by hand from the gallery or playlist; autoplay and random pull never pick them.
- Black/white check: a 160×90 readback once a second; black = brightest channel < 10, white = darkest > 245, for more than 3 s.
- On WebGL context loss: log, save, reload the page after 2 s (state restores from localStorage).
- Code overlay state is not persisted and is turned off when entering full screen; C turns it on there.
- Blackout state is persisted, so a reload during a blackout stays black.
- Auto quality drop is per session (not saved); the chosen level is saved.
- Share links carry only the playlist (name, ids, durations), not `?i=`, so the receiving laptop keeps its own instance.
- robots.txt and ai.txt are copied for parity, but GitHub project Pages serve them under /posthuman/, where crawlers do not look; the noindex/noai meta tag is what counts.
