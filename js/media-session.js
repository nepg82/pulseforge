export function setupMediaSession({ onPlay, onPause, onStop, onNext, onPrevious, onLog }) {
  if (!("mediaSession" in navigator)) {
    onLog("Media Session API unavailable; Bluetooth/lock-screen controls may not appear.");
    return false;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "First Light",
      artist: "PulseForge",
      album: "Milestone 1 — Playback Test"
    });
  } catch (error) {
    onLog(`Media metadata unavailable: ${error.message}`);
  }

  const handlers = {
    play: onPlay,
    pause: onPause,
    stop: onStop,
    nexttrack: onNext,
    previoustrack: onPrevious
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      onLog(`Media action "${action}" unavailable: ${error.message}`);
    }
  }
  onLog("Media Session handlers registered.");
  return true;
}

export function setMediaPlaybackState(state) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {}
}
