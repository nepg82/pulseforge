export function configureMediaSession({ onPlay, onPause, onStop, onLog = () => {} }) {
  if (!("mediaSession" in navigator)) {
    onLog("Media Session API unavailable.");
    return;
  }
  try {
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "PulseForge",
        artist: "Chillwave audio engine test",
        album: "Offline generative audio",
        artwork: [
          { src: "./app-icons/app-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "./app-icons/app-icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      });
    }
    navigator.mediaSession.setActionHandler("play", onPlay);
    navigator.mediaSession.setActionHandler("pause", onPause);
    navigator.mediaSession.setActionHandler("stop", onStop);
    onLog("Media Session controls registered.");
  } catch (error) {
    onLog(`Media Session setup failed: ${error.message}`);
  }
}

export function setMediaPlaybackState(state) {
  if ("mediaSession" in navigator) {
    try { navigator.mediaSession.playbackState = state; } catch (_) {}
  }
}
