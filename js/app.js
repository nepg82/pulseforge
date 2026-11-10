import { AudioEngine } from "./audio-engine.js";
import { PlaybackController } from "./playback.js";
import { setupMediaSession, setMediaMetadata, setMediaPlaybackState } from "./media-session.js";

const $ = id => document.getElementById(id);
const mediaElement = $("media-output");
const logElement = $("log");
const logLines = [];
const trackNames = ["First Light", "Blue Current", "Night Signal"];

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
    if (state === "interrupted" && controller) void controller.handleExternalPause();
  }
});

const controller = new PlaybackController({
  engine,
  mediaElement,
  onLog: log,
  onState: renderState
});

function renderState(state, elapsed) {
  $("status").dataset.state = state;
  $("status-text").textContent = state.toUpperCase();
  $("play-icon").className = state === "playing" ? "pause-icon" : "play-icon";
  $("play-label").textContent = state === "playing" ? "PAUSE" : "PLAY";
  $("play-button").setAttribute("aria-label", state === "playing" ? "Pause" : "Play");
  $("stop-button").disabled = state === "stopped";
  $("engine-state").textContent = engine.getInfo().contextState;
  $("output-state").textContent = engine.getInfo().outputConnected ? "Media element + Web Audio" : "Not connected";
  if (typeof elapsed === "number") $("session-time").textContent = formatTime(elapsed);
  setMediaPlaybackState(state === "playing" ? "playing" : (state === "stopped" ? "none" : "paused"));
  if (state === "interrupted") $("playback-hint").textContent = "Playback was interrupted. Press play to resume.";
  else if (state === "paused") $("playback-hint").textContent = "Paused. Your session is ready to resume.";
  else if (state === "playing") $("playback-hint").textContent = "Audio is running. You can lock the screen.";
  else $("playback-hint").textContent = "Tap play to start the audio engine.";
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateTrack(pattern) {
  const title = trackNames[pattern];
  $("track-title").textContent = title;
  $("track-subtitle").textContent = `Playback pattern ${pattern + 1} of ${trackNames.length}.`;
  setMediaMetadata(title);
  log(`Current pattern: ${title}.`);
}

async function changeTrack(direction) {
  const pattern = await controller.changePattern(direction);
  updateTrack(pattern);
}

$("play-button").addEventListener("click", async () => {
  try { await controller.toggle(); }
  catch (error) { $("playback-hint").textContent = error.message; }
});
$("stop-button").addEventListener("click", () => controller.stop().catch(error => log(`Stop failed: ${error.message}`)));
$("next-button").addEventListener("click", () => changeTrack(1).catch(error => log(`Next failed: ${error.message}`)));
$("previous-button").addEventListener("click", () => changeTrack(-1).catch(error => log(`Previous failed: ${error.message}`)));

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
  onPlay: () => controller.play(),
  onPause: () => controller.pause(),
  onStop: () => controller.stop(),
  onNext: () => changeTrack(1),
  onPrevious: () => changeTrack(-1),
  onLog: log
});

for (const eventName of ["visibilitychange"]) {
  document.addEventListener(eventName, () => log(`Visibility changed: ${document.visibilityState}; audio=${engine.getInfo().contextState}`));
}
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

log(`Media Session API: ${"mediaSession" in navigator ? "available" : "unavailable"}.`);
log(`MediaMetadata: ${typeof window.MediaMetadata === "function" ? "available" : "unavailable"}.`);
log(`PulseForge initialized; userAgent=${navigator.userAgent}`);
