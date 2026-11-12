const KEEPALIVE_RATE = 8000;
const KEEPALIVE_SECONDS = 10;

function makeSilentWavUrl() {
  const samples = KEEPALIVE_RATE * KEEPALIVE_SECONDS;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, KEEPALIVE_RATE, true);
  view.setUint32(28, KEEPALIVE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  // Tiny non-zero samples make this a real media stream without audible output.
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export class AudioEngine {
  constructor({ onLog = () => {}, onState = () => {} } = {}) {
    this.onLog = onLog;
    this.onState = onState;
    this.context = null;
    this.master = null;
    this.filter = null;
    this.compressor = null;
    this.keepalive = null;
    this.keepaliveUrl = null;
    this.playing = false;
    this.yielded = false;
    this.yieldTimer = null;
    this.yieldGraceMs = 45000;
  }

  get diagnostics() {
    const c = this.context;
    return {
      context: c?.state ?? "Not created",
      sampleRate: c ? `${c.sampleRate} Hz` : "—",
      baseLatency: c?.baseLatency ? `${(c.baseLatency * 1000).toFixed(1)} ms` : "—",
      outputLatency: c?.outputLatency ? `${(c.outputLatency * 1000).toFixed(1)} ms` : "—",
      keepalive: this.keepalive ? (this.keepalive.paused ? "Paused" : "Playing") : "Stopped"
    };
  }

  async initialize() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is not supported by this browser.");
      this.context = new AudioContextClass({ latencyHint: "playback" });
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 8;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.18;
      this.filter = this.context.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 14000;
      this.filter.connect(this.compressor);
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.compressor.connect(this.master).connect(this.context.destination);
      this.context.addEventListener("statechange", () => {
        this.onLog(`AudioContext state: ${this.context.state}`);
        this.onState(this.diagnostics);
        if (this.playing && this.context.state !== "running") {
          this.context.resume().catch(error => this.onLog(`Resume failed: ${error.message}`));
        }
      });
    }
    if (!this.keepalive) this.createKeepalive();
    await this.context.resume();
    this.onState(this.diagnostics);
  }

  createKeepalive() {
    this.keepaliveUrl = makeSilentWavUrl();
    this.keepalive = new Audio(this.keepaliveUrl);
    this.keepalive.loop = true;
    this.keepalive.preload = "auto";
    this.keepalive.addEventListener("pause", () => this.handleKeepalivePause());
    this.keepalive.addEventListener("play", () => {
      if (this.playing && this.yielded) {
        this.yielded = false;
        clearTimeout(this.yieldTimer);
        this.setAudible(true);
        this.onLog("Media keepalive resumed; audio restored.");
      }
      this.onState(this.diagnostics);
    });
    ["waiting", "stalled", "error"].forEach(type => {
      this.keepalive.addEventListener(type, () => this.onLog(`Keepalive event: ${type}`));
    });
  }

  async start() {
    if (this.playing) return;
    await this.initialize();
    this.yielded = false;
    this.playing = true;
    this.setAudible(true);
    try {
      await this.keepalive.play();
      this.onLog("Silent media keepalive started.");
    } catch (error) {
      this.onLog(`Keepalive play rejected: ${error.message}`);
    }
    this.onLog(`Audio ready: ${this.context.sampleRate} Hz; base latency ${(this.context.baseLatency || 0).toFixed(3)} s.`);
    this.onState(this.diagnostics);
  }

  handleKeepalivePause() {
    if (!this.playing || this.yielded) return;
    this.yielded = true;
    this.setAudible(false);
    this.onLog("System paused media keepalive; yielding audio output.");
    clearTimeout(this.yieldTimer);
    this.yieldTimer = setTimeout(() => {
      if (this.playing && this.yielded) this.stop("media keepalive paused for 45 seconds");
    }, this.yieldGraceMs);
  }

  setAudible(enabled) {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(enabled ? 0.18 : 0, this.context.currentTime, 0.04);
  }

  scheduleReferencePulse(time, frequency = 220) {
    if (!this.context || !this.filter || this.yielded) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(0.12, time + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    oscillator.connect(envelope).connect(this.filter);
    oscillator.start(time);
    oscillator.stop(time + 0.26);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      envelope.disconnect();
    }, { once: true });
  }

  async stop(reason = "user") {
    if (!this.playing) return;
    this.playing = false;
    this.yielded = false;
    clearTimeout(this.yieldTimer);
    this.setAudible(false);
    if (this.keepalive && !this.keepalive.paused) this.keepalive.pause();
    this.onLog(`Playback stopped: ${reason}.`);
    this.onState(this.diagnostics);
  }

  async resumeFromInterruption() {
    if (!this.playing || !this.context) return;
    if (this.context.state !== "running") {
      try { await this.context.resume(); }
      catch (error) { this.onLog(`Context resume failed: ${error.message}`); }
    }
    if (this.keepalive?.paused && !this.yielded) {
      try { await this.keepalive.play(); }
      catch (error) { this.onLog(`Keepalive resume failed: ${error.message}`); }
    }
    this.onState(this.diagnostics);
  }

  async destroy() {
    await this.stop("engine destroyed");
    if (this.keepalive) {
      this.keepalive.src = "";
      this.keepalive.load();
      this.keepalive = null;
    }
    if (this.keepaliveUrl) URL.revokeObjectURL(this.keepaliveUrl);
    this.keepaliveUrl = null;
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.master = this.filter = this.compressor = null;
  }
}
