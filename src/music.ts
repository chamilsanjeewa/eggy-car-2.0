/**
 * Procedural background music: a tiny step sequencer playing original patterns
 * on synthesized instruments (Web Audio, no audio files).
 */

export interface Track {
  id: string;
  name: string;
  bpm: number;
  /** MIDI note of the scale root. */
  root: number;
  /** Semitone offsets of the scale. */
  scale: number[];
  /** Chord root per bar, as a scale degree. Loops. */
  chords: number[];
  /**
   * Bass, 16 steps per bar: "x" chord root, "o" root an octave up, "5" the chord's fifth, "." rest.
   */
  bass: string;
  /** Melody: space-separated scale degrees (7 = root an octave up), "." = rest. 16 per bar. Loops. */
  melody: string;
  lead: { wave: OscillatorType; volume: number; length: number; echo: number };
  /** Sustained chord pad under everything. */
  pad: number;
  drums: { kick: string; snare: string; hat: string };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN_DOM = [0, 1, 4, 5, 7, 8, 10];

export const TRACKS: Track[] = [
  {
    id: "sunny",
    name: "Sunny Drive",
    bpm: 116,
    root: 60,
    scale: MAJOR,
    chords: [0, 4, 5, 3],
    bass: "x...x.o.x...5.o.",
    melody:
      "4 . 4 5 4 . 2 . 0 . 2 . 4 . . . " +
      "4 . 4 5 6 . 5 . 4 . 2 . 1 . . . " +
      "2 . 2 4 5 . 4 . 2 . 0 . 2 . 4 . " +
      "5 . 4 . 2 . 3 . 2 . 1 . 0 . . . ",
    lead: { wave: "square", volume: 0.045, length: 0.18, echo: 0.15 },
    pad: 0.02,
    drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x." },
  },
  {
    id: "desert",
    name: "Dune Groove",
    bpm: 98,
    root: 50,
    scale: PHRYGIAN_DOM,
    chords: [0, 0, 6, 1],
    bass: "x..x..x.x..x.5..",
    melody:
      "7 . 8 . 7 . 5 4 . . 5 . 4 . 2 1 " +
      "0 . . . 1 . 2 . 4 . . . . . . . " +
      "7 . 8 . 9 . 8 7 . . 5 . 7 . 5 4 " +
      "5 . 4 . 2 . 1 . 0 . . . . . . . ",
    lead: { wave: "triangle", volume: 0.07, length: 0.22, echo: 0.3 },
    pad: 0.015,
    drums: { kick: "x.....x...x.....", snare: "....x.......x..x", hat: "x.x.x.x.x.x.x.x." },
  },
  {
    id: "snow",
    name: "Frosty Glide",
    bpm: 84,
    root: 57,
    scale: MINOR,
    chords: [0, 5, 2, 6],
    bass: "x.......5.......",
    melody:
      "7 . . 9 . . 11 . 9 . . . 7 . . . " +
      "5 . . 7 . . 9 . 7 . . . . . . . " +
      "4 . . 7 . . 9 . 11 . 10 . 9 . . . " +
      "8 . . 7 . . 6 . 7 . . . . . . . ",
    lead: { wave: "sine", volume: 0.09, length: 0.5, echo: 0.4 },
    pad: 0.03,
    drums: { kick: "x...............", snare: "................", hat: "....x.......x..." },
  },
  {
    id: "space",
    name: "Moon Drift",
    bpm: 70,
    root: 52,
    scale: DORIAN,
    chords: [0, 3, 0, 6],
    bass: "x...............",
    melody:
      "7 . . . 11 . . . 10 . . . 9 . . . " +
      ". . . . . . . . . . . . . . . . " +
      "8 . . . 7 . . . 9 . . . 11 . . . " +
      "10 . . . . . . . . . . . . . . . ",
    lead: { wave: "sine", volume: 0.08, length: 1.1, echo: 0.55 },
    pad: 0.04,
    drums: { kick: "x.......x.......", snare: "................", hat: "........x......." },
  },
  {
    id: "lava",
    name: "Lava Rush",
    bpm: 142,
    root: 52,
    scale: MINOR,
    chords: [0, 5, 6, 4],
    bass: "x.x.o.x.x.x.o.5.",
    melody:
      "7 . 7 . 6 . 7 . 4 . . . 4 5 6 . " +
      "7 . 9 . 7 . 6 . 5 . . . . . . . " +
      "4 . 4 . 3 . 4 . 7 . . . 6 5 4 . " +
      "2 . 3 . 4 . 2 . 0 . . . . . . . ",
    lead: { wave: "sawtooth", volume: 0.035, length: 0.12, echo: 0.2 },
    pad: 0.012,
    drums: { kick: "x...x...x...x.x.", snare: "....x.......x...", hat: "xxxxxxxxxxxxxxxx" },
  },
];

/** Which track "Match terrain" plays on each map. */
export const MAP_TRACK: Record<string, string> = {
  countryside: "sunny",
  desert: "desert",
  snow: "snow",
  moon: "space",
  volcano: "lava",
};

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead
const TICK_MS = 25;

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private echoDelay: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private volume = 1;

  /** Connects to the shared audio context (after a user gesture). */
  attach(ctx: AudioContext): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(ctx.destination);

    // Feedback echo used by the lead
    this.echoIn = ctx.createGain();
    this.echoDelay = ctx.createDelay(1);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    this.echoIn.connect(this.echoDelay);
    this.echoDelay.connect(tone).connect(feedback).connect(this.echoDelay);
    tone.connect(this.out);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    if (this.track) this.start();
  }

  /** Plays the given track, or stops with null. */
  play(track: Track | null): void {
    if (track?.id === this.track?.id) return;
    this.track = track;
    this.stop();
    if (track && this.ctx) this.start();
  }

  /** 0..1, smoothly applied (used for mute and pause ducking). */
  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
  }

  private start(): void {
    if (!this.ctx || !this.track || !this.echoDelay) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.echoDelay.delayTime.value = (60 / this.track.bpm) * 0.75; // dotted eighth
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  private stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const track = this.track;
    if (!ctx || !track) return;
    // If the tab was in the background, don't try to catch up on missed notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    const stepDur = 60 / track.bpm / 4;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(track, this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private pitch(track: Track, degree: number, octave = 0): number {
    const n = track.scale.length;
    const oct = Math.floor(degree / n);
    const d = ((degree % n) + n) % n;
    return track.root + 12 * (oct + octave) + track.scale[d];
  }

  private playStep(track: Track, step: number, t: number, stepDur: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = track.chords[bar % track.chords.length];

    // Drums
    if (track.drums.kick[s16] === "x") this.kick(t);
    if (track.drums.snare[s16] === "x") this.snare(t);
    if (track.drums.hat[s16] === "x") this.hat(t, s16 % 4 === 2 ? 0.05 : 0.03);

    // Bass
    const b = track.bass[s16];
    if (b !== ".") {
      const deg = b === "5" ? chord + 4 : chord;
      const midi = this.pitch(track, deg, -2) + (b === "o" ? 12 : 0);
      this.tone("triangle", midiToHz(midi), t, stepDur * 1.8, 0.16, false, 900);
    }

    // Pad: chord triad held for the whole bar
    if (s16 === 0 && track.pad > 0) {
      for (const k of [0, 2, 4]) {
        this.tone("sine", midiToHz(this.pitch(track, chord + k, -1)), t, stepDur * 16, track.pad, false, 0, 0.4);
      }
    }

    // Melody
    const notes = track.melody.trim().split(/\s+/);
    const tok = notes[step % notes.length];
    if (tok !== ".") {
      const midi = this.pitch(track, Number(tok));
      const { wave, volume, length, echo } = track.lead;
      this.tone(wave, midiToHz(midi), t, length * (60 / track.bpm) * 2, volume, echo > 0, 2600, 0.01, echo);
    }
  }

  private tone(
    wave: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    vol: number,
    echo: boolean,
    lowpass = 0,
    attack = 0.005,
    echoAmount = 0,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.02));
    let node: AudioNode = osc;
    if (lowpass > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lowpass;
      node = node.connect(f);
    }
    node.connect(gain).connect(this.out!);
    if (echo && this.echoIn) {
      const send = ctx.createGain();
      send.gain.value = echoAmount;
      gain.connect(send).connect(this.echoIn);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(gain).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.14, 0.14, "bandpass", 1800);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, 0.04, vol, "highpass", 7000);
  }
}
