const ALBUM = "PulseForge — Playback Test";

export function setMediaMetadata(title) {
  if (!navigator.mediaSession || typeof window.MediaMetadata !== "function") return false;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: "PulseForge",
      album: ALBUM,
      artwork: [
        { src: "./app-icons/app-icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "./app-icons/app-icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    });
    return true;
  } catch (error) {
    console.warn("[PulseForge] Could not set media metadata:", error);
    return false;
  }
}

export function setMediaPlaybackState(state) {
  if (!navigator.mediaSession) return;
  try { navigator.mediaSession.playbackState = state; }
  catch (error) { console.warn("[PulseForge] Could not update media playback state:", error); }
}

export function setupMediaSession({ onPlay, onPause, onStop, onNext, onPrevious, onLog }) {
  if (!("mediaSession" in navigator)) {
    onLog("Media Session API unavailable in this browser; lock-screen/Bluetooth controls cannot be provided here.");
    return false;
  }

  setMediaMetadata("First Light");
  const handlers = { play: onPlay, pause: onPause, stop: onStop, nexttrack: onNext, previoustrack: onPrevious };
  let registered = 0;
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, () => {
        onLog(`Media Session action received: ${action}`);
        try {
          const result = handler?.();
          if (result && typeof result.catch === "function") {
            result.catch(error => onLog(`Media action ${action} failed: ${error.message}`));
          }
        } catch (error) {
          onLog(`Media action ${action} failed: ${error.message}`);
        }
      });
      registered++;
      onLog(`Media action registered: ${action}`);
    } catch (error) {
      onLog(`Media action unavailable (${action}): ${error.message}`);
    }
  }
  onLog(`Media Session ready: ${registered}/${Object.keys(handlers).length} actions registered.`);
  return registered > 0;
}
