/**
 * PulseForge audio engine — first sequenced-generation prototype.
 * A quiet looping media element keeps Android's media session alive; the
 * sequenced Web Audio instruments are mixed into the same output.
 */
export class AudioEngine {
  constructor({ onState = () => {}, onLog = () => {} } = {}) {
    this.onState = onState;
    this.onLog = onLog;
    this.context = null;
    this.mediaElement = null;
    this.mediaSource = null;
    this.keepAliveUrl = null;
    this.master = null;
    this.noiseBuffer = null;
    this.started = false;
    this.pattern = 0;
    this.step = 0;
    this.nextNoteTime = 0;
    this.schedulerTimer = null;
    this.lookAhead = 0.12;
    this.schedulerInterval = 25;
    this.patterns = [
      {
        name: "First Light", bpm: 110,
        kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
        snare:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
        hat:  [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
        bass: [55,null,55,null,82.4,null,55,null,73.4,null,55,null,98,null,82.4,null],
        lead: [220,null,261.6,null,329.6,null,261.6,null,392,null,329.6,null,261.6,null,220,null]
      },
      {
        name: "Blue Current", bpm: 118,
        kick: [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],
        snare:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
        hat:  [1,0,1,1,1,0,1,0,1,0,1,1,1,0,1,0],
        bass: [65.4,null,65.4,98,null,65.4,null,82.4,65.4,null,65.4,110,null,82.4,null,98],
        lead: [261.6,null,329.6,392,null,329.6,261.6,null,392,null,440,392,null,329.6,261.6,null]
      },
      {
        name: "Night Signal", bpm: 100,
        kick: [1,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0],
        snare:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
        hat:  [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],
        bass: [49,null,null,73.4,null,49,98,null,49,null,null,65.4,null,49,82.4,null],
        lead: [196,null,246.9,null,293.7,null,246.9,null,392,null,293.7,null,246.9,null,220,null]
      }
    ];
  }

  async start(mediaElement) {
    this.mediaElement = mediaElement;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");

    this.#prepareMediaElement();
    if (!this.context) this.#build(AudioContextClass);

    try {
      if (this.context.state !== "running") await this.context.resume();
      await this.mediaElement.play();
      this.started = true;
      this.step = 0;
      this.nextNoteTime = this.context.currentTime + 0.05;
      this.#startScheduler();
      this.onState("playing");
      this.onLog(`Sequencer started: ${this.patterns[this.pattern].name}, ${this.patterns[this.pattern].bpm} BPM.`);
      return this.getInfo();
    } catch (error) {
      this.started = false;
      this.#stopScheduler();
      if (this.context?.state === "running") await this.context.suspend();
      throw error;
    }
  }

  #prepareMediaElement() {
    if (this.mediaElement.src) return;
    const blob = this.#makeQuietLoop();
    this.keepAliveUrl = URL.createObjectURL(blob);
    this.mediaElement.src = this.keepAliveUrl;
    this.mediaElement.loop = true;
    this.mediaElement.preload = "auto";
    this.mediaElement.playsInline = true;
    this.mediaElement.load();
    this.onLog("Prepared quiet looping media source for Android media playback.");
  }

  #makeQuietLoop() {
    const sampleRate = 8000;
    const seconds = 20;
    const sampleCount = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const writeText = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i++) {
      view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 20 * i) / sampleRate) * 2), true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  #build(AudioContextClass) {
    const ctx = new AudioContextClass();
    const master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);

    this.mediaSource = ctx.createMediaElementSource(this.mediaElement);
    this.mediaSource.connect(master);
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;

    this.context = ctx;
    this.master = master;
    ctx.onstatechange = () => {
      this.onLog(`AudioContext state: ${ctx.state}`);
      if (ctx.state === "suspended" && this.started) this.onState("interrupted");
    };
    const baseLatency = Number.isFinite(ctx.baseLatency) ? `${Math.round(ctx.baseLatency * 1000)} ms` : "unavailable";
    const outputLatency = Number.isFinite(ctx.outputLatency) ? `${Math.round(ctx.outputLatency * 1000)} ms` : "unavailable";
    this.onLog(`Audio graph ready; sampleRate=${ctx.sampleRate}; baseLatency=${baseLatency}; outputLatency=${outputLatency}.`);
    this.onLog("Sequenced synth uses a stronger midrange mix for small and bone-conduction headphones.");
  }

  #startScheduler() {
    this.#stopScheduler();
    this.schedulerTimer = window.setInterval(() => this.#schedulerTick(), this.schedulerInterval);
    this.#schedulerTick();
  }

  #stopScheduler() {
    if (this.schedulerTimer !== null) window.clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
  }

  #schedulerTick() {
    if (!this.started || !this.context || this.context.state !== "running") return;
    const now = this.context.currentTime;
    if (this.nextNoteTime < now - 0.15) {
      this.onLog("Scheduler recovered from a late tick; skipped stale steps to avoid a burst.");
      this.nextNoteTime = now + 0.03;
    }
    const pattern = this.patterns[this.pattern];
    const stepDuration = 60 / pattern.bpm / 4;
    while (this.nextNoteTime < now + this.lookAhead) {
      this.#scheduleStep(this.step, this.nextNoteTime, pattern);
      this.nextNoteTime += stepDuration;
      this.step = (this.step + 1) % 16;
    }
  }

  #scheduleStep(step, time, pattern) {
    if (pattern.kick[step]) this.#kick(time);
    if (pattern.snare[step]) this.#noiseHit(time, 0.12, 1800, 0.13);
    if (pattern.hat[step]) this.#noiseHit(time, 0.045, 7800, 0.045);
    const bassNote = pattern.bass[step];
    if (bassNote) this.#tone(time, bassNote, 0.19, "sawtooth", 620, 0.13);
    const leadNote = pattern.lead[step];
    if (leadNote) this.#tone(time, leadNote, 0.14, "triangle", 1900, 0.075);
  }

  #kick(time) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(135, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.13);
    gain.gain.setValueAtTime(0.72, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.29);
  }

  #tone(time, frequency, duration, type, cutoff, peak) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + duration + 0.015);
  }

  #noiseHit(time, duration, cutoff, peak) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(cutoff, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  async pause() {
    this.started = false;
    this.#stopScheduler();
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Playback paused; sequencer clock suspended.");
  }

  async suspendForInterruption() {
    this.started = false;
    this.#stopScheduler();
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Audio engine suspended after an external interruption.");
  }

  async stop() {
    await this.pause();
    if (this.mediaElement) {
      try { this.mediaElement.currentTime = 0; } catch {}
    }
    this.step = 0;
    this.onLog("Playback stopped; audio graph kept ready for the next start.");
  }

  async changePattern(direction = 1) {
    this.pattern = (this.pattern + direction + this.patterns.length) % this.patterns.length;
    this.step = 0;
    if (this.context && this.started) this.nextNoteTime = this.context.currentTime + 0.04;
    this.onLog(`Pattern changed to ${this.patterns[this.pattern].name} (${this.patterns[this.pattern].bpm} BPM).`);
    return this.pattern;
  }

  getInfo() {
    return {
      contextState: this.context?.state ?? "not created",
      sampleRate: this.context?.sampleRate ?? null,
      outputConnected: Boolean(this.master),
      pattern: this.pattern + 1,
      bpm: this.patterns[this.pattern].bpm
    };
  }
}
