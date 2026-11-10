# PulseForge — Milestone 1

A clean-start PWA focused on proving Android playback behavior before adding a full generative music system.

## Included

- Web Audio synth test routed to a real `HTMLAudioElement` through `MediaStreamAudioDestinationNode`.
- Media Session actions: play, pause, stop, next, previous.
- Minimal responsive player UI and local diagnostics log.
- Service worker app-shell caching for offline launch.
- No external libraries or network dependencies.

## Run locally

The app must be served from HTTPS or localhost; opening `index.html` directly will not enable service workers.

From the project folder, one option is:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` on the computer. For Android testing, deploy the folder to an HTTPS host such as GitHub Pages.

## First test sequence

1. Open PulseForge in Chrome or Brave on the Motorola.
2. Install it from the browser menu if offered.
3. Start playback and confirm the sound is audible.
4. Lock the screen for at least 5 minutes.
5. Test Bluetooth play/pause and next/previous controls.
6. While playing, start another audio app and observe whether PulseForge yields.
7. Take a phone call, then return and test recovery.
8. Enable airplane mode, relaunch PulseForge, and test offline startup.

Open **Diagnostics** and copy the log after each test. Record whether the app was installed, browser used, screen state, Bluetooth device, and what happened.

## Important implementation note

This version deliberately sends the actual generated audio through the media element. It does not use Chillforge's separate near-silent WAV keepalive. That makes the browser/OS media-playback path easier to evaluate, but it is not yet proven on every Android/browser combination.

The app does not automatically resume audio after an interruption. This is intentional: it avoids fighting the OS when another app or a phone call takes audio focus.

## Cache updates

When changing files that are precached by the service worker, increment `CACHE_NAME` in `sw.js` so installed copies receive the new shell.
