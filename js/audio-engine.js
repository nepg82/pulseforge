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
    this.bassShelf = null;
    this.padBus = null;
    this.melodyBus = null;
    this.drumBus = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.drumLevels = { kick: 0.65, snare: 0.45, hat: 0.22 };
    this.padVolume = 1;
    this.melodyVolume = 1;
    this.bpm = 60;
    this.bassBoost = false;
    this.padShape = "blend";
    this.melodyShape = "sine";
    this.melodyDensity = 50;
    this.melodyMeasure = 0;
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
      this.bassShelf = this.context.createBiquadFilter();
      this.bassShelf.type = "lowshelf";
      this.bassShelf.frequency.value = 120;
      this.bassShelf.gain.value = this.bassBoost ? 3 : 0;
      this.filter.connect(this.bassShelf).connect(this.compressor);
      this.padBus = this.context.createGain();
      this.melodyBus = this.context.createGain();
      this.drumBus = this.context.createGain();
      this.padBus.gain.value = this.padVolume;
      this.melodyBus.gain.value = this.melodyVolume;
      this.drumBus.gain.value = 1;
      this.padBus.connect(this.filter);
      this.melodyBus.connect(this.filter);
      this.drumBus.connect(this.filter);
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
    const measureSeconds = 240 / this.bpm;
    const releaseStart = measureSeconds;
    const releaseEnd = measureSeconds + 0.6;
    const attack = Math.min(0.7, measureSeconds * 0.18);

    for (const midi of notes) {
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      const layers = this.padShape === "sine"
        ? [{ type: "sine", level: 0.112 }]
        : this.padShape === "triangle"
          ? [{ type: "triangle", level: 0.112 }]
          : [{ type: "sine", level: 0.09 }, { type: "triangle", level: 0.022 }];
      const voices = layers.map(layer => {
        const osc = this.context.createOscillator();
        const amp = this.context.createGain();
        osc.type = layer.type;
        osc.frequency.setValueAtTime(frequency, time);
        amp.gain.setValueAtTime(0.0001, time);
        amp.gain.exponentialRampToValueAtTime(layer.level, time + attack);
        amp.gain.setValueAtTime(layer.level, time + releaseStart);
        amp.gain.exponentialRampToValueAtTime(0.0001, time + releaseEnd);
        osc.connect(amp).connect(this.padBus);
        osc.start(time);
        osc.stop(time + releaseEnd + 0.03);
        osc.addEventListener("ended", () => { osc.disconnect(); amp.disconnect(); }, { once: true });
        return osc;
      });
    }
  }

  setPadShape(shape) {
    if (["blend", "sine", "triangle"].includes(shape)) this.padShape = shape;
  }

  setMelodyShape(shape) {
    if (["sine", "triangle"].includes(shape)) this.melodyShape = shape;
  }

  setMelodyDensity(value) {
    this.melodyDensity = Math.max(0, Math.min(100, Number(value) || 0));
  }

  setPadVolume(value) {
    this.padVolume = Math.max(0, Math.min(1.5, Number(value) / 100));
    if (this.padBus && this.context) this.padBus.gain.setTargetAtTime(this.padVolume, this.context.currentTime, 0.025);
  }

  setMelodyVolume(value) {
    this.melodyVolume = Math.max(0, Math.min(1.5, Number(value) / 100));
    if (this.melodyBus && this.context) this.melodyBus.gain.setTargetAtTime(this.melodyVolume, this.context.currentTime, 0.025);
  }

  setBpm(value) {
    this.bpm = Math.max(40, Math.min(120, Number(value) || 60));
  }

  setBassBoost(enabled) {
    this.bassBoost = Boolean(enabled);
    if (this.bassShelf && this.context) this.bassShelf.gain.setTargetAtTime(this.bassBoost ? 3 : 0, this.context.currentTime, 0.04);
  }

  scheduleMelodyStep(step, time, chordIndex = 0) {
    if (!this.context || !this.filter || this.yielded) return;
    const position = step % 16;
    if (position === 0) this.melodyMeasure++;

    // Phrase-based melody: deliberately chosen rhythmic slots create musical
    // sentences with rests, rather than filling a sixteenth-note grid.
    const rhythmicPhrases = [
      [0, 2, 5, 8, 11, 14],       // establish, rise, answer
      [1, 4, 6, 9, 12, 15],       // pickup and a little syncopation
      [0, 3, 5, 7, 10, 13, 15],  // more active middle phrase
      [0, 4, 7, 10, 12]           // leave room for resolution
    ];
    const bar = (this.melodyMeasure - 1) % 4;
    const candidates = rhythmicPhrases[bar];
    const density = this.melodyDensity / 100;
    // Density controls how many phrase events are selected, not a grid fill.
    const eventCount = density <= 0 ? 0 : Math.max(1, Math.round(1 + density * (candidates.length - 1)));
    const selected = new Set();
    if (eventCount === 1) selected.add(candidates[Math.floor(candidates.length / 2)]);
    else if (eventCount > 1) {
      for (let i = 0; i < eventCount; i++) {
        selected.add(candidates[Math.round(i * (candidates.length - 1) / (eventCount - 1))]);
      }
    }
    if (!selected.has(position)) return;

    const chordNotes = [
      [69, 72, 76, 79, 83],       // Am9
      [69, 72, 76, 77, 81],       // Fmaj7
      [67, 71, 72, 76, 79, 81],   // Cmaj9
      [67, 71, 74, 76, 81]        // G6/9
    ][chordIndex % 4];
    const contours = [
      [1, 2, 3, 2, 1, 0, 1],
      [2, 1, 0, 1, 2, 3, 2],
      [0, 1, 2, 3, 4, 3, 2],
      [2, 3, 2, 1, 0, 1, 0]
    ];
    const phraseIndex = candidates.indexOf(position);
    let noteIndex = contours[bar][Math.max(0, phraseIndex)] % chordNotes.length;
    // Small phrase-to-phrase variation without losing the melodic contour.
    if (this.melodyMeasure > 4 && (this.melodyMeasure % 8) >= 5 && phraseIndex === 2) {
      noteIndex = (noteIndex + 1) % chordNotes.length;
    }
    let midi = chordNotes[noteIndex];
    // Occasional diatonic approach note on a weak subdivision.
    if ([5, 11, 15].includes(position) && phraseIndex % 2 === 1) {
      const scale = [0, 2, 4, 5, 7, 9, 11];
      const pc = midi % 12;
      const scaleIndex = scale.indexOf(pc);
      if (scaleIndex >= 0) {
        const neighbor = scale[(scaleIndex + 1) % scale.length];
        midi = midi - pc + (neighbor <= pc ? neighbor + 12 : neighbor);
      }
    }

    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = this.melodyShape;
    osc.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), time);
    const peak = this.melodyShape === "triangle" ? 0.026 : 0.035;
    const stepSeconds = 60 / this.bpm / 4;
    // Mostly short/medium notes, with only occasional longer notes. Every
    // note decays after its attack, avoiding the flat sustained-horn sound.
    const durationSteps = position === 0 && bar === 3 ? 2.6
      : phraseIndex % 4 === 2 ? 1.9
        : phraseIndex % 3 === 0 ? 1.35
          : 1.6;
    const duration = stepSeconds * durationSteps;
    const attack = Math.min(0.045, stepSeconds * 0.22);
    const decay = Math.min(0.16, duration * 0.34);
    const sustain = peak * 0.48;
    const releaseStart = Math.max(time + attack + decay, time + duration - Math.min(0.09, stepSeconds * 0.28));
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(peak, time + attack);
    amp.gain.exponentialRampToValueAtTime(sustain, time + attack + decay);
    amp.gain.setValueAtTime(sustain, releaseStart);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(amp).connect(this.melodyBus);
    osc.start(time);
    osc.stop(time + duration + 0.02);
    osc.addEventListener("ended", () => { osc.disconnect(); amp.disconnect(); }, { once: true });
  }

  setDrumLevel(instrument, value) {
    if (instrument in this.drumLevels) {
      this.drumLevels[instrument] = Math.max(0, Math.min(1, Number(value) || 0));
    }
  }

  scheduleDrumStep(step, time) {
    if (!this.context || !this.filter || this.yielded) return;
    const levels = this.drumLevels;
    const gain = 3.1;

    // The pad phrase is four seconds long. Four scheduler ticks per beat
    // therefore gives the drums a true 60 BPM quarter-note pulse.
    const position = step % 16;

    // Main kick on beats 1 and 3, with a restrained anticipation before beat 4.
    if ([0, 8].includes(position) && levels.kick > 0) {
      this.scheduleKick(time, levels.kick * gain, position === 0 ? 1 : 0.90);
    } else if (position === 11 && levels.kick > 0) {
      this.scheduleKick(time, levels.kick * gain, 0.34);
    }

    // Snare on beats 2 and 4; a quiet ghost note adds a little movement.
    if ([4, 12].includes(position) && levels.snare > 0) {
      this.scheduleSnare(time, levels.snare * gain, 0.82);
    } else if (position === 15 && levels.snare > 0) {
      this.scheduleSnare(time, levels.snare * gain, 0.20);
    }

    // Eighth-note hats, with softer offbeat accents for a relaxed shuffle of energy.
    if (levels.hat > 0 && position % 2 === 0) {
      const beat = position / 4;
      const accent = position % 4 === 0
        ? (beat === 0 ? 0.72 : 0.56)
        : 0.34;
      this.scheduleHat(time, levels.hat * gain, accent);
    } else if (levels.hat > 0 && [3, 7, 11, 15].includes(position)) {
      this.scheduleHat(time, levels.hat * gain, 0.16);
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
    osc.connect(amp).connect(this.drumBus);
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
    noise.connect(noiseFilter).connect(noiseAmp).connect(this.drumBus);
    tone.connect(toneAmp).connect(this.drumBus);
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
    noise.connect(highpass).connect(amp).connect(this.drumBus);
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
    this.master = this.filter = this.bassShelf = this.padBus = this.melodyBus = this.drumBus = this.compressor = this.noiseBuffer = null;
  }
}
