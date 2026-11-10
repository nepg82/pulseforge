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
    this.startPromise = null;

    this.mediaElement.addEventListener("pause", () => {
      if (this.state !== "playing" || !this.engine.started) return;
      this.onLog("Media element paused outside PulseForge; yielding audio focus.");
      void this.handleExternalPause();
    });

    this.mediaElement.addEventListener("error", () => {
      this.onLog(`Media element error: ${this.mediaElement.error?.message || "unknown error"}`);
    });
  }

  async play() {
    if (this.state === "playing") return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      try {
        await this.engine.start(this.mediaElement);
        this.state = "playing";
        this.startedAt = Date.now();
        this.#startClock();
        this.onState(this.state, this.#elapsed());
      } catch (error) {
        this.state = "stopped";
        this.onState(this.state);
        this.onLog(`PLAY ERROR: ${error.message}`);
        throw error;
      } finally {
        this.startPromise = null;
      }
    })();
    return this.startPromise;
  }

  async pause() {
    if (this.state !== "playing") return;
    await this.engine.pause();
    this.#accumulateTime();
    this.#stopClock();
    this.state = "paused";
    this.onState(this.state, this.#elapsed());
  }

  async stop() {
    if (this.state === "stopped") return;
    await this.engine.stop();
    this.#stopClock();
    this.startedAt = 0;
    this.elapsedBeforeStart = 0;
    this.state = "stopped";
    this.onState(this.state, 0);
  }

  async toggle() {
    if (this.state === "playing") return this.pause();
    return this.play();
  }

  async changePattern(direction = 1) {
    return this.engine.changePattern(direction);
  }

  async handleExternalPause() {
    if (this.state !== "playing") return;
    this.#accumulateTime();
    this.#stopClock();
    this.state = "interrupted";
    await this.engine.suspendForInterruption();
    this.onState(this.state, this.#elapsed());
  }

  #elapsed() {
    return this.elapsedBeforeStart + (this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0);
  }

  #accumulateTime() {
    if (this.startedAt) {
      this.elapsedBeforeStart += Math.max(0, Date.now() - this.startedAt);
      this.startedAt = 0;
    }
  }

  #startClock() {
    this.#stopClock();
    this.sessionTimer = window.setInterval(() => this.onState(this.state, this.#elapsed()), 1000);
  }

  #stopClock() {
    if (this.sessionTimer !== null) window.clearInterval(this.sessionTimer);
    this.sessionTimer = null;
  }
}
