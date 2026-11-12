const LOOKAHEAD_SECONDS = 0.5;
const WORKER_TICK_MS = 50;
const STEP_SECONDS = 0.25;

export class PlaybackScheduler {
  constructor({ getContext, scheduleStep, onLog = () => {}, onState = () => {} }) {
    this.getContext = getContext;
    this.scheduleStep = scheduleStep;
    this.onLog = onLog;
    this.onState = onState;
    this.worker = null;
    this.workerUrl = null;
    this.fallbackTimer = null;
    this.running = false;
    this.stepSeconds = STEP_SECONDS;
    this.step = 0;
    this.nextTime = 0;
    this.tick = this.tick.bind(this);
  }

  setBpm(bpm) {
    const safe = Math.max(40, Math.min(120, Number(bpm) || 60));
    this.stepSeconds = 60 / safe / 4;
  }

  start() {
    if (this.running) return;
    const context = this.getContext();
    if (!context) throw new Error("AudioContext is not initialized.");
    this.running = true;
    this.step = 0;
    this.nextTime = context.currentTime + 0.1;
    this.startWorker();
    this.onState(true);
    this.onLog("Scheduler started (Worker 50 ms / 500 ms look-ahead).");
    this.tick();
  }

  startWorker() {
    if (typeof Worker === "function") {
      try {
        const source = `let timer=null;onmessage=event=>{if(event.data==='start'){clearInterval(timer);timer=setInterval(()=>postMessage(0),${WORKER_TICK_MS});}else if(event.data==='stop'){clearInterval(timer);timer=null;}};`;
        this.workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        this.worker = new Worker(this.workerUrl);
        this.worker.onmessage = this.tick;
        this.worker.postMessage("start");
        return;
      } catch (error) {
        this.onLog(`Worker unavailable; using timer fallback: ${error.message}`);
      }
    }
    this.fallbackTimer = setInterval(this.tick, WORKER_TICK_MS);
  }

  tick() {
    if (!this.running) return;
    const context = this.getContext();
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    if (this.nextTime < now - 0.1) {
      this.onLog(`Scheduler resync (${Math.round((now - this.nextTime) * 1000)} ms late).`);
      this.nextTime = now + 0.05;
    }
    while (this.nextTime < now + LOOKAHEAD_SECONDS) {
      try { this.scheduleStep(this.step, this.nextTime); }
      catch (error) { this.onLog(`Scheduler step ${this.step} failed: ${error.message}`); }
      this.nextTime += this.stepSeconds;
      this.step = (this.step + 1) % 16;
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.worker) {
      this.worker.postMessage("stop");
      this.worker.terminate();
      this.worker = null;
    }
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    this.onState(false);
    this.onLog("Scheduler stopped.");
  }
}
