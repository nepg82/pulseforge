# PulseForge — audio foundation

This is the first clean PulseForge scaffold. It intentionally does not contain the Chillforge music generator. Chillforge is used as a reference for its proven playback machinery only.

## Install locally

1. Copy your existing `app-icons/app-icon-192.png` and `app-icons/app-icon-512.png` into this project's `app-icons/` folder.
2. Serve this folder from a local web server (ES modules and service workers do not work reliably from `file://`). For example, use the same local server workflow you use for your other PWAs.
3. Open `index.html`. Tap **Start test** and confirm the reference pulse plays at a moderate test level.
4. Tap the build stamp (`261112-1755`) to open live diagnostics. The stamp can be updated for each build.

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

Milestone 0.2.0 adds the first musical layer: a repeating four-chord Chillwave pad (Am9 → Fmaj7 → Cmaj9 → G6/9), built from quiet sine and triangle oscillators with overlapping chord releases for smooth transitions. Drums, melody, energy controls, and sound-shaping settings are not included yet.

## Cache versioning

When changing the offline app shell, increment `CACHE_NAME` in `sw.js` (currently `pulseforge-shell-v0.2.0`). The hard-reset control does not require a cache-version bump.


## 0.3.0 – Drum layer

- Added synthesized kick, snare, and closed hi-hat sounds.
- Added a relaxed two-bar backbeat with independent level controls and an on/off switch.
- Pad progression and playback infrastructure remain unchanged.
- Event logging remains disabled.


### 0.3.1
- Drum step interval doubled to 0.5 seconds (60 BPM); pad timing is unchanged.
- Drum voice amplitudes increased to 175% of the previous values.


### 0.3.2
- Increased drum voice gain so the level controls should reach a useful listening level around the middle of their range.
- Lowered the hi-hat high-pass cutoff from 6.8 kHz to 4.6 kHz to reduce its sharpness.
- Shortened pad attack from 1.05 to 0.7 seconds and held each chord until the next measure, with a 0.6-second crossfade.
- Drum tempo, pad measure timing, chord progression, and playback architecture are unchanged.


## 0.3.3 changes
- Raised the kick pitch contour (148 Hz down to 68 Hz) to reduce sub-bass weight without changing its level.
- Corrected the drum pulse to a true 60 BPM, aligned with the four-second pad measure.
- Added restrained syncopation: quiet anticipatory kick/snare notes and softer offbeat hi-hats.


## 0.3.4
- Restored the original kick pitch sweep (118 Hz down to 46 Hz).
- Preserved the 60 BPM syncopated drum groove from 0.3.3.
- Added a pad waveform selector: Sine + Triangle (default), Sine, or Triangle.
- Bumped the service-worker cache to v0.3.4.
