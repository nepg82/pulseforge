/**
 * PulseForge Audio Engine - Tone.js Implementation
 */

const MUSIC_THEORY = {
  scales: {
    chillhop: ['C3', 'D3', 'Eb3', 'G3', 'Bb3', 'C4', 'D4', 'Eb4'],
    synthwave: ['A2', 'C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4'],
    darksynth: ['D2', 'Eb2', 'F2', 'G2', 'A2', 'Bb2', 'C#3', 'D3'],
    dubstep: ['F1', 'F2', 'Ab2', 'Bb2', 'B2', 'C3', 'Eb3', 'F3']
  },
  progressions: {
    chillhop: [
      { name: "Neo-Soul 7ths (ii - V - I - VI)", chords: [["D3", "F3", "A3", "C4"], ["G3", "B3", "D4", "F4"], ["C3", "E3", "G3", "B3"], ["A2", "C3", "E3", "G3"]] },
      { name: "Jazzy Cadence (IMaj7 - vi7 - ii7 - V7)", chords: [["C3", "E3", "G3", "B3"], ["A2", "C3", "E3", "G3"], ["D3", "F3", "A3", "C4"], ["G3", "B3", "D4", "F4"]] }
    ],
    synthwave: [
      { name: "Outrun Drive (i - VI - III - VII)", chords: [["A2", "C3", "E3"], ["F2", "A2", "C3"], ["C3", "E3", "G3"], ["G2", "B2", "D3"]] },
      { name: "Retro Sunset (i - v - VI - IV)", chords: [["A2", "C3", "E3"], ["E2", "G2", "B2"], ["F2", "A2", "C3"], ["D2", "F2", "A2"]] }
    ],
    darksynth: [
      { name: "Aggressive Minor (i - bII - i - v)", chords: [["D2", "F2", "A2"], ["Eb2", "G2", "Bb2"], ["D2", "F2", "A2"], ["A2", "C#3", "E3"]] },
      { name: "Cyber Thrash (i - VI - bV - bII)", chords: [["D2", "F2", "A2"], ["Bb2", "D3", "F3"], ["Ab2", "C3", "Eb3"], ["Eb2", "G2", "Bb2"]] }
    ],
    dubstep: [
      { name: "Half-Time Heavy (i - VI - III - VII)", chords: [["F2", "Ab2", "C3"], ["Db2", "F2", "Ab2"], ["Ab2", "C3", "Eb3"], ["Eb2", "G2", "Bb2"]] },
      { name: "Tension Stomp (i - bII - i - bVI)", chords: [["F2", "Ab2", "C3"], ["Gb2", "Bb2", "Db3"], ["F2", "Ab2", "C3"], ["Db2", "F2", "Ab2"]] }
    ]
  },
  instrumentLayouts: {
    chillhop: [
      { id: 'drums', name: 'Drums', type: 'pattern' },
      { id: 'bass', name: 'Warm Bass', type: 'shape', options: ['sine', 'triangle'] },
      { id: 'keys', name: 'Electric Piano', type: 'preset', options: ['mellow', 'bright'] },
      { id: 'pluck', name: 'Rhodes Pluck', type: 'preset', options: ['soft', 'bell'] }
    ],
    synthwave: [
      { id: 'drums', name: 'Drums', type: 'pattern' },
      { id: 'bass', name: 'Synth Bass', type: 'shape', options: ['sawtooth', 'square'] },
      { id: 'pad', name: 'Warm Pad', type: 'shape', options: ['sawtooth', 'triangle'] },
      { id: 'arp', name: 'Arpeggio', type: 'preset', options: ['classic_up', 'pingpong'] },
      { id: 'lead', name: 'Synth Lead', type: 'preset', options: ['square_lead', 'saw_lead'] }
    ],
    darksynth: [
      { id: 'drums', name: 'Drums', type: 'pattern' },
      { id: 'bass', name: 'Reese Bass', type: 'shape', options: ['sawtooth', 'square'] },
      { id: 'pad', name: 'Dark Pad', type: 'shape', options: ['sawtooth', 'square'] },
      { id: 'arp', name: 'Dark Arp', type: 'preset', options: ['fast_down', 'random_arp'] },
      { id: 'lead', name: 'Distorted Lead', type: 'preset', options: ['screamer', 'industrial'] }
    ],
    dubstep: [
      { id: 'drums', name: 'Drums', type: 'pattern' },
      { id: 'bass', name: 'Wobble Bass', type: 'shape', options: ['sawtooth', 'square'] },
      { id: 'pad', name: 'Atmosphere', type: 'shape', options: ['triangle', 'sine'] },
      { id: 'sub', name: 'Sub Bass', type: 'shape', options: ['sine', 'triangle'] }
    ]
  }
};

class AudioEngine {
  constructor() {
    this.isPlaying = false;
    this.isRadioMode = false;
    this.style = 'synthwave';
    this.key = 'A';
    this.bpm = 110;
    this.progressionIdx = 0;
    this.varietyPercent = 30;
    
    this.currentBar = 0;
    this.gains = {};
    this.mutedInstruments = new Set();
    this.synths = {};
    this.voices = {};
    
    // Radio Mode State Machine
    this.radioState = 'IDLE'; // INTRO, BODY, OUTRO, INTERMISSION
    this.radioSectionBarsLeft = 0;
    this.radioTrackTotalBars = 0;
    this.radioActiveInstruments = [];

    this.initUI();
  }

  async initAudio() {
    await Tone.start();
    Tone.Transport.bpm.value = this.bpm;
    
    // Create master output routing
    this.masterGain = new Tone.Gain(0.8).toDestination();
    
    // Setup Drum Synths
    this.kick = new Tone.MembraneSynth().connect(this.masterGain);
    this.snare = new Tone.NoiseSynth({ envelope: { sustain: 0.01 } }).connect(this.masterGain);
    this.hat = new Tone.MetalSynth({ envelope: { sustain: 0.01 }, resonance: 800 }).connect(this.masterGain);

    this.setupInstrumentSynths();
    this.scheduleLoop();
  }

  setupInstrumentSynths() {
    // Clean existing
    Object.values(this.synths).forEach(s => s.dispose && s.dispose());
    this.synths = {};

    const layout = MUSIC_THEORY.instrumentLayouts[this.style];
    layout.forEach(inst => {
      this.gains[inst.id] = this.gains[inst.id] || 0;
      const gainNode = new Tone.Gain(Tone.dbToGain(this.gains[inst.id])).connect(this.masterGain);
      
      if (inst.id === 'bass' || inst.id === 'sub') {
        const shape = this.voices[inst.id] || inst.options[0] || 'sawtooth';
        this.synths[inst.id] = new Tone.MonoSynth({
          oscillator: { type: shape },
          filter: { Q: 2, type: 'lowpass', rollover: -24 },
          filterEnvelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.8 }
        }).connect(gainNode);
      } else if (inst.id === 'pad' || inst.id === 'keys') {
        const shape = this.voices[inst.id] || 'sawtooth';
        this.synths[inst.id] = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: shape.includes('triangle') ? 'triangle' : 'sawtooth' },
          envelope: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 1 }
        }).connect(gainNode);
      } else {
        // Arps & Leads
        this.synths[inst.id] = new Tone.PolySynth(Tone.Synth).connect(gainNode);
      }
    });
  }

  scheduleLoop() {
    Tone.Transport.cancel();
    Tone.Transport.scheduleRepeat((time) => {
      this.onBarTick(time);
    }, '1m');
  }

  onBarTick(time) {
    this.currentBar++;
    document.getElementById('bar-counter').innerText = this.currentBar;

    if (this.isRadioMode) {
      this.processRadioStateMachine();
    } else {
      this.processVarietyModulation();
    }

    this.playCurrentBarPattern(time);
  }

  playCurrentBarPattern(time) {
    const progList = MUSIC_THEORY.progressions[this.style];
    const prog = progList[this.progressionIdx % progList.length];
    const chord = prog.chords[(this.currentBar - 1) % prog.chords.length];

    // Drums
    if (!this.mutedInstruments.has('drums')) {
      const step4 = 60 / Tone.Transport.bpm.value;
      this.kick.triggerAttackRelease('C1', '8n', time);
      this.snare.triggerAttackRelease('16n', time + step4);
      this.kick.triggerAttackRelease('C1', '8n', time + step4 * 2);
      this.snare.triggerAttackRelease('16n', time + step4 * 3);
      
      for (let i = 0; i < 4; i++) {
        this.hat.triggerAttackRelease('32n', time + (step4 * i) + (step4 / 2));
      }
    }

    // Bass
    if (this.synths.bass && !this.mutedInstruments.has('bass')) {
      const rootNote = chord[0];
      this.synths.bass.triggerAttackRelease(rootNote, '2n', time);
    }

    // Pad / Keys
    if (this.synths.pad && !this.mutedInstruments.has('pad')) {
      this.synths.pad.triggerAttackRelease(chord, '1m', time);
    }
    if (this.synths.keys && !this.mutedInstruments.has('keys')) {
      this.synths.keys.triggerAttackRelease(chord, '2n', time);
    }

    // Arpeggio
    if (this.synths.arp && !this.mutedInstruments.has('arp')) {
      const step16 = (60 / Tone.Transport.bpm.value) / 4;
      chord.forEach((note, idx) => {
        this.synths.arp.triggerAttackRelease(note, '16n', time + (idx * step16));
        this.synths.arp.triggerAttackRelease(note, '16n', time + ((idx + 4) * step16));
      });
    }
  }

  processVarietyModulation() {
    const layout = MUSIC_THEORY.instrumentLayouts[this.style];
    layout.forEach(inst => {
      const roll = Math.random() * 100;
      if (roll < this.varietyPercent * 0.2) {
        this.mutedInstruments.add(inst.id);
      } else {
        this.mutedInstruments.delete(inst.id);
      }
    });
    this.updateRackUIState();
  }

  processRadioStateMachine() {
    this.radioSectionBarsLeft--;
    
    if (this.radioSectionBarsLeft <= 0) {
      if (this.radioState === 'INTRO') {
        this.radioState = 'BODY';
        this.radioSectionBarsLeft = 64; // ~4 minutes total body
        // All instruments active
        this.mutedInstruments.clear();
        this.updateStatusText("Radio Mode: Playing Body Section");
      } else if (this.radioState === 'BODY') {
        this.radioState = 'OUTRO';
        this.radioSectionBarsLeft = 16;
        this.updateStatusText("Radio Mode: Outro (Fading Instruments)");
      } else if (this.radioState === 'OUTRO') {
        this.radioState = 'INTERMISSION';
        this.radioSectionBarsLeft = 1;
        this.mutedInstruments = new Set(['drums', 'bass', 'pad', 'keys', 'arp', 'lead', 'sub']);
        this.updateStatusText("Radio Mode: Intermission");
      } else if (this.radioState === 'INTERMISSION' || this.radioState === 'IDLE') {
        this.startNewRadioSong();
      }
    }

    if (this.radioState === 'INTRO') {
      // Add one instrument gradually
      const layout = MUSIC_THEORY.instrumentLayouts[this.style];
      if (this.currentBar % 4 === 0) {
        const inactive = layout.filter(i => this.mutedInstruments.has(i.id));
        if (inactive.length > 0) {
          this.mutedInstruments.delete(inactive[0].id);
        }
      }
    } else if (this.radioState === 'OUTRO') {
      // Remove one instrument gradually
      const layout = MUSIC_THEORY.instrumentLayouts[this.style];
      if (this.currentBar % 4 === 0) {
        const active = layout.filter(i => !this.mutedInstruments.has(i.id));
        if (active.length > 0) {
          this.mutedInstruments.add(active[0].id);
        }
      }
    }

    this.updateRackUIState();
  }

  startNewRadioSong() {
    this.radioState = 'INTRO';
    this.radioSectionBarsLeft = 16;
    
    // Pick random key and randomized BPM within +/- 5 of current target
    const keys = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    this.key = keys[Math.floor(Math.random() * keys.length)];
    const bpmDelta = Math.floor(Math.random() * 11) - 5;
    const targetBpm = Math.min(Math.max(this.bpm + bpmDelta, 60), 180);
    Tone.Transport.bpm.value = targetBpm;

    // Initially mute all for intro build
    const layout = MUSIC_THEORY.instrumentLayouts[this.style];
    this.mutedInstruments = new Set(layout.map(i => i.id));
    if (layout.length > 0) this.mutedInstruments.delete(layout[0].id);

    document.getElementById('active-params').innerText = `${this.key} | ${targetBpm} BPM`;
    this.updateStatusText(`Radio Mode: Starting New Track (${this.key})`);
  }

  togglePlay() {
    if (!this.isPlaying) {
      this.initAudio().then(() => {
        Tone.Transport.start();
        this.isPlaying = true;
        document.getElementById('btn-play').innerText = 'STOP AUDIO';
        document.getElementById('btn-play').classList.add('active');
        this.updateStatusText("Audio Engine Running");
      });
    } else {
      Tone.Transport.stop();
      this.isPlaying = false;
      document.getElementById('btn-play').innerText = 'START AUDIO';
      document.getElementById('btn-play').classList.remove('active');
      this.updateStatusText("Audio Engine Stopped");
    }
  }

  toggleRadioMode() {
    this.isRadioMode = !this.isRadioMode;
    const btn = document.getElementById('btn-radio');
    if (this.isRadioMode) {
      btn.innerText = 'RADIO MODE: ON';
      btn.classList.add('active');
      document.getElementById('mode-text').innerText = 'Radio Automation';
      this.startNewRadioSong();
    } else {
      btn.innerText = 'RADIO MODE: OFF';
      btn.classList.remove('active');
      document.getElementById('mode-text').innerText = 'Manual Loop';
      this.radioState = 'IDLE';
      this.mutedInstruments.clear();
      this.updateRackUIState();
      this.updateStatusText("Manual Mode Active");
    }
  }

  updateStatusText(msg) {
    document.getElementById('status-display').innerText = msg;
  }

  initUI() {
    document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-radio').addEventListener('click', () => this.toggleRadioMode());

    const styleSelect = document.getElementById('select-style');
    styleSelect.addEventListener('change', (e) => {
      this.style = e.target.value;
      this.updateProgressionOptions();
      this.renderRack();
      if (this.isPlaying) this.setupInstrumentSynths();
    });

    document.getElementById('input-bpm').addEventListener('input', (e) => {
      this.bpm = parseInt(e.target.value);
      document.getElementById('val-bpm').innerText = this.bpm;
      if (!this.isRadioMode) Tone.Transport.bpm.value = this.bpm;
    });

    document.getElementById('input-variety').addEventListener('input', (e) => {
      this.varietyPercent = parseInt(e.target.value);
      document.getElementById('val-variety').innerText = `${this.varietyPercent}%`;
    });

    this.updateProgressionOptions();
    this.renderRack();
  }

  updateProgressionOptions() {
    const select = document.getElementById('select-progression');
    select.innerHTML = '';
    const list = MUSIC_THEORY.progressions[this.style];
    list.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.innerText = p.name;
      select.appendChild(opt);
    });
    select.addEventListener('change', (e) => {
      this.progressionIdx = parseInt(e.target.value);
    });
  }

  renderRack() {
    const container = document.getElementById('rack-container');
    container.innerHTML = '';
    const layout = MUSIC_THEORY.instrumentLayouts[this.style];

    layout.forEach(inst => {
      const card = document.createElement('div');
      card.className = `inst-card ${this.mutedInstruments.has(inst.id) ? 'muted' : ''}`;
      card.id = `card-${inst.id}`;

      let voiceSelectorHTML = '';
      if (inst.options) {
        voiceSelectorHTML = `
          <div class="control-group">
            <label>${inst.type === 'shape' ? 'Oscillator Shape' : 'Sonic Preset'}</label>
            <select data-inst="${inst.id}" class="voice-select">
              ${inst.options.map(opt => `<option value="${opt}">${opt.toUpperCase()}</option>`).join('')}
            </select>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="inst-header">
          <span>${inst.name}</span>
        </div>
        ${voiceSelectorHTML}
        <div class="gain-control">
          <button class="gain-btn" data-inst="${inst.id}" data-action="dec">-</button>
          <span id="gain-val-${inst.id}">${this.gains[inst.id] || 0} dB</span>
          <button class="gain-btn" data-inst="${inst.id}" data-action="inc">+</button>
        </div>
      `;

      container.appendChild(card);
    });

    // Attach listener events for gain and voices
    container.querySelectorAll('.gain-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const instId = e.target.dataset.inst;
        const action = e.target.dataset.action;
        let current = this.gains[instId] || 0;
        current = action === 'inc' ? Math.min(current + 2, 12) : Math.max(current - 2, -36);
        this.gains[instId] = current;
        document.getElementById(`gain-val-${instId}`).innerText = `${current > 0 ? '+' : ''}${current} dB`;
        
        if (this.synths[instId]) {
          const gainNode = this.synths[instId].output || this.synths[instId];
          if (gainNode && gainNode.gain) {
            gainNode.gain.rampTo(Tone.dbToGain(current), 0.1);
          }
        }
      });
    });

    container.querySelectorAll('.voice-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const instId = e.target.dataset.inst;
        this.voices[instId] = e.target.value;
        if (this.isPlaying) this.setupInstrumentSynths();
      });
    });
  }

  updateRackUIState() {
    const layout = MUSIC_THEORY.instrumentLayouts[this.style];
    layout.forEach(inst => {
      const card = document.getElementById(`card-${inst.id}`);
      if (card) {
        if (this.mutedInstruments.has(inst.id)) {
          card.classList.add('muted');
        } else {
          card.classList.remove('muted');
        }
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.appEngine = new AudioEngine();
});