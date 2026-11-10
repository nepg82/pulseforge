# PulseForge — Media Session test build

A clean-start PWA focused on proving Android background playback and platform media controls before adding the full generative music system.

## Included

- A 20-second, effectively inaudible WAV loop played by an `HTMLAudioElement`.
- The media element is connected as an **input** to Web Audio; the synth is mixed into the same output.
- Media Session metadata and play, pause, stop, next, and previous handlers.
- Minimal player UI; the animated visualizer has been removed.
- Local diagnostics log and offline app-shell caching.
- Build stamp in the footer (`YYMMDD-HHMM`); tap it to unregister the service worker, clear PulseForge's shell caches, and reload with a cache-busting query.
- A first 16-step generative sequencer with three electronic patterns, kick/snare/hat percussion, bass, and midrange lead.
- A stronger midrange mix for small and bone-conduction headphones, plus audio latency diagnostics.
- No external libraries or network dependencies.

## Why the audio path changed

Chrome's Android Media Session guidance notes that Web Audio alone does not request Android audio focus in the same way as media playback. It recommends using an audio element as the input to Web Audio, and notes that Chrome for Android requires a media resource of at least five seconds for full audio focus. PulseForge now uses a 20-second quiet WAV loop as that media resource, then mixes the generated synth through Web Audio. The quiet loop should not be audible.

## Run locally

The app must be served from HTTPS or localhost; opening `index.html` directly will not enable service workers.

From the project folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. For Android testing, deploy the folder to an HTTPS host.

## Test sequence

1. Update the existing deployed files and reload PulseForge. If the old shell remains cached, close the PWA and reopen it after the service-worker update.
2. Start playback and listen to the three sequenced patterns. Use previous/next to change them; each has a different tempo and arrangement.
3. Lock the screen. Look for PulseForge track metadata and media controls in Android's lock screen / notification shade.
4. Tap the centered build timestamp to force a server refresh. The app should reload and then register the service worker again.
5. Test play/pause and next/previous using the lock-screen controls and Bluetooth headset buttons.
6. While playing, start another audio app and observe whether PulseForge yields.
7. Take a phone call, then return and test recovery. PulseForge should not force audio to resume; press Play to resume after an interruption.
8. Enable airplane mode, relaunch PulseForge, and test offline startup.

Open **Diagnostics** and copy the log after each test. The log records which Media Session actions the browser accepted and which actions Android sends back.

## Platform note

The Media Session API lets the browser expose metadata and handlers to operating-system media controls, but the browser and device decide how those controls are presented. A successful handler registration does not guarantee that every Android skin or Bluetooth device will show every action.

## Cache updates

When changing files that are precached by the service worker, increment `CACHE_NAME` in `sw.js` so installed copies receive the new shell.
