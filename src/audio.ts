/** Procedural sound: a simulated engine plus effects, all with the Web Audio API (no audio files). */

export interface EngineInput {
  /** Engine running (has fuel, game in progress). */
  running: boolean;
  /** Road speed in m/s. */
  speed: number;
  /** Throttle load 0..1. */
  load: number;
  onGround: boolean;
  braking: boolean;
  /** Low gravity slows everything down; scales road speed to engine speed. */
  speedScale: number;
}

const GEARS = [3.2, 2.1, 1.5, 1.15, 0.9];
const IDLE_RPM = 820;
const REDLINE = 6600;
const RPM_PER_MS = 180; // engine rpm per (m/s × gear ratio)

export class Sound {
  private ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  /** Called once when the audio context is first created (e.g. to attach music). */
  onReady: ((ctx: AudioContext) => void) | null = null;

  // Engine graph
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private lope: OscillatorNode | null = null;
  private lopeDepth: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private intakeGain: GainNode | null = null;
  private screechGain: GainNode | null = null;

  /** Simulated engine state, exposed for the gauges. */
  rpm = 0;
  gear = 0;
  private shiftTimer = 0;
  private wasRunning = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.muted ? 0 : 1;
    this.sfx.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.buildEngine(ctx);
    this.onReady?.(ctx);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.sfx) this.sfx.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  // ---------- engine ----------

  private buildEngine(ctx: AudioContext): void {
    const out = this.sfx!;
    // Harmonic stack: firing frequency, its octave, and a sub rumble.
    this.oscA = ctx.createOscillator();
    this.oscA.type = "sawtooth";
    this.oscB = ctx.createOscillator();
    this.oscB.type = "sawtooth";
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = "square";
    const mix = ctx.createGain();
    const gain = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    this.oscA.connect(gain(0.6)).connect(mix);
    this.oscB.connect(gain(0.25)).connect(mix);
    this.oscSub.connect(gain(0.35)).connect(mix);

    // Uneven idle "lope": a slow wobble in amplitude that fades out at high rpm.
    const lopeAmp = gain(1);
    this.lope = ctx.createOscillator();
    this.lope.frequency.value = 7;
    this.lopeDepth = gain(0.25);
    this.lope.connect(this.lopeDepth).connect(lopeAmp.gain);
    mix.connect(lopeAmp);

    // Soft saturation for growl, then a resonant filter that opens with throttle.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.2);
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.Q.value = 2.5;
    this.engineGain = gain(0);
    lopeAmp.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(out);

    // Intake / exhaust roar: band-passed noise tracking rpm.
    const roar = ctx.createBufferSource();
    roar.buffer = this.noise;
    roar.loop = true;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = "bandpass";
    this.intakeFilter.Q.value = 1.2;
    this.intakeGain = gain(0);
    roar.connect(this.intakeFilter).connect(this.intakeGain).connect(out);

    // Tire screech under hard braking.
    const squeal = ctx.createBufferSource();
    squeal.buffer = this.noise;
    squeal.loop = true;
    const sqf = ctx.createBiquadFilter();
    sqf.type = "bandpass";
    sqf.frequency.value = 2900;
    sqf.Q.value = 9;
    this.screechGain = gain(0);
    squeal.connect(sqf).connect(this.screechGain).connect(out);

    for (const o of [this.oscA, this.oscB, this.oscSub, this.lope]) o.start();
    roar.start();
    squeal.start(0, 0.7);
  }

  /** Advances the engine simulation and updates the sound. Call once per frame. */
  engine(dt: number, e: EngineInput): void {
    // Gearbox and rpm are simulated even before audio is unlocked, so the gauges work.
    const roadSpeed = Math.abs(e.speed) / Math.max(0.3, e.speedScale);
    if (!e.running) {
      this.rpm = Math.max(0, this.rpm - dt * 2500);
      this.gear = 0;
    } else {
      const coupled = IDLE_RPM + roadSpeed * RPM_PER_MS * GEARS[this.gear];
      // Free-revving when airborne or spinning up from a stop.
      const free = IDLE_RPM + e.load * (e.onGround ? 2600 : 5400);
      let target = Math.max(coupled, free);
      if (this.shiftTimer > 0) {
        this.shiftTimer -= dt;
        target *= 0.82;
      }
      this.rpm += (Math.min(REDLINE, target) - this.rpm) * Math.min(1, dt * 9);
      if (this.rpm < IDLE_RPM * 0.6) this.rpm = IDLE_RPM;
      // Automatic gearbox
      if (coupled > 6200 && this.gear < GEARS.length - 1 && this.shiftTimer <= 0) this.shift(1);
      else if (this.gear > 0 && coupled < 2600 && IDLE_RPM + roadSpeed * RPM_PER_MS * GEARS[this.gear - 1] < 5000) this.shift(-1);
    }
    if (this.wasRunning && !e.running && roadSpeed < 50) this.sputter();
    this.wasRunning = e.running;

    const ctx = this.ctx;
    if (!ctx || !this.oscA || !this.engineGain) return;
    const t = ctx.currentTime;
    const f0 = Math.max(8, (this.rpm / 60) * 2); // 4-cylinder firing frequency
    const glide = 0.03;
    this.oscA.frequency.setTargetAtTime(f0, t, glide);
    this.oscB!.frequency.setTargetAtTime(f0 * 2.005, t, glide);
    this.oscSub!.frequency.setTargetAtTime(f0 / 2, t, glide);
    this.lope!.frequency.setTargetAtTime(3 + this.rpm / 900, t, 0.1);
    this.lopeDepth!.gain.setTargetAtTime(Math.max(0.02, 0.3 - this.rpm / 9000), t, 0.1);
    this.engineFilter!.frequency.setTargetAtTime(220 + this.rpm * 0.22 + e.load * 1700, t, 0.05);
    const vol = this.rpm > 0 ? 0.05 + e.load * 0.07 + (this.rpm / REDLINE) * 0.03 : 0;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.05);
    this.intakeFilter!.frequency.setTargetAtTime(f0 * 6, t, 0.05);
    this.intakeGain!.gain.setTargetAtTime(this.rpm > 0 ? e.load * 0.06 + (this.rpm / REDLINE) * 0.015 : 0, t, 0.05);
    const screech = e.braking && e.onGround && roadSpeed > 3 ? Math.min(0.1, roadSpeed * 0.008) : 0;
    this.screechGain!.gain.setTargetAtTime(screech, t, 0.04);
  }

  private shift(dir: 1 | -1): void {
    this.gear += dir;
    this.shiftTimer = dir > 0 ? 0.14 : 0.08;
    if (dir > 0 && this.ready) this.burst(0.06, 0.08, "bandpass", 900); // exhaust pop on upshift
  }

  // ---------- one-shot helpers ----------

  private get ready(): boolean {
    return !!this.ctx && !!this.sfx;
  }

  private tone(type: OscillatorType, f0: number, f1: number, start: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(this.sfx!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, freq: number, start = 0, sweepTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  // ---------- effects ----------

  coin(): void {
    if (!this.ready) return;
    this.tone("square", 988, 988, 0, 0.08, 0.05);
    this.tone("square", 1319, 1319, 0.07, 0.2, 0.05);
  }

  bigCoin(): void {
    if (!this.ready) return;
    [1047, 1319, 1568, 2093, 2637].forEach((f, i) => this.tone("square", f, f, i * 0.055, 0.22, 0.045));
    this.tone("triangle", 523, 1047, 0, 0.35, 0.08);
  }

  /** Glue bottle: a gooey squelch, a bubbly bloop and a sparkly rising chime. */
  powerUp(): void {
    if (!this.ready) return;
    this.burst(0.22, 0.22, "lowpass", 300, 0, 2600);
    this.tone("sine", 180, 720, 0, 0.18, 0.18);
    this.tone("sine", 260, 900, 0.09, 0.14, 0.1);
    [1047, 1319, 1568, 2093, 2637, 3136].forEach((f, i) => {
      this.tone("triangle", f, f, 0.14 + i * 0.05, 0.4, 0.05);
      this.tone("sine", f * 2, f * 2, 0.14 + i * 0.05, 0.2, 0.015);
    });
  }

  fuel(): void {
    if (!this.ready) return;
    this.tone("triangle", 1800, 1700, 0, 0.12, 0.06); // cap clink
    for (let i = 0; i < 4; i++) this.tone("sine", 240 + i * 30, 520 + i * 40, 0.08 + i * 0.09, 0.08, 0.14); // glugs
  }

  life(): void {
    if (!this.ready) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, f, i * 0.07, 0.6, 0.07));
    this.tone("sine", 2093, 2093, 0.3, 0.5, 0.03);
  }

  /** The egg was saved by armor or an extra life. */
  shield(): void {
    if (!this.ready) return;
    this.burst(0.35, 0.12, "bandpass", 500, 0, 3000);
    [784, 1175, 1568].forEach((f, i) => this.tone("sine", f, f * 1.01, 0.05 + i * 0.06, 0.5, 0.07));
  }

  /** Big messy egg smash. */
  smash(): void {
    if (!this.ready) return;
    this.tone("sine", 130, 38, 0, 0.35, 0.45); // thump
    this.burst(0.45, 0.4, "lowpass", 1100, 0.01, 300); // splat
    for (let i = 0; i < 7; i++) this.burst(0.05, 0.25, "highpass", 3500 + Math.random() * 2500, 0.02 + i * 0.035); // shell crackles
    this.burst(0.6, 0.06, "highpass", 6500, 0.12); // glassy tinkle
  }

  finish(): void {
    if (!this.ready) return;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone("square", f, f, i * 0.11, i === 5 ? 0.6 : 0.16, 0.05));
  }

  newBest(): void {
    if (!this.ready) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone("triangle", f, f, i * 0.08, 0.3, 0.06));
  }

  /** Engine coughing to a stop. */
  sputter(): void {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) this.burst(0.09, 0.12 - i * 0.02, "lowpass", 500, i * 0.22);
  }
}
