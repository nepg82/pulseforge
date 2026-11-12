import { AudioEngine } from "./audio-engine.js";
import { PlaybackScheduler } from "./playback.js";
import { configureMediaSession, setMediaPlaybackState } from "./media-session.js";

const BUILD_STAMP = "261112-1608";
const CACHE_PREFIX = "pulseforge-";
const $ = id => document.getElementById(id);

// Event logging is intentionally disabled during normal development.
// Restore a logger here when actively investigating a specific issue.
function log(_message) {}

const engine = new AudioEngine({ onLog: log, onState: updateDiagnostics });
const scheduler = new PlaybackScheduler({
  getContext: () => engine.context,
  scheduleStep: (step, time) => {
    // Temporary reference pulse. The musical sequencer comes later.
    if (step % 4 === 0) engine.scheduleReferencePulse(time, step % 16 === 8 ? 247 : 220);
  },
  onLog: log,
  onState: running => { $("schedulerState").textContent = running ? "Running" : "Stopped"; }
});

function updateDiagnostics() {
  const d = engine.diagnostics;
  $("ctxState").textContent = d.context;
  $("sampleRate").textContent = d.sampleRate;
  $("baseLatency").textContent = d.baseLatency;
  $("outputLatency").textContent = d.outputLatency;
  $("keepaliveState").textContent = d.keepalive;
}
function setPlayingUI(playing) {
  $("playButton").textContent = playing ? "Stop test" : "Start test";
  $("playButton").classList.toggle("playing", playing);
  $("statusText").textContent = playing ? "Playing · engine test" : "Ready";
  $("statusDot").classList.toggle("active", playing);
  setMediaPlaybackState(playing ? "playing" : "paused");
}

async function start() {
  if (engine.playing) return;
  $("playButton").disabled = true;
  try {
    await engine.start();
    scheduler.start();
    setPlayingUI(true);
    log("Playback started by user.");
  } catch (error) {
    log(`Start failed: ${error.message}`);
    $("statusText").textContent = "Unable to start audio";
  } finally {
    $("playButton").disabled = false;
    updateDiagnostics();
  }
}
async function stop(reason = "user") {
  scheduler.stop();
  await engine.stop(reason);
  setPlayingUI(false);
  updateDiagnostics();
}

$("playButton").addEventListener("click", () => engine.playing ? stop() : start());
$("buildStamp").addEventListener("click", () => {
  const panel = $("diagnostics");
  panel.hidden = !panel.hidden;
  $("buildStamp").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) {
    $("logOutput").textContent = "Event logging is disabled. Live engine diagnostics remain available above.";
    updateDiagnostics();
    updateServiceWorkerStatus();
  }
});


async function hardReset() {
  if (!confirm("Unregister PulseForge's service worker, clear its offline cache, and reload from the server? Internet access is required.")) return;
  $("hardResetButton").disabled = true;
  try {
    await stop("hard reset");
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const appPath = new URL("./", location.href).pathname;
      for (const registration of registrations) {
        const scopePath = new URL(registration.scope).pathname;
        if (scopePath.startsWith(appPath)) await registration.unregister();
      }
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key)));
    }
    const freshUrl = new URL(location.href);
    freshUrl.searchParams.set("_hard", String(Date.now()));
    freshUrl.hash = "";
    location.replace(freshUrl.href);
  } catch (error) {
    log(`Hard reset failed: ${error.message}`);
    $("hardResetButton").disabled = false;
  }
}
$("hardResetButton").addEventListener("click", hardReset);

async function updateServiceWorkerStatus() {
  if (!("serviceWorker" in navigator)) {
    $("swState").textContent = "Unsupported";
    return;
  }
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appPath = new URL("./", location.href).pathname;
    const appRegistration = registrations.find(reg => new URL(reg.scope).pathname.startsWith(appPath));
    $("swState").textContent = appRegistration ? (appRegistration.active ? "Active" : "Registered") : "Not registered";
  } catch (error) {
    $("swState").textContent = "Unavailable";
    log(`Service worker status error: ${error.message}`);
  }
}

configureMediaSession({
  onPlay: start,
  onPause: () => stop("media session pause"),
  onStop: () => stop("media session stop"),
  onLog: log
});

document.addEventListener("visibilitychange", () => {
  log(`Visibility: ${document.visibilityState}`);
  if (!document.hidden && engine.playing) engine.resumeFromInterruption();
});
document.addEventListener("freeze", () => log("Page freeze event."));
document.addEventListener("resume", () => {
  log("Page resume event.");
  if (engine.playing) engine.resumeFromInterruption();
});
window.addEventListener("pagehide", () => log("Page hidden/unloaded."));
window.addEventListener("error", event => log(`Window error: ${event.message}`));
window.addEventListener("unhandledrejection", event => log(`Unhandled rejection: ${event.reason?.message || event.reason}`));

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    log("Service Worker API unavailable.");
    updateServiceWorkerStatus();
    return;
  }
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    log("Service worker registered.");
  } catch (error) {
    log(`Service worker registration failed: ${error.message}`);
  }
  updateServiceWorkerStatus();
}

$("buildStamp").textContent = BUILD_STAMP;
log(`PulseForge booted (${BUILD_STAMP}).`);
updateDiagnostics();
registerServiceWorker();
