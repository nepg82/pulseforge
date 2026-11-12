# PulseForge — audio foundation

This is the first clean PulseForge scaffold. It intentionally does not contain the Chillforge music generator. Chillforge is used as a reference for its proven playback machinery only.

## Install locally

1. Copy your existing `app-icons/app-icon-192.png` and `app-icons/app-icon-512.png` into this project's `app-icons/` folder.
2. Serve this folder from a local web server (ES modules and service workers do not work reliably from `file://`). For example, use the same local server workflow you use for your other PWAs.
3. Open `index.html`. Tap **Start test** and confirm the reference pulse plays at a moderate test level.
4. Tap the build stamp (`261112-1608`) to open live diagnostics. The stamp can be updated for each build.

## Included foundation

- Native Web Audio API; no Tone.js or third-party runtime dependencies.
- AudioContext uses `latencyHint: "playback"` and is reused across start/stop.
- Worker-driven scheduler: 50 ms wake interval, 500 ms audio-clock look-ahead, with a timer fallback.
- Near-silent looping WAV media keepalive, based on the working Chillforge approach.
- Media Session play/pause/stop actions for lock-screen and Bluetooth controls.
- Live engine diagnostics and context recovery attempts; event logging and log storage are disabled by default.
- Offline app-shell service worker.
- Build stamp opens diagnostics; Hard reset unregisters this app's service worker, clears only PulseForge caches, and reloads with a unique URL.

## Current scope

The reference pulse is only an engine test. No musical sequencer, instruments, styles, or settings have been added yet. The next milestone is to validate continuous playback, screen-lock behavior, and Bluetooth stability before adding the Chillwave sound engine.

## Cache versioning

When changing the offline app shell, increment `CACHE_NAME` in `sw.js`. The hard-reset control does not require a cache-version bump.
