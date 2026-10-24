# SHOWNIGHT

One page for running POST/HUMAN · VJ at the show. URL: https://laserpirate.github.io/posthuman/?i=<name> (offline: `node serve.mjs`, then http://localhost:8080/?i=<name>).

## Audio in: Focusrite Scarlett (USB)

1. **Plug the Scarlett in by USB before opening the app.**
2. On Windows, if it is not listed as an input, install Focusrite Control (it brings the driver), then replug.
3. Cable: the DJ mixer's **booth or record out** goes to Scarlett **input 1** (or 1+2 for stereo).
4. On the Scarlett: **INST off, Air off, direct monitor off.**
5. Gain: the ring around the knob stays **green**, amber only on peaks, **never red**.
6. In the app: Live tab, tick **Audio reactive**. Chrome asks for the microphone once; allow it.
   - A device named Scarlett or Focusrite is picked automatically. The line under the picker says `Input: <device>`, and the Log tab records it.
   - With no Scarlett, the app uses the last device chosen in this instance (`?i=` name), else the default input.
   - Browser voice processing (echo cancellation, noise suppression, auto gain) is off.
7. Watch the meters: kick on **Low**, hats on **High**. Raise Sens until the meter moves, and use Threshold to ignore the noise floor.

## If the Scarlett drops out

- The Live tab says `Input lost: <device>` in red, and the Log tab notes it. **The visuals keep running**, without the audio effects.
- Plug it back in. The app reconnects by itself within a few seconds; nothing to click.
- If it doesn't, untick and tick Audio reactive, or pick the device in the list.

## Kodama mode (Marko's kodama scenes)

**Hydras | Kodamas** in the menu bar switches what plays; it fades through black. Each mode keeps its own playlists, stars, bans and position.

Getting the kodama pack onto a laptop (pick one):

1. **Local folder (best for the show, works offline):** copy `posthuman-vj\local\kodamas\` from Polaris by USB into the same place in that laptop's `posthuman-vj` folder. Run `node serve.mjs`, open http://localhost:8080/?i=<name>. The Kodamas tab says "from the local folder".
2. **Encrypted pack on the live site:** open https://laserpirate.github.io/posthuman/?i=<name>, Gallery tab, enter the kodama password (it is in `local\kodama-pass.txt` on Polaris; not in the repo), keep "Remember on this laptop" ticked. Every `?i=` name and the output window on that browser then open it by themselves.

Without either, the Kodamas button says "Kodama pack not loaded" and the Hydras keep playing.

Scene tab (Kodama mode):

- **The scene's own buttons**, mirrored: TIME (dawn/day/dusk/night/cycle), FLOOD (low/high/cycle), CLIMATE/RIVER/LIGHT cycles, as each scene has them. The scene's text and buttons never show on the output.
- **Speed** 0.1× to 3× (1× button resets). **Turntable** 0 to 3×, plus Reverse; 0 stops the orbit.
- **Palette** (both modes, each its own): first row of the **Scene** tab; in Kodama mode also the dropdown in the menu bar; **P** cycles. Original, Grayscale, Black/white (threshold), Mono (hue), Duotone (presets red/green, cyan/magenta, amber/indigo, or two colors), Red/green gradient map; Intensity and Contrast (Intensity below 1 mixes the original back in). A playlist row's **Pal** button gives that item its own palette; while it is on screen the Scene tab says so and its controls edit that item. "On start" is the Kodama palette when the app opens.
- **View** (Kodamas): drag on the stage to orbit, **shift-drag or right-drag** to pan, **wheel** to zoom. Same on the Scene tab's pad, or directly in the output window; the projector follows the controller and the other way round. The turntable rests while you steer and resumes 2 s later. **Reset view** goes back to the scene's start. A playlist row's **View** button saves the current view for that item.
- Default kodama duration is 90 s. airfield, under-city, drowned towers and cloud city are approved and in the default Kodamas playlist. The mashups (cloud airfield, flooded under-city, storm runway, hanging city) and the Gund Hall scenes (gund trays, gund ruin) are marked Draft and are not in it; add them by hand from the Kodamas tab if wanted.

## Keys

Space play/pause · → ← next/previous · F full screen · B blackout · H menu · C code overlay · R random · S star · T tap tempo · G hold · X ban · Ctrl+Enter run edited code · ? keys card.

## Not verified

- Tested only with Chromium's fake microphone, plus a renamed fake device standing in for the Scarlett. Not yet tested with a real Scarlett, a real mixer, Luna, the M4, Stardust or a projector.
- Kodama mode tested on Polaris (RTX 3080) and on SwiftShader only; not yet on Luna, the M4 or Stardust.
- Check the real Scarlett's device name in the Live tab picker at soundcheck.
