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
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];

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
  {
    id: "autumn",
    name: "Autumn Stroll",
    bpm: 92,
    root: 55,
    scale: MAJOR,
    chords: [0, 5, 3, 4],
    bass: "x.....5.x...o...",
    melody:
      "7 . . 6 7 . 9 . 7 . . . 4 . . . " +
      "5 . . 4 5 . 7 . 5 . . . 2 . . . " +
      "3 . 4 . 5 . 7 . 8 . 7 . 5 . 4 . " +
      "2 . . 4 . . 1 . 0 . . . . . . . ",
    lead: { wave: "triangle", volume: 0.08, length: 0.35, echo: 0.3 },
    pad: 0.025,
    drums: { kick: "x.......x.......", snare: "....x.......x...", hat: "..x...x...x...x." },
  },
  {
    id: "beach",
    name: "Beach Breeze",
    bpm: 104,
    root: 53,
    scale: MIXOLYDIAN,
    chords: [0, 3, 6, 3],
    bass: "x..x..x.o..x..5.",
    melody:
      "4 . 4 . 5 4 . 2 . . 4 . . . . . " +
      "6 . 6 . 7 6 . 4 . . 3 . . . . . " +
      "4 . 4 . 5 4 . 2 . . 4 . 5 . 7 . " +
      "6 . 4 . 3 . 2 . 0 . . . . . . . ",
    lead: { wave: "square", volume: 0.035, length: 0.2, echo: 0.25 },
    pad: 0.02,
    drums: { kick: "x.....x...x.....", snare: "....x.......x...", hat: "x.xxx.xxx.xxx.xx" },
  },
  {
    id: "canyon",
    name: "Canyon Run",
    bpm: 128,
    root: 57,
    scale: DORIAN,
    chords: [0, 0, 6, 3],
    bass: "x.x.5.x.x.x.5.o.",
    melody:
      "0 . . 2 3 . 4 . . . 2 . . . . . " +
      "4 . . 6 7 . 6 . 4 . . . 3 . . . " +
      "7 . . 6 4 . 6 . 7 . 9 . 7 . . . " +
      "6 . 4 . 3 . 2 . 0 . . . . . . . ",
    lead: { wave: "sawtooth", volume: 0.035, length: 0.25, echo: 0.45 },
    pad: 0.012,
    drums: { kick: "x...x...x...x...", snare: "....x.......x.x.", hat: "x.x.x.x.x.x.x.x." },
  },
  {
    id: "night",
    name: "Night Rider",
    bpm: 110,
    root: 52,
    scale: MINOR,
    chords: [0, 5, 2, 6],
    bass: "xoxoxoxoxoxoxoxo",
    melody:
      "7 . . . 9 . 10 . 9 . . . 7 . . . " +
      "5 . . . 7 . 9 . 7 . . . . . . . " +
      "4 . . . 7 . 9 . 11 . . . 10 . 9 . " +
      "8 . . . 7 . . . . . . . . . . . ",
    lead: { wave: "sawtooth", volume: 0.035, length: 0.6, echo: 0.5 },
    pad: 0.035,
    drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x." },
  },
  {
    id: "retro",
    name: "Retro Racer",
    bpm: 150,
    root: 60,
    scale: MAJOR,
    chords: [0, 3, 4, 0],
    bass: "x.o.x.o.x.o.x.o.",
    melody:
      "0 2 4 7 4 2 4 . 7 . 9 . 7 . 4 . " +
      "3 5 7 10 7 5 7 . 10 . 9 . 7 . . . " +
      "4 6 8 11 8 6 8 . 11 . 9 . 8 . 6 . " +
      "7 . 4 . 2 . 4 . 7 . . . . . . . ",
    lead: { wave: "square", volume: 0.03, length: 0.1, echo: 0.1 },
    pad: 0,
    drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
  },
  {
    id: "funky",
    name: "Funky Wheels",
    bpm: 106,
    root: 50,
    scale: DORIAN,
    chords: [0, 0, 3, 4],
    bass: "x..x.o.x..x.5.o.",
    melody:
      ". . 7 . . 9 . 7 . 6 . 4 . . . . " +
      ". . 7 . . 9 . 10 . 9 . 7 . . . . " +
      ". . 4 . . 6 . 7 . 6 . 4 . 3 . . " +
      "2 . . 3 . 4 . . 2 . 0 . . . . . ",
    lead: { wave: "square", volume: 0.035, length: 0.14, echo: 0.2 },
    pad: 0.015,
    drums: { kick: "x..x..x...x..x..", snare: "....x.......x...", hat: "xxxxxxxxxxxxxxxx" },
  },
  {
    id: "lullaby",
    name: "Lullaby Drive",
    bpm: 66,
    root: 60,
    scale: MAJOR,
    chords: [0, 3, 5, 4],
    bass: "x.......x.......",
    melody:
      "4 . . . 2 . . . 4 . 5 . 4 . . . " +
      "3 . . . 1 . . . 3 . 4 . 3 . . . " +
      "2 . . . 0 . . . 2 . 4 . 5 . . . " +
      "4 . . . . . . . . . . . . . . . ",
    lead: { wave: "sine", volume: 0.09, length: 0.9, echo: 0.45 },
    pad: 0.035,
    drums: { kick: "x...............", snare: "................", hat: "........x......." },
  },
  {
    id: "victory",
    name: "Victory Lap",
    bpm: 132,
    root: 58,
    scale: MAJOR,
    chords: [0, 4, 5, 3],
    bass: "x...x.o.x...x.o.",
    melody:
      "7 . 7 . 7 . 4 . 7 . . . 9 . . . " +
      "8 . 8 . 8 . 6 . 8 . . . 7 . . . " +
      "5 . 5 . 6 . 7 . 9 . 7 . 5 . 4 . " +
      "4 . 5 . 6 . 4 . 7 . . . . . . . ",
    lead: { wave: "triangle", volume: 0.08, length: 0.2, echo: 0.2 },
    pad: 0.02,
    drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
  },
];

/** Which track "Match terrain" plays on each map. */
export const MAP_TRACK: Record<string, string> = {
  countryside: "sunny",
  desert: "desert",
  snow: "snow",
  moon: "space",
  volcano: "lava",
  autumn: "autumn",
  beach: "beach",
  canyon: "canyon",
  swamp: "lullaby",
  jungle: "funky",
  city: "night",
  candy: "retro",
  mars: "space",
  savanna: "beach",
  sakura: "autumn",
  haunted: "night",
  reef: "lullaby",
  glacier: "snow",
  outback: "desert",
  neon: "retro",
  saltflats: "sunny",
  highlands: "autumn",
  factory: "retro",
  sky: "lullaby",
  ascent: "space",
};


const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Background music. Each track's loop is rendered once into an audio buffer (offline, a fraction
 * of a second) and then played on repeat by the browser's audio engine. Playback never depends on
 * the game's main thread, so a busy frame (physics, rivals, graphics) can't make it drop out.
 */
export class Music {
  private ctx: AudioContext | BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private echoDelay: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track | null = null;
  private volume = 1;
  private playlist: Track[] | null = null;
  /** Rendered loops by track id (and the renders in progress). */
  private cache = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private sourceGain: GainNode | null = null;
  /** Bumped on every change, so a slow render can't start a track that's no longer wanted. */
  private generation = 0;
  private shuffleTimer: number | null = null;

  /** Connects to the shared audio context (after a user gesture). */
  attach(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);

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

    if (this.playlist) this.startShuffle();
    else if (this.track) void this.startTrack(this.track);
  }

  /** Plays the given track, or stops with null. */
  play(track: Track | null): void {
    if (!this.playlist && track?.id === this.track?.id) return;
    this.playlist = null;
    this.track = track;
    this.stopShuffle();
    if (!track) {
      this.generation++;
      this.fadeOut();
      return;
    }
    if (this.ctx) void this.startTrack(track);
  }

  /** Plays random tracks from the list, one loop each. */
  shuffle(tracks: Track[]): void {
    if (this.playlist) return;
    this.playlist = tracks;
    if (this.ctx) this.startShuffle();
  }

  /** 0..1, smoothly applied (used for mute and pause ducking). */
  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
  }

  /** Kept for the game loop; playback no longer needs per-frame help. */
  tick(): void {}

  /** Steps in one seamless loop: long enough for the chords and the melody to come round together. */
  private static loopSteps(track: Track): number {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const chordSteps = 16 * track.chords.length;
    const melodySteps = Math.max(1, track.melody.trim().split(/\s+/).length);
    let steps = (chordSteps * melodySteps) / gcd(chordSteps, melodySteps);
    while (steps < 64) steps *= 2; // at least four bars
    return Math.min(steps, 512);
  }

  /** Renders a track's loop offline. The echo tail is folded back onto the start so it loops seamlessly. */
  private loopBuffer(track: Track): Promise<AudioBuffer> {
    const cached = this.cache.get(track.id);
    if (cached) return cached;
    const live = this.ctx!;
    const sr = live.sampleRate;
    const stepDur = 60 / track.bpm / 4;
    const steps = Music.loopSteps(track);
    const loopLen = Math.round(steps * stepDur * sr);
    const tail = Math.round(3 * sr);
    const off = new OfflineAudioContext(1, loopLen + tail, sr);
    const voice = new Music();
    voice.attach(off, off.destination);
    voice.echoDelay!.delayTime.value = (60 / track.bpm) * 0.75; // dotted eighth
    for (let step = 0; step < steps; step++) voice.playStep(track, step, step * stepDur, stepDur);
    const job = off.startRendering().then((full) => {
      const loop = live.createBuffer(1, loopLen, sr);
      const src = full.getChannelData(0);
      const dst = loop.getChannelData(0);
      dst.set(src.subarray(0, loopLen));
      for (let i = 0; i < tail; i++) dst[i % loopLen] += src[loopLen + i];
      return loop;
    });
    this.cache.set(track.id, job);
    return job;
  }

  private fadeOut(): void {
    if (!this.ctx || !this.source || !this.sourceGain) return;
    const t = this.ctx.currentTime;
    this.sourceGain.gain.setTargetAtTime(0, t, 0.12);
    this.source.stop(t + 0.8);
    this.source = null;
    this.sourceGain = null;
  }

  /** Starts a source playing `buffer` at time `at`, fading in; looping unless `once`. */
  private startSource(buffer: AudioBuffer, at: number, once: boolean): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.08);
    g.connect(this.out!);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !once;
    src.connect(g);
    src.start(at);
    this.source = src;
    this.sourceGain = g;
  }

  private async startTrack(track: Track): Promise<void> {
    const gen = ++this.generation;
    const buffer = await this.loopBuffer(track);
    if (gen !== this.generation || !this.ctx) return;
    this.fadeOut();
    this.startSource(buffer, this.ctx.currentTime + 0.05, false);
  }

  private startShuffle(): void {
    const gen = ++this.generation;
    this.fadeOut();
    this.track = this.pickNext();
    void this.queueShuffle(this.track, this.ctx!.currentTime + 0.05, gen);
  }

  /** Plays one loop of `track` at `at`, and lines up the next random track to start right after it. */
  private async queueShuffle(track: Track, at: number, gen: number): Promise<void> {
    const buffer = await this.loopBuffer(track);
    if (gen !== this.generation || !this.ctx || !this.playlist) return;
    const start = Math.max(at, this.ctx.currentTime + 0.05);
    this.startSource(buffer, start, true);
    const next = this.pickNext();
    void this.loopBuffer(next); // render the next one in the background, well before it's needed
    const ends = start + buffer.duration;
    const wait = Math.max(0, (ends - this.ctx.currentTime - 1.5) * 1000);
    this.shuffleTimer = window.setTimeout(() => {
      this.track = next;
      void this.queueShuffle(next, ends, gen);
    }, wait);
  }

  private stopShuffle(): void {
    if (this.shuffleTimer !== null) window.clearTimeout(this.shuffleTimer);
    this.shuffleTimer = null;
  }

  private pickNext(): Track {
    const list = this.playlist!;
    const options = list.filter((t) => t.id !== this.track?.id);
    return options[Math.floor(Math.random() * options.length)] ?? list[0];
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
