/** PulseForge Tone.js sequenced audio engine. */
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
    this.Tone = null;
    this.toneOutput = null;
    this.compressor = null;
    this.limiter = null;
    this.kick = null;
    this.snare = null;
    this.hat = null;
    this.snareFilter = null;
    this.hatFilter = null;
    this.bass = null;
    this.lead = null;
    this.initialized = false;
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
    if (!this.initialized) this.#build(AudioContextClass);
    try {
      if (this.context.state !== "running") await this.context.resume();
      await this.Tone.start();
      await this.mediaElement.play();
      this.started = true;
      this.step = 0;
      this.nextNoteTime = this.context.currentTime + 0.08;
      this.#startScheduler();
      this.onState("playing");
      this.onLog(`Tone.js sequencer started: ${this.patterns[this.pattern].name}, ${this.patterns[this.pattern].bpm} BPM.`);
      return this.getInfo();
    } catch (error) {
      this.started = false;
      this.#stopScheduler();
      if (this.context?.state === "running") await this.context.suspend();
      if (!this.initialized) await this.#resetFailedBuild();
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
    const ctx = new AudioContextClass();
    const master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    this.context = ctx;
    this.master = master;

    if (!window.Tone) throw new Error("Tone.js did not load. Connect to the internet once, then reload PulseForge.");
    this.Tone = window.Tone;
    this.Tone.setContext(ctx);

    // Tone.js instruments share the existing AudioContext. The output chain adds
    // controlled loudness while the limiter protects against digital clipping.
    this.toneOutput = new this.Tone.Volume(8);
    this.compressor = new this.Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.004, release: 0.16 });
    this.limiter = new this.Tone.Limiter(-1);
    this.toneOutput.chain(this.compressor, this.limiter);
    this.limiter.toDestination();

    this.kick = new this.Tone.MembraneSynth({
      pitchDecay: 0.045, octaves: 5, oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.02 }
    }).connect(this.toneOutput);

    this.snare = new this.Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.015 }
    });
    this.snareFilter = new this.Tone.Filter(1900, "highpass").connect(this.toneOutput);
    this.snare.connect(this.snareFilter);

    this.hat = new this.Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.008 }
    });
    this.hatFilter = new this.Tone.Filter(7600, "highpass").connect(this.toneOutput);
    this.hat.connect(this.hatFilter);

    this.bass = new this.Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 1.2, rolloff: -24 },
      filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0.18, release: 0.08, baseFrequency: 90, octaves: 2.2 },
      envelope: { attack: 0.008, decay: 0.18, sustain: 0.12, release: 0.08 }
    }).connect(this.toneOutput);

    this.lead = new this.Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.012, decay: 0.12, sustain: 0.22, release: 0.12 }
    }).connect(this.toneOutput);

    ctx.onstatechange = () => {
      this.onLog(`AudioContext state: ${ctx.state}`);
      if (ctx.state === "suspended" && this.started) this.onState("interrupted");
    };
    const baseLatency = Number.isFinite(ctx.baseLatency) ? `${Math.round(ctx.baseLatency * 1000)} ms` : "unavailable";
    const outputLatency = Number.isFinite(ctx.outputLatency) ? `${Math.round(ctx.outputLatency * 1000)} ms` : "unavailable";
    this.onLog(`Tone.js ${this.Tone.version || "loaded"}; sampleRate=${ctx.sampleRate}; baseLatency=${baseLatency}; outputLatency=${outputLatency}.`);
    this.initialized = true;
    this.onLog("Tone.js instruments ready; compressor and -1 dB limiter enabled.");
  }

  async #resetFailedBuild() {
    for (const node of [this.kick, this.snare, this.hat, this.snareFilter, this.hatFilter, this.bass, this.lead, this.toneOutput, this.compressor, this.limiter]) {
      try { node?.dispose(); } catch {}
    }
    const failedContext = this.context;
    this.context = null;
    this.master = null;
    this.Tone = null;
    this.toneOutput = this.compressor = this.limiter = null;
    this.kick = this.snare = this.hat = this.snareFilter = this.hatFilter = null;
    this.bass = this.lead = null;
    this.initialized = false;
    if (failedContext && failedContext.state !== "closed") {
      try { await failedContext.close(); } catch {}
    }
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
        this.onLog("Scheduler worker started (50 ms tick; 500 ms audio lookahead). ");
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

  #scheduleStep(step, time, pattern) {
    if (pattern.kick[step]) this.kick.triggerAttackRelease("C1", "8n", time, 0.9);
    if (pattern.snare[step]) this.snare.triggerAttackRelease(0.13, time, 0.72);
    if (pattern.hat[step]) this.hat.triggerAttackRelease(0.045, time, 0.48);
    if (pattern.bass[step]) this.bass.triggerAttackRelease(pattern.bass[step], 0.19, time, 0.68);
    if (pattern.lead[step]) this.lead.triggerAttackRelease(pattern.lead[step], 0.14, time, 0.58);
  }

  async pause() {
    this.started = false; this.#stopScheduler();
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Playback paused; Tone.js voices and sequencer clock suspended.");
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
    this.onLog("Playback stopped; Tone.js audio graph kept ready for the next start.");
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
      outputConnected: Boolean(this.master), toneVersion: this.Tone?.version ?? null,
      pattern: this.pattern + 1, bpm: this.patterns[this.pattern].bpm };
  }
}
