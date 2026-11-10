import { AudioEngine } from "./audio-engine.js";
import { PlaybackController } from "./playback.js";
import { setupMediaSession, setMediaPlaybackState } from "./media-session.js";

const $ = id => document.getElementById(id);
const mediaElement = $("media-output");
const logElement = $("log");
const logLines = [];
const startedAt = Date.now();

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  logLines.push(`[${stamp}] ${message}`);
  if (logLines.length > 180) logLines.shift();
  logElement.textContent = logLines.join("\n");
  logElement.scrollTop = logElement.scrollHeight;
  console.info(`[PulseForge] ${message}`);
}

const engine = new AudioEngine({
  onLog: log,
  onState: state => {
    if (state === "interrupted" && controller) controller.handleExternalPause();
  }
});

const controller = new PlaybackController({
  engine,
  mediaElement,
  onLog: log,
  onState: (state, elapsed) => renderState(state, elapsed)
});

function renderState(state, elapsed) {
  $("status").dataset.state = state;
  $("status-text").textContent = state.toUpperCase();
  $("signal-state").textContent = state === "playing" ? "LIVE" : state.toUpperCase();
  $("visualizer").classList.toggle("is-playing", state === "playing");
  $("play-icon").className = state === "playing" ? "pause-icon" : "play-icon";
  $("play-label").textContent = state === "playing" ? "PAUSE" : "PLAY";
  $("play-button").setAttribute("aria-label", state === "playing" ? "Pause" : "Play");
  $("stop-button").disabled = state === "stopped";
  $("engine-state").textContent = engine.getInfo().contextState;
  $("output-state").textContent = engine.getInfo().outputConnected ? "Media stream" : "Not connected";
  if (typeof elapsed === "number") $("session-time").textContent = formatTime(elapsed);
  setMediaPlaybackState(state === "playing" ? "playing" : (state === "stopped" ? "none" : "paused"));
  if (state === "interrupted") $("playback-hint").textContent = "Playback was interrupted. Press play to resume.";
  else if (state === "paused") $("playback-hint").textContent = "Paused. Your session is ready to resume.";
  else if (state === "playing") $("playback-hint").textContent = "Audio is running. Try locking the screen.";
  else $("playback-hint").textContent = "Tap play to start the audio engine.";
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

$("play-button").addEventListener("click", async () => {
  try { await controller.toggle(); }
  catch (error) { $("playback-hint").textContent = error.message; }
});
$("stop-button").addEventListener("click", () => controller.stop());
$("next-button").addEventListener("click", async () => {
  const pattern = await controller.changePattern();
  const names = ["First Light", "Blue Current", "Night Signal"];
  $("track-title").textContent = names[pattern];
  $("track-subtitle").textContent = `Playback pattern ${pattern + 1} of 3.`;
  if ("mediaSession" in navigator && "MediaMetadata" in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: names[pattern], artist: "PulseForge", album: "Milestone 1 — Playback Test"
    });
  }
});

$("diagnostics-toggle").addEventListener("click", () => {
  const button = $("diagnostics-toggle");
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  $("diagnostics-body").hidden = expanded;
});
$("copy-log").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(logLines.join("\n"));
    log("Diagnostics copied to clipboard.");
  } catch (error) { log(`Clipboard unavailable: ${error.message}`); }
});
$("clear-log").addEventListener("click", () => {
  logLines.length = 0;
  logElement.textContent = "";
  log("Log cleared.");
});

setupMediaSession({
  onPlay: () => controller.play().catch(error => log(`Media play failed: ${error.message}`)),
  onPause: () => controller.pause(),
  onStop: () => controller.stop(),
  onNext: async () => {
    const pattern = await controller.changePattern();
    const title = ["First Light", "Blue Current", "Night Signal"][pattern];
    $("track-title").textContent = title;
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "PulseForge", album: "Milestone 1 — Playback Test" });
    }
  },
  onPrevious: async () => {
    // Previous cycles backward through the three simple test patterns.
    engine.pattern = (engine.pattern + 2) % 3;
    const pattern = engine.pattern;
    if (engine.context && engine.master) {
      const settings = [
        { bass: 55, lead: 110, filter: 520, level: .18 },
        { bass: 65.4, lead: 130.8, filter: 760, level: .16 },
        { bass: 49, lead: 98, filter: 390, level: .20 }
      ][pattern];
      const now = engine.context.currentTime;
      engine.nodes[0].frequency.setTargetAtTime(settings.bass, now, .18);
      engine.nodes[3].frequency.setTargetAtTime(settings.lead, now, .18);
      engine.nodes[4].frequency.setTargetAtTime(settings.filter, now, .25);
      engine.master.gain.setTargetAtTime(settings.level, now, .2);
    }
    const title = ["First Light", "Blue Current", "Night Signal"][pattern];
    $("track-title").textContent = title;
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "PulseForge", album: "Milestone 1 — Playback Test" });
    }
  },
  onLog: log
});

document.addEventListener("visibilitychange", () => {
  log(`Visibility changed: ${document.visibilityState}; audio=${engine.getInfo().contextState}`);
});
window.addEventListener("pagehide", () => log("Pagehide event."));
window.addEventListener("pageshow", event => log(`Pageshow event; persisted=${event.persisted}.`));
window.addEventListener("online", () => log("Network online."));
window.addEventListener("offline", () => log("Network offline."));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      log(`Service worker registered: ${registration.scope}`);
      $("install-state").textContent = "OFFLINE READY";
    } catch (error) {
      log(`Service worker registration failed: ${error.message}`);
    }
  });
} else {
  log("Service worker unavailable here; serve from HTTPS or localhost to test install/offline.");
}

if (navigator.mediaSession) {
  log("Media Session API detected.");
} else {
  log("Media Session API not detected.");
}
log(`PulseForge initialized; userAgent=${navigator.userAgent}`);
