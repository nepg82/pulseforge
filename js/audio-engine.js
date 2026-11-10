/**
 * PulseForge audio engine — Milestone 1.
 * A small always-running synth test, routed through a real HTMLMediaElement
 * via MediaStreamDestination so Android sees an active media playback element.
 */
export class AudioEngine {
  constructor({ onState = () => {}, onLog = () => {} } = {}) {
    this.onState = onState;
    this.onLog = onLog;
    this.context = null;
    this.output = null;
    this.mediaElement = null;
    this.nodes = [];
    this.started = false;
    this.pattern = 0;
    this.master = null;
  }

  async start(mediaElement) {
    this.mediaElement = mediaElement;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");

    if (!this.context) this.#build(AudioContextClass);
    if (this.context.state !== "running") await this.context.resume();

    // The media element carries the actual synthesized signal, not a silent keepalive.
    if (!this.mediaElement.srcObject) this.mediaElement.srcObject = this.output.stream;
    this.mediaElement.loop = false;
    this.mediaElement.volume = 1;
    await this.mediaElement.play();

    this.started = true;
    this.onState("playing");
    this.onLog(`Audio started; context=${this.context.state}; sampleRate=${this.context.sampleRate}`);
    return this.getInfo();
  }

  #build(AudioContextClass) {
    const ctx = new AudioContextClass();
    const output = ctx.createMediaStreamDestination();
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(output);

    // Warm, restrained bass pulse.
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

    // Soft upper pulse, with a slow LFO for movement.
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

    // Gentle amplitude movement, entirely audio-clock scheduled.
    const ampLfo = ctx.createOscillator();
    ampLfo.type = "sine";
    ampLfo.frequency.value = 0.72;
    const ampDepth = ctx.createGain();
    ampDepth.gain.value = 0.045;
    ampLfo.connect(ampDepth).connect(master.gain);
    ampLfo.start();

    this.context = ctx;
    this.output = output;
    this.master = master;
    this.nodes = [bass, bassFilter, bassGain, lead, leadFilter, leadGain, lfo, lfoGain, ampLfo, ampDepth];
    ctx.onstatechange = () => {
      this.onLog(`AudioContext state: ${ctx.state}`);
      this.onState(ctx.state === "running" ? "playing" : (ctx.state === "suspended" ? "interrupted" : ctx.state));
    };
    this.onLog(`Audio graph created; destination=MediaStreamAudioDestinationNode`);
  }

  async pause() {
    if (this.mediaElement && !this.mediaElement.paused) this.mediaElement.pause();
    if (this.context && this.context.state === "running") await this.context.suspend();
    this.started = false;
    this.onState("paused");
    this.onLog("Playback paused.");
  }

  async stop() {
    await this.pause();
    if (this.mediaElement) {
      this.mediaElement.srcObject = null;
      this.mediaElement.load();
    }
    if (this.context) {
      const ctx = this.context;
      this.context = null;
      this.output = null;
      this.master = null;
      this.nodes = [];
      await ctx.close();
    }
    this.started = false;
    this.onState("stopped");
    this.onLog("Audio engine stopped and released.");
  }

  async changePattern() {
    this.pattern = (this.pattern + 1) % 3;
    if (!this.context || !this.master) return this.pattern;
    const now = this.context.currentTime;
    const settings = [
      { bass: 55, lead: 110, filter: 520, level: 0.18 },
      { bass: 65.4, lead: 130.8, filter: 760, level: 0.16 },
      { bass: 49, lead: 98, filter: 390, level: 0.20 }
    ][this.pattern];
    // Oscillator frequencies are updated without rebuilding the graph.
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
      outputConnected: Boolean(this.output),
      pattern: this.pattern + 1
    };
  }
}
