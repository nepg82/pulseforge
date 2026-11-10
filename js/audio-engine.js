/**
 * PulseForge audio engine — Media Session test build.
 * A quiet, looping media resource feeds Web Audio. This gives Android a real
 * HTMLMediaElement playback session while the generated synth is mixed in Web Audio.
 */
export class AudioEngine {
  constructor({ onState = () => {}, onLog = () => {} } = {}) {
    this.onState = onState;
    this.onLog = onLog;
    this.context = null;
    this.mediaElement = null;
    this.mediaSource = null;
    this.keepAliveUrl = null;
    this.nodes = [];
    this.started = false;
    this.pattern = 0;
    this.master = null;
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
      this.onState("playing");
      this.onLog(`Playback started; context=${this.context.state}; sampleRate=${this.context.sampleRate}`);
      return this.getInfo();
    } catch (error) {
      this.started = false;
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
    // 20 seconds at 8 kHz; an extremely low 20 Hz tone avoids a zero-data
    // resource while remaining effectively inaudible. The loop is phase-aligned.
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
    master.gain.value = 0.18;
    master.connect(ctx.destination);

    // The media element is the input to Web Audio (not the output). This is
    // important for Chrome on Android to request normal media audio focus.
    this.mediaSource = ctx.createMediaElementSource(this.mediaElement);
    this.mediaSource.connect(master);

    const bass = ctx.createOscillator();
    bass.type = "sawtooth";
    bass.frequency.value = 55;
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 145;
    bassFilter.Q.value = 1.1;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.34;
    bass.connect(bassFilter).connect(bassGain).connect(master);
    bass.start();

    const lead = ctx.createOscillator();
    lead.type = "triangle";
    lead.frequency.value = 110;
    const leadFilter = ctx.createBiquadFilter();
    leadFilter.type = "lowpass";
    leadFilter.frequency.value = 520;
    const leadGain = ctx.createGain();
    leadGain.gain.value = 0.13;
    lead.connect(leadFilter).connect(leadGain).connect(master);
    lead.start();

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain).connect(leadFilter.frequency);
    lfo.start();

    const ampLfo = ctx.createOscillator();
    ampLfo.type = "sine";
    ampLfo.frequency.value = 0.72;
    const ampDepth = ctx.createGain();
    ampDepth.gain.value = 0.045;
    ampLfo.connect(ampDepth).connect(master.gain);
    ampLfo.start();

    this.context = ctx;
    this.master = master;
    this.nodes = [bass, bassFilter, bassGain, lead, leadFilter, leadGain, lfo, lfoGain, ampLfo, ampDepth];
    ctx.onstatechange = () => {
      this.onLog(`AudioContext state: ${ctx.state}`);
      if (ctx.state === "suspended" && this.started) this.onState("interrupted");
    };
    this.onLog("Audio graph created; HTMLAudioElement feeds Web Audio destination.");
  }

  async pause() {
    this.started = false;
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Playback paused.");
  }

  async suspendForInterruption() {
    this.started = false;
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context?.state === "running") await this.context.suspend();
    this.onLog("Audio engine suspended after an external interruption.");
  }

  async stop() {
    await this.pause();
    if (this.mediaElement) {
      try { this.mediaElement.currentTime = 0; } catch {}
    }
    this.onLog("Playback stopped; audio graph kept ready for the next start.");
  }

  async changePattern(direction = 1) {
    this.pattern = (this.pattern + direction + 3) % 3;
    if (!this.context || !this.master) return this.pattern;
    const settings = [
      { bass: 55, lead: 110, filter: 520, level: 0.18 },
      { bass: 65.4, lead: 130.8, filter: 760, level: 0.16 },
      { bass: 49, lead: 98, filter: 390, level: 0.20 }
    ][this.pattern];
    const now = this.context.currentTime;
    this.nodes[0].frequency.setTargetAtTime(settings.bass, now, 0.18);
    this.nodes[3].frequency.setTargetAtTime(settings.lead, now, 0.18);
    this.nodes[4].frequency.setTargetAtTime(settings.filter, now, 0.25);
    this.master.gain.setTargetAtTime(settings.level, now, 0.2);
    this.onLog(`Pattern changed to ${this.pattern + 1}.`);
    return this.pattern;
  }

  getInfo() {
    return {
      contextState: this.context?.state ?? "not created",
      sampleRate: this.context?.sampleRate ?? null,
      outputConnected: Boolean(this.master),
      pattern: this.pattern + 1
    };
  }
}
