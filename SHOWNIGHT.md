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

## Keys

Space play/pause · → ← next/previous · F full screen · B blackout · H menu · C code overlay · R random · S star · T tap tempo · G hold · X ban · Ctrl+Enter run edited code · ? keys card.

## Not verified

- Tested only with Chromium's fake microphone, plus a renamed fake device standing in for the Scarlett. Not yet tested with a real Scarlett, a real mixer, Luna, the M4, Stardust or a projector.
- Check the real Scarlett's device name in the Live tab picker at soundcheck.
