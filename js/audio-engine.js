/** PulseForge sequenced audio engine. */
export class AudioEngine {
  constructor({ onState = () => {}, onLog = () => {} } = {}) {
    this.onState = onState;
    this.onLog = onLog;
    this.context = null;
    this.mediaElement = null;
    this.mediaSource = null;
    this.keepAliveUrl = null;
    this.master = null;
    this.started = false;
    this.pattern = 0;
    this.step = 0;
    this.nextNoteTime = 0;
    this.schedulerTimer = null;
    this.schedulerWorker = null;
    this.lookAhead = 0.5;
    this.schedulerInterval = 50;
    this.drumBuffers = null;
    this.bassVoices = [];
    this.leadVoices = [];
    this.bassVoiceIndex = 0;
    this.leadVoiceIndex = 0;
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
      this.nextNoteTime = this.context.currentTime + 0.08;
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
    const sampleRate = 8000, seconds = 20, sampleCount = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + sampleCount * 2), view = new DataView(buffer);
    const writeText = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    writeText(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); writeText(8, "WAVE");
    writeText(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, "data"); view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 20 * i / sampleRate) * 2), true);
    return new Blob([buffer], { type: "audio/wav" });
  }

  #build(AudioContextClass) {
    const ctx = new AudioContextClass(), master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    this.master = master;
    this.mediaSource = ctx.createMediaElementSource(this.mediaElement);
    this.mediaSource.connect(master);

    this.drumBuffers = {
      kick: this.#makeKickBuffer(ctx),
      snare: this.#makeNoiseBuffer(ctx, 0.14, 1800, 0.13, true),
      hat: this.#makeNoiseBuffer(ctx, 0.05, 7800, 0.045, false)
    };
    this.bassVoices = [this.#makeSynthVoice(ctx, "sawtooth", 620), this.#makeSynthVoice(ctx, "sawtooth", 620)];
    this.leadVoices = [this.#makeSynthVoice(ctx, "triangle", 1900), this.#makeSynthVoice(ctx, "triangle", 1900)];

    this.context = ctx;
    this.master = master;
    ctx.onstatechange = () => {
      this.onLog(`AudioContext state: ${ctx.state}`);
      if (ctx.state === "suspended" && this.started) this.onState("interrupted");
    };
    const baseLatency = Number.isFinite(ctx.baseLatency) ? `${Math.round(ctx.baseLatency * 1000)} ms` : "unavailable";
    const outputLatency = Number.isFinite(ctx.outputLatency) ? `${Math.round(ctx.outputLatency * 1000)} ms` : "unavailable";
    this.onLog(`Audio graph ready; sampleRate=${ctx.sampleRate}; baseLatency=${baseLatency}; outputLatency=${outputLatency}.`);
    this.onLog("Audio voices prebuilt; drum hits use rendered samples to minimize runtime node creation.");
  }

  #makeSynthVoice(ctx, oscillatorType, cutoff) {
    const oscillator = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    oscillator.type = oscillatorType;
    oscillator.frequency.value = 110;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.value = 0.0001;
    oscillator.connect(filter).connect(gain).connect(this.master ?? ctx.destination);
    oscillator.start();
    return { oscillator, filter, gain };
  }

  #makeKickBuffer(ctx) {
    const length = Math.floor(ctx.sampleRate * 0.30);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const frequency = t < 0.13 ? 135 * Math.pow(48 / 135, t / 0.13) : 48;
      phase += 2 * Math.PI * frequency / ctx.sampleRate;
      data[i] = Math.sin(phase) * 0.72 * Math.exp(-t * 14);
    }
    return buffer;
  }

  #makeNoiseBuffer(ctx, seconds, cutoff, peak, snare) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let previousInput = 0, previousOutput = 0;
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / ctx.sampleRate;
    const alpha = rc / (rc + dt);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const input = Math.random() * 2 - 1;
      const high = alpha * (previousOutput + input - previousInput);
      previousInput = input;
      previousOutput = high;
      const envelope = snare ? Math.exp(-t * 28) : Math.exp(-t * 90);
      const body = snare ? Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 24) * 0.18 : 0;
      data[i] = (high * (snare ? 0.82 : 1) + body) * peak * envelope;
    }
    return buffer;
  }

  #startScheduler() {
    this.#stopScheduler();
    if (typeof Worker === "function") {
      try {
        this.schedulerWorker ??= new Worker(new URL("./scheduler-worker.js", import.meta.url));
        this.schedulerWorker.onmessage = event => { if (event.data === "tick") this.#schedulerTick(); };
        this.schedulerWorker.onerror = error => {
          this.onLog(`Scheduler worker failed; using page timer fallback: ${error.message || "worker error"}.`);
          this.schedulerWorker?.terminate();
          this.schedulerWorker = null;
          if (this.started && this.schedulerTimer === null) {
            this.schedulerTimer = window.setInterval(() => this.#schedulerTick(), this.schedulerInterval);
          }
        };
        this.schedulerWorker.postMessage("start");
        this.onLog("Scheduler worker started (50 ms tick; 500 ms audio lookahead).");
        this.#schedulerTick();
        return;
      } catch (error) {
        this.onLog(`Scheduler worker unavailable; using page timer fallback: ${error.message}.`);
      }
    }
    this.schedulerTimer = window.setInterval(() => this.#schedulerTick(), this.schedulerInterval);
    this.#schedulerTick();
  }

  #stopScheduler() {
    if (this.schedulerTimer !== null) window.clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    if (this.schedulerWorker) this.schedulerWorker.postMessage("stop");
  }

  #schedulerTick() {
    if (!this.started || !this.context || this.context.state !== "running") return;
    const now = this.context.currentTime;
    if (this.nextNoteTime < now - 0.5) {
      const lateBy = Math.round((now - this.nextNoteTime) * 1000);
      this.onLog(`Scheduler was ${lateBy} ms behind; resynchronizing.`);
      this.nextNoteTime = now + 0.05;
    }
    const pattern = this.patterns[this.pattern];
    const stepDuration = 60 / pattern.bpm / 4;
    while (this.nextNoteTime < now + this.lookAhead) {
      this.#scheduleStep(this.step, this.nextNoteTime, pattern);
      this.nextNoteTime += stepDuration;
      this.step = (this.step + 1) % 16;
    }
  }

  #playSample(buffer, time) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.start(time);
  }

  #playSynth(voices, indexName, frequency, time, duration, peak) {
    const index = this[indexName] % voices.length;
    this[indexName]++;
    const voice = voices[index];
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(0.0001, time);
    gain.linearRampToValueAtTime(peak, time + 0.012);
    gain.exponentialRampToValueAtTime(0.0001, time + duration);
    voice.oscillator.frequency.setValueAtTime(frequency, time);
  }

  #scheduleStep(step, time, pattern) {
    if (pattern.kick[step]) this.#playSample(this.drumBuffers.kick, time);
    if (pattern.snare[step]) this.#playSample(this.drumBuffers.snare, time);
    if (pattern.hat[step]) this.#playSample(this.drumBuffers.hat, time);
    if (pattern.bass[step]) this.#playSynth(this.bassVoices, "bassVoiceIndex", pattern.bass[step], time, 0.19, 0.13);
    if (pattern.lead[step]) this.#playSynth(this.leadVoices, "leadVoiceIndex", pattern.lead[step], time, 0.14, 0.075);
  }

  async pause() {
    this.started = false; this.#stopScheduler();
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Playback paused; sequencer clock suspended.");
  }

  async suspendForInterruption() {
    this.started = false; this.#stopScheduler();
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Audio engine suspended after an external interruption.");
  }

  async stop() {
    await this.pause();
    if (this.mediaElement) { try { this.mediaElement.currentTime = 0; } catch {} }
    this.step = 0;
    this.onLog("Playback stopped; audio graph kept ready for the next start.");
  }

  async changePattern(direction = 1) {
    this.pattern = (this.pattern + direction + this.patterns.length) % this.patterns.length;
    this.step = 0;
    if (this.context && this.started) this.nextNoteTime = this.context.currentTime + 0.05;
    this.onLog(`Pattern changed to ${this.patterns[this.pattern].name} (${this.patterns[this.pattern].bpm} BPM).`);
    return this.pattern;
  }

  getInfo() {
    return { contextState: this.context?.state ?? "not created", sampleRate: this.context?.sampleRate ?? null,
      outputConnected: Boolean(this.master), pattern: this.pattern + 1, bpm: this.patterns[this.pattern].bpm };
  }
}
