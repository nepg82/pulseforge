export class PlaybackController {
  constructor({ engine, mediaElement, onState, onLog }) {
    this.engine = engine;
    this.mediaElement = mediaElement;
    this.onState = onState;
    this.onLog = onLog;
    this.state = "stopped";
    this.startedAt = 0;
    this.elapsedBeforeStart = 0;
    this.sessionTimer = null;

    this.mediaElement.addEventListener("pause", () => {
      if (this.state === "playing") {
        this.onLog("Media element paused outside the app; treating this as an interruption.");
        this.state = "interrupted";
        this.onState(this.state);
      }
    });
    this.mediaElement.addEventListener("playing", () => {
      if (this.state === "interrupted") {
        this.onLog("Media element resumed by the browser or operating system.");
        this.state = "playing";
        this.startedAt = Date.now();
        this.onState(this.state);
      }
    });
    this.mediaElement.addEventListener("error", () => {
      this.onLog(`Media element error: ${this.mediaElement.error?.message || "unknown error"}`);
    });
  }

  async play() {
    try {
      await this.engine.start(this.mediaElement);
      this.state = "playing";
      this.startedAt = Date.now();
      this.#startClock();
      this.onState(this.state);
    } catch (error) {
      this.onLog(`PLAY ERROR: ${error.message}`);
      this.state = "stopped";
      this.onState(this.state);
      throw error;
    }
  }

  async pause() {
    await this.engine.pause();
    this.#accumulateTime();
    this.#stopClock();
    this.state = "paused";
    this.onState(this.state);
  }

  async stop() {
    this.#accumulateTime();
    this.#stopClock();
    await this.engine.stop();
    this.elapsedBeforeStart = 0;
    this.state = "stopped";
    this.onState(this.state);
  }

  async toggle() {
    if (this.state === "playing") return this.pause();
    return this.play();
  }

  async changePattern() {
    return this.engine.changePattern();
  }

  handleExternalPause() {
    if (this.state !== "playing") return;
    this.#accumulateTime();
    this.#stopClock();
    if (!this.mediaElement.paused) this.mediaElement.pause();
    this.state = "interrupted";
    this.onState(this.state);
  }

  #accumulateTime() {
    if (this.startedAt) {
      this.elapsedBeforeStart += Math.max(0, Date.now() - this.startedAt);
      this.startedAt = 0;
    }
  }

  #startClock() {
    this.#stopClock();
    this.sessionTimer = window.setInterval(() => {
      const elapsed = this.elapsedBeforeStart + (Date.now() - this.startedAt);
      this.onState(this.state, elapsed);
    }, 1000);
  }

  #stopClock() {
    if (this.sessionTimer) window.clearInterval(this.sessionTimer);
    this.sessionTimer = null;
  }
}
