/** Procedural sound: a simulated engine plus effects, all with the Web Audio API (no audio files). */
import { ENGINE_WORKLET, EngineProfile, engineFor } from "./engineSound";

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
  /** Terrain id, for the tire/road noise. */
  surface?: string;
  /** Rocket thrust 0..1 (rocket cars). */
  rocket?: number;
  /** Listening from inside the cab (driver view): engine and road sound muffled. */
  cabin?: boolean;
}

/** Tire noise per terrain: band center (Hz), width (Q), level, and how much low rumble. */
interface Surface {
  freq: number;
  q: number;
  level: number;
  rumble: number;
}
const SURFACE: Record<string, Surface> = {
  asphalt: { freq: 900, q: 0.7, level: 0.35, rumble: 0.25 },
  dirt: { freq: 1600, q: 0.9, level: 0.7, rumble: 0.6 },
  sand: { freq: 3200, q: 0.6, level: 0.55, rumble: 0.2 },
  snow: { freq: 2400, q: 1.4, level: 0.6, rumble: 0.3 },
  rock: { freq: 700, q: 0.8, level: 0.6, rumble: 1 },
  soft: { freq: 1100, q: 0.8, level: 0.45, rumble: 0.35 },
};
const MAP_SURFACE: Record<string, keyof typeof SURFACE> = {
  countryside: "dirt",
  autumn: "dirt",
  savanna: "dirt",
  jungle: "soft",
  swamp: "soft",
  sakura: "soft",
  haunted: "dirt",
  desert: "sand",
  beach: "sand",
  reef: "sand",
  snow: "snow",
  candy: "soft",
  city: "asphalt",
  moon: "rock",
  mars: "rock",
  canyon: "rock",
  volcano: "rock",
  glacier: "snow",
  outback: "dirt",
  neon: "asphalt",
  saltflats: "snow",
  highlands: "dirt",
  factory: "asphalt",
  sky: "soft",
  ascent: "dirt",
};

/** Where the listener (the camera) is and which way it faces, in world meters (x along the road, y up, z sideways). */
export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  ux: number;
  uy: number;
  uz: number;
}

/** A rival car, for its engine sound: position, velocity and throttle. */
export interface RivalAudio {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  load: number;
  /** Crashed or finished: engine at idle. */
  idle: boolean;
}

/** One rival's engine: a light synth (pulse + sub + filter) through a 3D panner. */
interface RivalVoice {
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
  cylinders: number;
  electric: boolean;
  gear: number;
}

/** Make-up gain for stereo (speaker) panning, which is ~6 dB quieter than the 3D (HRTF) mode. */
const SPEAKER_MAKEUP = 1.95;
const RIVAL_LEVEL = 0.55;

/** Speed of sound for the Doppler shift, in m/s. */
const SOUND_SPEED = 343;

const GEARS = [3.2, 2.1, 1.5, 1.15, 0.9];
const IDLE_RPM = 820;
const REDLINE = 6600;
const RPM_PER_MS = 180; // engine rpm per (m/s × gear ratio)
/** Electric motors have one gear: full motor speed at this road speed (m/s). */
const EV_TOP_SPEED = 20;

export class Sound {
  private ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  /** Called once when the audio context is first created (e.g. to attach music). */
  /** Called once when the audio context is first created, with the master bus (e.g. to attach music). */
  onReady: ((ctx: AudioContext, master: AudioNode) => void) | null = null;
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  /** Channel volumes, 0..1. */
  private volumes = { master: 1, effects: 1, engine: 1 };

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
  /** Everything engine-related passes through this; it closes down in driver view. */
  private cabinFilter: BiquadFilterNode | null = null;
  private roadFilter: BiquadFilterNode | null = null;
  private roadGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private rocketGain: GainNode | null = null;
  /** Turbo boost 0..1 (spools up under throttle, vents when you lift). */
  private boost = 0;
  /** Rev limiter: fuel cut is active while this counts down. */
  private limiterCut = 0;
  private limiterWait = 0;
  private airTime = 0;
  private lastLoad = 0;

  /** Simulated engine state, exposed for the gauges. */
  rpm = 0;
  gear = 0;
  /** Combustion-modelled engine (AudioWorklet); null until loaded or if unsupported. */
  private engineNode: AudioWorkletNode | null = null;
  private profile: EngineProfile = engineFor("pickup");

  /** Engine rpm on the current vehicle's own scale (diesels rev lower, race engines higher). */
  get displayRpm(): number {
    if (this.rpm <= 0) return 0;
    const p = this.profile;
    if (p.electric) return Math.max(0, ((this.rpm - IDLE_RPM) / (REDLINE - IDLE_RPM)) * p.redline);
    return p.idle + ((this.rpm - IDLE_RPM) / (REDLINE - IDLE_RPM)) * (p.redline - p.idle);
  }

  /** Redline of the current vehicle's engine. */
  get redline(): number {
    return this.profile.redline;
  }

  /** Switches the engine sound to the given vehicle's engine. */
  setVehicle(vehicleId: string): void {
    this.profile = engineFor(vehicleId);
    this.engineNode?.port.postMessage(this.profile);
  }
  private shiftTimer = 0;
  private wasRunning = false;

  /**
   * Simple sound: only the most basic audio features (oscillators, filters, gains). No engine
   * synth worklet, no 3D panners, no rival engines, no limiter. For browsers/devices where the
   * advanced features misbehave.
   */
  private simple = false;

  setSimple(on: boolean): void {
    if (on === this.simple) return;
    this.simple = on;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (on) {
      // Engine synth off (the basic oscillator engine takes over), rivals silent, straight output
      try {
        this.engineNode?.disconnect();
      } catch {
        /* ignore */
      }
      this.setRivals([]);
      try {
        this.master.disconnect();
      } catch {
        /* ignore */
      }
      this.master.connect(ctx.destination);
    } else {
      try {
        this.master.disconnect();
      } catch {
        /* ignore */
      }
      this.limiter = null;
      if (this.simple) this.master.connect(ctx.destination);
    else this.buildOutput(ctx);
      if (this.engineNode && this.enginePanner) this.engineNode.connect(this.enginePanner);
      else if (!this.engineNode) void this.loadEngineWorklet(ctx).catch(() => {});
    }
  }

  private limiter: DynamicsCompressorNode | null = null;
  private watch: AnalyserNode | null = null;
  private watchBuf = new Float32Array(1024);

  /** master → limiter → speakers, with a meter on the end for the health check. */
  private buildOutput(ctx: AudioContext): void {
    if (this.limiter) {
      try {
        this.master!.disconnect(this.limiter);
        this.limiter.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    this.master!.connect(limiter).connect(ctx.destination);
    this.watch = ctx.createAnalyser();
    this.watch.fftSize = 1024;
    limiter.connect(this.watch);
    this.limiter = limiter;
  }

  /**
   * Health check, called a couple of times a second during play. Returns what it found:
   * "ok", "suspended" (the browser paused the audio; it tries to resume), or "repaired" (an invalid
   * value had broken the mix, so the output stage was rebuilt).
   */
  checkHealth(): "ok" | "suspended" | "repaired" | "off" {
    const ctx = this.ctx;
    if (!ctx || !this.watch || this.simple) return ctx && ctx.state !== "running" ? (void ctx.resume().catch(() => {}), "suspended") : "off";
    if (ctx.state !== "running") {
      void ctx.resume().catch(() => {});
      return "suspended";
    }
    this.watch.getFloatTimeDomainData(this.watchBuf);
    for (const v of this.watchBuf) {
      if (!Number.isFinite(v)) {
        this.buildOutput(ctx);
        return "repaired";
      }
    }
    return "ok";
  }

  /** Sound check: a plain beep straight to the speakers, skipping all the game's mixing. */
  testBeep(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.65);
  }

  /** What the audio system reports, for the sound check. */
  diagnostics(): string[] {
    const ctx = this.ctx;
    if (!ctx) return ["Audio: not started yet"];
    const c = ctx as AudioContext & { outputLatency?: number };
    let level = 0;
    try {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      this.master!.connect(a);
      const d = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(d);
      for (const v of d) level = Math.max(level, Math.abs(v));
      this.master!.disconnect(a);
    } catch {
      /* ignore */
    }
    return [
      `Audio state: ${ctx.state}`,
      `Sample rate: ${ctx.sampleRate} Hz · latency ${Math.round((ctx.baseLatency ?? 0) * 1000)}/${Math.round((c.outputLatency ?? 0) * 1000)} ms`,
      `Engine synth: ${this.engineNode ? "loaded" : "basic fallback"} · muted: ${this.muted ? "yes" : "no"}`,
      `Master volume: ${Math.round((this.master?.gain.value ?? 0) * 100)}% · signal now: ${level.toFixed(3)}`,
    ];
  }

  /** True once audio is actually playing (browsers keep it blocked until the player taps or clicks). */
  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /**
   * Starts the audio, or wakes it back up. Browsers only allow this from a tap, click or key
   * press, and they pause audio when you switch away (Safari on iPhone/iPad especially), so the
   * game calls this on every press, not just on Play.
   */
  unlock(): void {
    // iPhone/iPad: play even with the ringer switch on silent, like video does (iOS 17+).
    try {
      // Only on touch devices (iPhone/iPad): desktops don't have a silent switch.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      const touch = navigator.maxTouchPoints > 1 && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
      if (touch && nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
    } catch {
      /* not supported */
    }
    if (this.ctx) {
      if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    // A little more buffering than the minimum: the audio keeps playing smoothly when the
    // graphics are busy, instead of crackling (the extra delay is a few milliseconds).
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: "balanced" });
    } catch {
      ctx = new AC();
    }
    this.ctx = ctx;
    // master → speakers; effects, engine (and music, attached by the game) → master
    this.master = ctx.createGain();
    // Master limiter: when engine, music and effects stack up, it turns them down smoothly
    // instead of letting them clip into crackles.
    this.buildOutput(ctx);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.engineBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = "lowpass";
    this.cabinFilter.frequency.value = 18000;
    this.cabinFilter.Q.value = 0.5;
    this.cabinFilter.connect(this.engineBus);
    this.applyVolumes();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    void ctx.resume().catch(() => {});
    // Each part is set up separately: if one isn't supported by this browser, the rest still play.
    const step = (what: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        console.warn(`Sound: ${what} unavailable`, err);
      }
    };
    step("engine", () => this.buildEngine(ctx));
    step("rival engines", () => {
      if (this.pendingRivals) {
        const ids = this.pendingRivals;
        this.pendingRivals = null;
        this.setRivals(ids);
      }
    });
    if (!this.simple) void this.loadEngineWorklet(ctx).catch(() => {});
    step("music", () => this.onReady?.(ctx, this.master!));
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  setVolumes(v: { master: number; effects: number; engine: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx || !this.engineBus) return;
    const t = this.ctx.currentTime;
    // Squared for a more natural-feeling slider curve.
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master ** 2, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.effects ** 2, t, 0.05);
    // The engine sits a little under the music so the soundtrack stays clear while driving
    this.engineBus.gain.setTargetAtTime(this.volumes.engine ** 2 * 0.75, t, 0.05);
  }

  // ---------- engine ----------

  private buildEngine(ctx: AudioContext): void {
    const out = this.cabinFilter!;
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

    // Tire roll noise (tuned per surface) and low road rumble.
    const road = ctx.createBufferSource();
    road.buffer = this.noise;
    road.loop = true;
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = "bandpass";
    this.roadFilter.frequency.value = 1200;
    this.roadGain = gain(0);
    road.connect(this.roadFilter).connect(this.roadGain).connect(out);
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = "lowpass";
    rumbleF.frequency.value = 110;
    rumbleF.Q.value = 1.5;
    this.rumbleGain = gain(0);
    road.connect(rumbleF).connect(this.rumbleGain).connect(out);

    // Wind rushing past at speed.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const windF = ctx.createBiquadFilter();
    windF.type = "bandpass";
    windF.frequency.value = 520;
    windF.Q.value = 0.5;
    this.windGain = gain(0);
    wind.connect(windF).connect(this.windGain).connect(out);

    for (const o of [this.oscA, this.oscB, this.oscSub, this.lope]) o.start();
    roar.start();
    squeal.start(0, 0.7);
    road.start(0, 0.3);
    wind.start(0, 1.3);

    // Rocket roar: deep filtered noise with a crackle on top
    const rocket = ctx.createBufferSource();
    rocket.buffer = this.noise;
    rocket.loop = true;
    const rLow = ctx.createBiquadFilter();
    rLow.type = "lowpass";
    rLow.frequency.value = 700;
    const rBand = ctx.createBiquadFilter();
    rBand.type = "bandpass";
    rBand.frequency.value = 2400;
    rBand.Q.value = 0.8;
    this.rocketGain = gain(0);
    const rBandGain = gain(0.25);
    rocket.connect(rLow).connect(this.rocketGain);
    rocket.connect(rBand).connect(rBandGain).connect(this.rocketGain);
    this.rocketGain.connect(out);
    rocket.start(0, 0.6);
  }

  /** Advances the engine simulation and updates the sound. Call once per frame. */
  engine(dt: number, e: EngineInput): void {
    // Gearbox and rpm are simulated even before audio is unlocked, so the gauges work.
    const roadSpeed = Math.abs(e.speed) / Math.max(0.3, e.speedScale);
    if (!e.running) {
      this.rpm = Math.max(0, this.rpm - dt * 2500);
      this.gear = 0;
    } else {
      const ev = !!this.profile.electric;
      if (ev) this.gear = 0;
      const coupled = ev
        ? IDLE_RPM + Math.min(1, roadSpeed / EV_TOP_SPEED) * (REDLINE - IDLE_RPM)
        : IDLE_RPM + roadSpeed * RPM_PER_MS * GEARS[this.gear];
      // Free-revving when airborne or spinning up from a stop.
      // (An electric motor is geared straight to the wheels, so it only spins free in the air.)
      const free = IDLE_RPM + e.load * (e.onGround ? (ev ? 0 : 2600) : 5400);
      let target = Math.max(coupled, free);
      if (this.shiftTimer > 0) {
        this.shiftTimer -= dt;
        target *= 0.82;
      }
      // Rev limiter: flat out at the redline, the fuel is cut in short bursts so the revs bounce.
      if (this.limiterCut > 0) {
        this.limiterCut -= dt;
        target = REDLINE * 0.96;
      } else if (!ev && target >= REDLINE * 0.995 && e.load > 0.7 && (this.limiterWait -= dt) <= 0) {
        this.limiterCut = 0.06;
        this.limiterWait = 0.13 + Math.random() * 0.05;
      }
      // Inertia: revs climb quickly under throttle but fall more slowly when you lift (engine braking);
      // gear changes and the limiter still snap.
      const goal = Math.min(REDLINE, target);
      const rate = this.limiterCut > 0 ? 14 : this.shiftTimer > 0 ? 22 : goal > this.rpm ? 5 + 9 * e.load : 3.2;
      this.rpm += (goal - this.rpm) * Math.min(1, dt * rate);
      if (this.rpm < IDLE_RPM * 0.6) this.rpm = IDLE_RPM;
      // Automatic gearbox (electric drives have a single speed)
      if (ev) {
        /* no gears */
      } else if (this.sinceShift > 1.2 && e.onGround) {
        // No gear hunting: like a real automatic, shift on smoothed road speed (wheels spinning in
        // the air or slipping on a crest don't count), only on the ground, with a pause after
        // each change and a wide gap between the up- and down-shift points.
        const at = (g: number) => IDLE_RPM + this.shiftSpeed * RPM_PER_MS * GEARS[g];
        if (at(this.gear) > 6200 && this.gear < GEARS.length - 1 && this.shiftTimer <= 0) this.shift(1);
        else if (this.gear > 0 && at(this.gear) < 2400 && at(this.gear - 1) < 4800) this.shift(-1);
      }
      this.sinceShift += dt;
      if (e.onGround) this.shiftSpeed += (roadSpeed - this.shiftSpeed) * Math.min(1, dt * 2.5);
    }
    if (this.wasRunning && !e.running && roadSpeed < 50) {
      if (this.profile.electric) this.evPowerOff();
      else this.sputter();
    }
    if (!this.wasRunning && e.running && this.profile.electric) this.evPowerOn();
    this.wasRunning = e.running;

    // Turbo spools up with throttle and revs, and vents with a "pssh" when you lift off.
    const load = this.limiterCut > 0 ? 0 : e.load;
    const boostTarget = e.running ? load * Math.min(1, Math.max(0, (this.rpm - 1800) / 3000)) : 0;
    this.boost += (boostTarget - this.boost) * Math.min(1, dt * (boostTarget > this.boost ? 1.6 : 7));
    this.sinceBlowOff += dt;
    if (this.profile.turbo && this.lastLoad > 0.6 && e.load < 0.15 && this.boost > 0.35 && this.ready && this.sinceBlowOff > 1.5) {
      this.sinceBlowOff = 0;
      this.blowOff(this.boost);
    }
    this.lastLoad = e.load;

    // Landing: a suspension thump, heavier after a longer jump.
    if (!e.onGround) this.airTime += dt;
    else {
      if (this.airTime > 0.35 && this.ready) this.landing(Math.min(1, this.airTime / 1.5));
      this.airTime = 0;
    }

    const ctx = this.ctx;
    if (!ctx || !this.oscA || !this.engineGain) return;
    const t = ctx.currentTime;
    // Inside the cab you mostly hear the low end of the engine; outside, the full exhaust.
    this.cabinFilter!.frequency.setTargetAtTime(e.cabin ? 950 : 18000, t, 0.15);
    const f0 = Math.max(8, (this.rpm / 60) * 2); // 4-cylinder firing frequency
    const glide = 0.03;
    this.oscA.frequency.setTargetAtTime(f0, t, glide);
    this.oscB!.frequency.setTargetAtTime(f0 * 2.005, t, glide);
    this.oscSub!.frequency.setTargetAtTime(f0 / 2, t, glide);
    this.lope!.frequency.setTargetAtTime(3 + this.rpm / 900, t, 0.1);
    this.lopeDepth!.gain.setTargetAtTime(Math.max(0.02, 0.3 - this.rpm / 9000), t, 0.1);
    this.engineFilter!.frequency.setTargetAtTime(220 + this.rpm * 0.22 + e.load * 1700, t, 0.05);
    const modelled = this.engineNode !== null && !this.simple;
    const vol = this.rpm > 0 && !modelled ? 0.05 + e.load * 0.07 + (this.rpm / REDLINE) * 0.03 : 0;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.05);
    if (this.engineNode && !this.simple) {
      const params = this.engineNode.parameters;
      // A real idle hunts slightly up and down
      const hunt = this.rpm < IDLE_RPM * 1.3 && e.load < 0.05 ? Math.sin(t * 5.3) * 18 + Math.sin(t * 1.7) * 12 : 0;
      params.get("rpm")!.setTargetAtTime(Math.max(0, Math.min(12000, this.displayRpm + hunt)), t, 0.03);
      // Gearbox whine pitch follows road speed in the current gear (none for electric drives, they have their own)
      params.get("gearHz")?.setTargetAtTime(this.profile.electric || !e.running ? 0 : Math.min(8000, roadSpeed * GEARS[this.gear] * 36), t, 0.05);
      params.get("load")!.setTargetAtTime(load, t, this.limiterCut > 0 ? 0.025 : 0.05);
      params.get("boost")?.setTargetAtTime(this.profile.turbo ? this.boost : 0, t, 0.05);
      // Throttle bark: stabbing the gas from low throttle gives a short exhaust bark
      if (e.load - this.barkLoad > 0.45 && this.rpm > 0) this.bark = 0.3;
      this.barkLoad += (e.load - this.barkLoad) * Math.min(1, dt * 4);
      this.bark = Math.max(0, this.bark - dt * 1.2);
      params.get("gain")!.setTargetAtTime(this.rpm > 0 ? 0.32 + e.load * 0.25 + (this.rpm / REDLINE) * 0.15 + this.bark : 0, t, 0.06);
    }
    this.intakeFilter!.frequency.setTargetAtTime(f0 * 6, t, 0.05);
    // A little intake roar on top of the modelled engine (more of it for the fallback engine)
    const intake = this.rpm > 0 ? e.load * (modelled ? 0.025 : 0.06) + (this.rpm / REDLINE) * 0.015 : 0;
    this.intakeGain!.gain.setTargetAtTime(this.profile.electric && modelled ? 0 : intake, t, 0.05);
    const screech = e.braking && e.onGround && roadSpeed > 3 ? Math.min(0.1, roadSpeed * 0.008) : 0;
    this.screechGain!.gain.setTargetAtTime(screech, t, 0.04);

    // Tires on the ground and wind, both growing with speed.
    const surf = SURFACE[MAP_SURFACE[e.surface ?? ""] ?? "dirt"];
    const roll = e.onGround ? Math.min(1, roadSpeed / 22) : 0;
    this.roadFilter!.frequency.setTargetAtTime(surf.freq * (0.7 + roll * 0.5), t, 0.1);
    this.roadFilter!.Q.value = surf.q;
    this.roadGain!.gain.setTargetAtTime(roll * surf.level * 0.1, t, 0.08);
    this.rumbleGain!.gain.setTargetAtTime(roll * surf.rumble * 0.4 * (e.cabin ? 1.4 : 1), t, 0.08);
    const wind = Math.min(1, roadSpeed / 30);
    this.windGain!.gain.setTargetAtTime(wind * wind * 0.1, t, 0.2);
    this.rocketGain?.gain.setTargetAtTime((e.rocket ?? 0) * 0.32, t, 0.06);
  }

  /** Headphones: full 3D (HRTF) sound. Speakers (default): smooth stereo panning with a narrower spread. */
  private headphones = false;

  setHeadphones(on: boolean): void {
    this.headphones = on;
    const model: PanningModelType = on ? "HRTF" : "equalpower";
    if (this.enginePanner) this.enginePanner.panningModel = model;
    for (const v of this.rivalVoices) v.panner.panningModel = model;
    // Stereo panning comes out about 6 dB quieter than 3D: make it up so both modes match
    const makeup = on ? 1 : SPEAKER_MAKEUP;
    if (this.spatialMakeup) this.spatialMakeup.gain.value = makeup;
    if (this.rivalBus) this.rivalBus.gain.value = RIVAL_LEVEL * makeup;
  }
  private spatialMakeup: GainNode | null = null;

  /**
   * Where a sound at world point (x, y, z) should be placed. With headphones: exactly there.
   * On speakers, stereo can't show "behind" or extreme sides convincingly, so the sound is kept
   * in front of the listener and its side-to-side offset narrowed by `spread` (0 = dead center).
   */
  private placed(x: number, y: number, z: number, spread: number): [number, number, number] {
    const L = this.lastListener;
    if (this.headphones || !L) return [x, y, z];
    const fwd = [L.fx, L.fy, L.fz];
    const up = [L.ux, L.uy, L.uz];
    const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
    const rel = [x - L.x, y - L.y, z - L.z];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const dist = Math.hypot(rel[0], rel[1], rel[2]);
    const side = dot(rel, right) * spread;
    const h = dot(rel, up) * 0.3;
    // Keep the same distance (so it fades the same), but in front of the listener
    const ahead = Math.sqrt(Math.max(0.25, dist * dist - side * side - h * h));
    return [L.x + fwd[0] * ahead + right[0] * side + up[0] * h, L.y + fwd[1] * ahead + right[1] * side + up[1] * h, L.z + fwd[2] * ahead + right[2] * side + up[2] * h];
  }

  private makePanner(ctx: AudioContext, refDistance: number, rolloff: number): PannerNode {
    const p = ctx.createPanner();
    p.panningModel = this.headphones ? "HRTF" : "equalpower";
    p.distanceModel = "inverse";
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 400;
    return p;
  }

  private static setPos(p: PannerNode, x: number, y: number, z: number, t: number): void {
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, 0.03);
      p.positionY.setTargetAtTime(y, t, 0.03);
      p.positionZ.setTargetAtTime(z, t, 0.03);
    } else p.setPosition(x, y, z);
  }

  /** The listener is the camera: call every frame with where it is and where it looks. */
  setListener(pose: ListenerPose, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pose.x, t, 0.03);
      l.positionY.setTargetAtTime(pose.y, t, 0.03);
      l.positionZ.setTargetAtTime(pose.z, t, 0.03);
      l.forwardX.setTargetAtTime(pose.fx, t, 0.03);
      l.forwardY.setTargetAtTime(pose.fy, t, 0.03);
      l.forwardZ.setTargetAtTime(pose.fz, t, 0.03);
      l.upX.setTargetAtTime(pose.ux, t, 0.03);
      l.upY.setTargetAtTime(pose.uy, t, 0.03);
      l.upZ.setTargetAtTime(pose.uz, t, 0.03);
    } else {
      l.setPosition(pose.x, pose.y, pose.z);
      l.setOrientation(pose.fx, pose.fy, pose.fz, pose.ux, pose.uy, pose.uz);
    }
    if (this.lastListener && dt > 0) {
      const k = Math.min(1, dt * 8);
      this.listenerVel.x += ((pose.x - this.lastListener.x) / dt - this.listenerVel.x) * k;
      this.listenerVel.y += ((pose.y - this.lastListener.y) / dt - this.listenerVel.y) * k;
      this.listenerVel.z += ((pose.z - this.lastListener.z) / dt - this.listenerVel.z) * k;
    }
    this.lastListener = { ...pose };
  }

  /** Puts your engine at the car (engine bay, a little ahead of center). */
  setEnginePosition(x: number, y: number, z: number): void {
    if (!this.ctx || !this.enginePanner) return;
    // On speakers your own engine stays near the middle (a lopsided engine is tiring to listen to)
    const [px, py, pz] = this.placed(x, y, z, 0.25);
    Sound.setPos(this.enginePanner, px, py, pz, this.ctx.currentTime);
  }

  /** Starts an engine voice for each rival (empty list = none). Pass the rivals' vehicle ids. */
  setRivals(vehicleIds: string[]): void {
    const ctx = this.ctx;
    for (const v of this.rivalVoices) {
      v.gain.gain.setTargetAtTime(0, ctx?.currentTime ?? 0, 0.05);
      v.osc.stop((ctx?.currentTime ?? 0) + 0.3);
      v.sub.stop((ctx?.currentTime ?? 0) + 0.3);
    }
    this.rivalVoices = [];
    if (!ctx || !this.engineBus || vehicleIds.length === 0 || this.simple) {
      this.pendingRivals = ctx ? null : vehicleIds;
      return;
    }
    if (!this.rivalBus) {
      this.rivalBus = ctx.createGain();
      this.rivalBus.gain.value = RIVAL_LEVEL * (this.headphones ? 1 : SPEAKER_MAKEUP);
      this.rivalBus.connect(this.engineBus);
    }
    for (const id of vehicleIds) {
      const prof = engineFor(id);
      const osc = ctx.createOscillator();
      osc.type = prof.electric ? "sine" : "sawtooth";
      const sub = ctx.createOscillator();
      sub.type = prof.electric ? "triangle" : "square";
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const subGain = ctx.createGain();
      subGain.gain.value = prof.electric ? 0.25 : 0.5;
      const panner = this.makePanner(ctx, 6, 1.1);
      osc.connect(filter);
      sub.connect(subGain).connect(filter);
      filter.connect(gain).connect(panner).connect(this.rivalBus);
      osc.start();
      sub.start();
      this.rivalVoices.push({ osc, sub, filter, gain, panner, cylinders: prof.cylinders, electric: !!prof.electric, gear: 0 });
    }
  }
  private pendingRivals: string[] | null = null;

  /** Rival engines follow their cars: position, revs from speed, throttle, and a Doppler shift. */
  updateRivals(rivals: RivalAudio[], speedScale: number): void {
    if (this.simple) return;
    const ctx = this.ctx;
    if (!ctx || this.rivalVoices.length === 0) return;
    const t = ctx.currentTime;
    const L = this.lastListener;
    this.rivalVoices.forEach((v, i) => {
      const r = rivals[i];
      if (!r) return;
      const [px, py, pz] = this.placed(r.x, r.y + 0.6, -0.9, 0.6);
      Sound.setPos(v.panner, px, py, pz, t);
      // Revs from road speed through a simple automatic gearbox
      const road = Math.abs(r.speed) / Math.max(0.3, speedScale);
      let rpm = IDLE_RPM + road * RPM_PER_MS * GEARS[v.gear];
      if (rpm > 6000 && v.gear < GEARS.length - 1) v.gear++;
      else if (v.gear > 0 && IDLE_RPM + road * RPM_PER_MS * GEARS[v.gear - 1] < 4500) v.gear--;
      rpm = r.idle ? IDLE_RPM : Math.min(REDLINE, IDLE_RPM + road * RPM_PER_MS * GEARS[v.gear] + r.load * 600);
      // Doppler: pitch up while closing in, down after passing
      let doppler = 1;
      if (L) {
        const dx = L.x - r.x;
        const dy = L.y - r.y;
        const dz = L.z + 0.9;
        const dist = Math.max(0.5, Math.hypot(dx, dy, dz));
        const closing = ((r.vx - this.listenerVel.x) * dx + (r.vy - this.listenerVel.y) * dy + -this.listenerVel.z * dz) / dist;
        doppler = Math.max(0.8, Math.min(1.25, SOUND_SPEED / (SOUND_SPEED - closing)));
      }
      const fire = v.electric ? 90 + rpm * 0.12 : (rpm / 60) * (v.cylinders / 2);
      v.osc.frequency.setTargetAtTime(fire * doppler, t, 0.05);
      v.sub.frequency.setTargetAtTime((fire / 2) * doppler, t, 0.05);
      v.filter.frequency.setTargetAtTime(300 + rpm * 0.25 + r.load * 900, t, 0.05);
      v.gain.gain.setTargetAtTime(r.idle ? 0.05 : 0.09 + 0.12 * r.load, t, 0.08);
    });
  }

  /** Loads the combustion engine synth; if unsupported, the oscillator engine stays in use. */
  private async loadEngineWorklet(ctx: AudioContext): Promise<void> {
    if (!ctx.audioWorklet) return;
    try {
      const url = URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, "engine-synth", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { profile: this.profile },
      });
      // Your engine sits at the car in 3D: it moves around you as the camera does.
      this.enginePanner = this.makePanner(ctx, 14, 0.6);
      this.spatialMakeup = ctx.createGain();
      this.spatialMakeup.gain.value = this.headphones ? 1 : SPEAKER_MAKEUP;
      node.connect(this.enginePanner).connect(this.spatialMakeup).connect(this.cabinFilter ?? this.engineBus!);
      // Space: two short reflections off the ground and surroundings, spread left and right,
      // so the engine sounds like it's outdoors around you rather than inside your head.
      for (const [ms, pan] of [
        [11, -0.65],
        [17, 0.65],
      ]) {
        const d = ctx.createDelay(0.05);
        d.delayTime.value = ms / 1000;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 2600;
        const g = ctx.createGain();
        g.gain.value = 0.17;
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        node.connect(d).connect(lp).connect(g).connect(p).connect(this.cabinFilter ?? this.engineBus!);
      }
      this.engineNode = node;
    } catch {
      /* keep the fallback engine */
    }
  }

  private sinceShift = 1;
  /** Road speed as the gearbox sees it: smoothed, and frozen while airborne. */
  private shiftSpeed = 0;
  private sinceBlowOff = 9;

  private shift(dir: 1 | -1): void {
    this.gear += dir;
    this.sinceShift = 0;
    this.shiftTimer = dir > 0 ? 0.14 : 0.08;
    if (dir > 0 && this.ready && !this.profile.electric) {
      this.burst(0.07, 0.045, "lowpass", 700); // soft exhaust pop on upshift
      this.burst(0.05, 0.03, "lowpass", 220, 0.01); // gearbox clunk
    }
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

  /** Turbo blow-off valve venting: a short hiss that falls in pitch. */
  private blowOff(boost: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11 * boost, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(f).connect(g).connect(this.cabinFilter ?? this.sfx!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.4);
  }

  /** Suspension bottoming out after a jump. */
  private landing(strength: number): void {
    this.tone("sine", 95, 42, 0, 0.22, 0.12 + strength * 0.25);
    this.burst(0.12, 0.08 + strength * 0.12, "lowpass", 420);
    if (strength > 0.5) this.burst(0.06, 0.05, "bandpass", 1800, 0.03); // a rattle
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

  /** Lightning bolt right on top of you: a sharp crack and a deep boom. */
  zap(): void {
    if (!this.ready) return;
    this.burst(0.12, 0.5, "highpass", 2500, 0, 6000);
    this.burst(0.08, 0.35, "bandpass", 1800, 0.06);
    this.tone("sawtooth", 90, 30, 0.02, 0.7, 0.3);
    this.burst(1.4, 0.45, "lowpass", 220, 0.05, 60);
  }

  /** Distant thunder rumbling from a storm cloud (quieter the further away it is). */
  thunder(dist: number): void {
    if (!this.ready) return;
    const v = Math.max(0.05, 0.3 - dist * 0.01);
    this.burst(1.8, v, "lowpass", 160, 0.1, 50);
  }

  finish(): void {
    if (!this.ready) return;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone("square", f, f, i * 0.11, i === 5 ? 0.6 : 0.16, 0.05));
  }

  /** Soft two-note chime for navigation alerts. */
  navChime(): void {
    if (!this.ready) return;
    this.tone("sine", 880, 880, 0, 0.18, 0.06);
    this.tone("sine", 1320, 1320, 0.12, 0.25, 0.05);
  }

  newBest(): void {
    if (!this.ready) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone("triangle", f, f, i * 0.08, 0.3, 0.06));
  }

  /** Your engine's place in the 3D sound field (the listener is the camera). */
  private enginePanner: PannerNode | null = null;
  private rivalVoices: RivalVoice[] = [];
  private rivalBus: GainNode | null = null;
  private lastListener: ListenerPose | null = null;
  private listenerVel = { x: 0, y: 0, z: 0 };
  private bark = 0;
  private barkLoad = 0;
  private rainGain: GainNode | null = null;
  private rainLevel = -1;

  /** Steady rain hiss (0 = off). Built the first time it's needed. */
  setRain(level: number): void {
    if (!this.ctx || !this.sfx || level === this.rainLevel) return;
    this.rainLevel = level;
    const ctx = this.ctx;
    if (!this.rainGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7000;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(hp).connect(lp).connect(this.rainGain).connect(this.sfx);
      src.start(0, 0.9);
    }
    this.rainGain.gain.setTargetAtTime(level * 0.09, ctx.currentTime, 0.6);
  }

  /** Car flipped back onto its wheels: a whoosh and a soft landing thud. */
  flip(): void {
    if (!this.ready) return;
    this.burst(0.35, 0.12, "bandpass", 500, 0, 2400);
    this.tone("sine", 120, 55, 0.28, 0.25, 0.25);
  }

  /** Race start lights: a beep for each count, a higher one for GO. */
  countdown(go: boolean): void {
    if (!this.ready) return;
    this.tone("square", go ? 1320 : 660, go ? 1320 : 660, 0, go ? 0.5 : 0.18, 0.06);
  }

  /** Electric drive switching on: a rising sweep and a soft two-note ready chime. */
  evPowerOn(): void {
    if (!this.ready) return;
    this.tone("sine", 140, 620, 0, 0.45, 0.07);
    this.tone("triangle", 70, 310, 0, 0.45, 0.05);
    this.tone("sine", 1175, 1175, 0.38, 0.22, 0.035);
    this.tone("sine", 1568, 1568, 0.5, 0.35, 0.035);
  }

  /** Electric drive out of charge: the whine falls away. */
  evPowerOff(): void {
    if (!this.ready) return;
    this.tone("sine", 620, 90, 0, 0.8, 0.08);
    this.tone("triangle", 310, 45, 0, 0.8, 0.05);
  }

  /** Engine coughing to a stop. */
  sputter(): void {
    if (!this.ready) return;
    for (let i = 0; i < 4; i++) this.burst(0.09, 0.12 - i * 0.02, "lowpass", 500, i * 0.22);
  }
}
