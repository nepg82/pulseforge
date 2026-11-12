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
    this.noiseBuffer = null;
    this.drumLevels = { kick: 0.65, snare: 0.45, hat: 0.22 };
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
      this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const noiseData = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
      this.master = this.context.createGain();
      this.master.gain.value = 0.6;
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
    this.master.gain.setTargetAtTime(enabled ? 0.6 : 0, this.context.currentTime, 0.04);
  }


  schedulePadChord(time, chordIndex = 0) {
    if (!this.context || !this.filter || this.yielded) return;

    // Am9 → Fmaj7 → Cmaj9 → G6/9. Compact mid-register voicings keep the pad warm, not boomy.
    const progression = [
      [57, 60, 64, 67, 71], // A3 C4 E4 G4 B4
      [57, 60, 64, 65, 69], // A3 C4 E4 F4 A4
      [55, 59, 60, 64, 67], // G3 B3 C4 E4 G4
      [55, 59, 62, 64, 69]  // G3 B3 D4 E4 A4
    ];
    const notes = progression[chordIndex % progression.length];
    const duration = 4.6;
    const attack = 0.7;
    // Hold the chord until the next measure, then crossfade over 0.6 seconds.
    const releaseStart = 4.0;
    const releaseEnd = duration;

    for (const midi of notes) {
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      const sine = this.context.createOscillator();
      const triangle = this.context.createOscillator();
      const sineGain = this.context.createGain();
      const triangleGain = this.context.createGain();

      sine.type = "sine";
      triangle.type = "triangle";
      sine.frequency.setValueAtTime(frequency, time);
      triangle.frequency.setValueAtTime(frequency, time);

      for (const gain of [sineGain.gain, triangleGain.gain]) {
        gain.setValueAtTime(0.0001, time);
        gain.exponentialRampToValueAtTime(gain === sineGain.gain ? 0.09 : 0.022, time + attack);
        gain.setValueAtTime(gain === sineGain.gain ? 0.09 : 0.022, time + releaseStart);
        gain.exponentialRampToValueAtTime(0.0001, time + releaseEnd);
      }

      sine.connect(sineGain).connect(this.filter);
      triangle.connect(triangleGain).connect(this.filter);
      sine.start(time);
      triangle.start(time);
      sine.stop(time + releaseEnd + 0.03);
      triangle.stop(time + releaseEnd + 0.03);
      const cleanup = () => {
        sine.disconnect();
        triangle.disconnect();
        sineGain.disconnect();
        triangleGain.disconnect();
      };
      sine.addEventListener("ended", cleanup, { once: true });
    }
  }

  setDrumLevel(instrument, value) {
    if (instrument in this.drumLevels) {
      this.drumLevels[instrument] = Math.max(0, Math.min(1, Number(value) || 0));
    }
  }

  scheduleDrumStep(step, time) {
    if (!this.context || !this.filter || this.yielded) return;
    // The pad scheduler stays at its existing rate. Drums use every other
    // scheduler step, giving them a 0.5-second beat interval (60 BPM).
    if (step % 2 !== 0) return;
    const index = (step / 2) % 16;
    const levels = this.drumLevels;
    const gain = 3.1;

    // Same two-bar pattern, stretched to half the previous drum tempo.
    if ([0, 4, 8, 12].includes(index) && levels.kick > 0) {
      this.scheduleKick(time, levels.kick * gain, index === 0 || index === 8 ? 1 : 0.88);
    }
    if ([2, 6, 10, 14].includes(index) && levels.snare > 0) {
      this.scheduleSnare(time, levels.snare * gain, 0.82);
    }
    if (levels.hat > 0) {
      const accent = index % 4 === 0 ? 0.72 : (index % 2 === 0 ? 0.48 : 0.30);
      this.scheduleHat(time, levels.hat * gain, accent);
    }
  }

  scheduleKick(time, level, velocity = 1) {
    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(118, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.17);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.28 * level * velocity, time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.30);
    osc.connect(amp).connect(this.filter);
    osc.start(time);
    osc.stop(time + 0.32);
    osc.addEventListener("ended", () => { osc.disconnect(); amp.disconnect(); }, { once: true });
  }

  scheduleSnare(time, level, velocity = 1) {
    const noise = this.context.createBufferSource();
    const tone = this.context.createOscillator();
    const noiseFilter = this.context.createBiquadFilter();
    const noiseAmp = this.context.createGain();
    const toneAmp = this.context.createGain();
    noise.buffer = this.noiseBuffer;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1850, time);
    noiseFilter.Q.value = 0.75;
    noiseAmp.gain.setValueAtTime(0.0001, time);
    noiseAmp.gain.exponentialRampToValueAtTime(0.145 * level * velocity, time + 0.004);
    noiseAmp.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
    tone.type = "sine";
    tone.frequency.setValueAtTime(190, time);
    tone.frequency.exponentialRampToValueAtTime(135, time + 0.09);
    toneAmp.gain.setValueAtTime(0.0001, time);
    toneAmp.gain.exponentialRampToValueAtTime(0.055 * level * velocity, time + 0.003);
    toneAmp.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    noise.connect(noiseFilter).connect(noiseAmp).connect(this.filter);
    tone.connect(toneAmp).connect(this.filter);
    noise.start(time);
    noise.stop(time + 0.20);
    tone.start(time);
    tone.stop(time + 0.13);
    noise.addEventListener("ended", () => {
      noise.disconnect(); noiseFilter.disconnect(); noiseAmp.disconnect();
    }, { once: true });
    tone.addEventListener("ended", () => { tone.disconnect(); toneAmp.disconnect(); }, { once: true });
  }

  scheduleHat(time, level, velocity = 1) {
    const noise = this.context.createBufferSource();
    const highpass = this.context.createBiquadFilter();
    const amp = this.context.createGain();
    noise.buffer = this.noiseBuffer;
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(4600, time);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.052 * level * velocity, time + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    noise.connect(highpass).connect(amp).connect(this.filter);
    noise.start(time);
    noise.stop(time + 0.06);
    noise.addEventListener("ended", () => {
      noise.disconnect(); highpass.disconnect(); amp.disconnect();
    }, { once: true });
  }

  scheduleReferencePulse(time, frequency = 220) {
    if (!this.context || !this.filter || this.yielded) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(0.3, time + 0.018);
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
    this.master = this.filter = this.compressor = this.noiseBuffer = null;
  }
}
