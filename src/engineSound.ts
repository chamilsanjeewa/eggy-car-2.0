/**
 * Physically-inspired engine synthesis.
 *
 * Instead of stacking oscillators, an AudioWorklet fires one combustion pulse per cylinder
 * firing. Each pulse (a short thump plus a burst of noise) rings through a few resonators that
 * stand in for the exhaust and engine body, so the pitch follows rpm while each engine keeps its
 * own timbre. Small random variations per firing give the idle its lumpy, uneven character.
 */

export interface EngineProfile {
  /** Number of cylinders (firings per two revolutions). */
  cylinders: number;
  idle: number;
  redline: number;
  /** Resonator frequencies (Hz), bandwidths (Hz) and mix levels: exhaust body, pipe, rasp. */
  formants: [number, number, number];
  bandwidths: [number, number, number];
  mix: [number, number, number];
  /** Random variation between firings (lumpy idle). */
  rough: number;
  /** Uneven firing intervals, like a cross-plane V8 burble. */
  uneven: number;
  /** Diesel injector clatter. */
  clatter: number;
  /** Low "thump" level. */
  thump: number;
  /** Exhaust pops when lifting off at high rpm. */
  pops: number;
  /** Turbocharger: whistle level under boost (0 = naturally aspirated). */
  turbo?: number;
  /** Electric motor whine instead of combustion. */
  electric?: boolean;
  /** Electric motor details (only with `electric`). */
  ev?: EvProfile;
  /** Overall level trim. */
  level: number;
}

/**
 * An electric drive is a single-speed motor fed by an inverter. What you hear: the motor's
 * magnetic orders (multiples of its electrical frequency), the reduction gear's mesh whine, the
 * inverter's switching tone (which steps between ratios as speed rises, like an electric train),
 * a cooling fan, and a quiet standby hum when it's switched on but not moving.
 */
export interface EvProfile {
  /** Motor pole pairs: electrical Hz = rpm / 60 × poles. */
  poles: number;
  /** Motor orders [multiple, level]; orders of 6 and above grow with torque. */
  orders: [number, number][];
  /** Gear mesh frequency as a multiple of the electrical frequency, and its level. */
  gear: number;
  gearLevel: number;
  /** Inverter switching tone: base Hz at low speed, then [above electrical Hz, ratio] steps. */
  carrier: number;
  steps: [number, number][];
  carrierLevel: number;
  /** Standby hum level (with a slow "breathing" pulse) and cooling fan level. */
  hum: number;
  fan: number;
  /** Extra gear whine when coasting (regenerative braking). */
  regen: number;
}

const INLINE4: EngineProfile = {
  cylinders: 4,
  idle: 800,
  redline: 6800,
  formants: [115, 390, 1500],
  bandwidths: [45, 140, 600],
  mix: [1, 0.7, 0.3],
  rough: 0.15,
  uneven: 0,
  clatter: 0,
  thump: 1.2,
  pops: 0.4,
  level: 0.92,
};

export const ENGINES: Record<string, EngineProfile> = {
  inline4: INLINE4,
  turbo4: {
    ...INLINE4,
    idle: 900,
    redline: 7200,
    formants: [125, 420, 1700],
    bandwidths: [50, 150, 650],
    mix: [1, 0.75, 0.4],
    rough: 0.12,
    pops: 0.9,
    turbo: 0.8,
    level: 0.92,
  },
  v8: {
    cylinders: 8,
    idle: 650,
    redline: 6000,
    formants: [72, 230, 950],
    bandwidths: [30, 90, 400],
    mix: [1.2, 0.7, 0.25],
    rough: 0.3,
    uneven: 0.35,
    clatter: 0,
    thump: 1.8,
    pops: 0.8,
    level: 0.95,
  },
  bigcam: {
    cylinders: 8,
    idle: 750,
    redline: 6800,
    formants: [80, 260, 1100],
    bandwidths: [35, 100, 450],
    mix: [1.2, 0.8, 0.35],
    rough: 0.55,
    uneven: 0.5,
    clatter: 0,
    thump: 2,
    pops: 1,
    level: 0.8,
  },
  diesel: {
    cylinders: 6,
    idle: 600,
    redline: 3800,
    formants: [62, 190, 700],
    bandwidths: [25, 80, 300],
    mix: [1.2, 0.6, 0.2],
    rough: 0.2,
    uneven: 0,
    clatter: 0.9,
    thump: 2,
    pops: 0,
    level: 0.72,
  },
  race: {
    cylinders: 6,
    idle: 1100,
    redline: 8500,
    formants: [150, 520, 2100],
    bandwidths: [60, 180, 700],
    mix: [0.9, 0.9, 0.45],
    rough: 0.08,
    uneven: 0,
    clatter: 0,
    thump: 0.9,
    pops: 0.9,
    turbo: 0.6,
    level: 1.5,
  },
  flat4: {
    cylinders: 4,
    idle: 850,
    redline: 6200,
    formants: [130, 430, 1800],
    bandwidths: [55, 170, 700],
    mix: [1, 0.8, 0.45],
    rough: 0.28,
    uneven: 0.18,
    clatter: 0,
    thump: 1.1,
    pops: 0.5,
    level: 0.78,
  },
  twin: {
    cylinders: 2,
    idle: 1100,
    redline: 7000,
    formants: [170, 520, 1900],
    bandwidths: [70, 190, 700],
    mix: [1, 0.8, 0.45],
    rough: 0.35,
    uneven: 0.25,
    clatter: 0.15,
    thump: 0.9,
    pops: 0.3,
    level: 0.62,
  },
  v10: {
    cylinders: 10,
    idle: 1400,
    redline: 9800,
    formants: [190, 640, 2500],
    bandwidths: [70, 200, 800],
    mix: [0.85, 1, 0.55],
    rough: 0.06,
    uneven: 0,
    clatter: 0,
    thump: 0.8,
    pops: 0.7,
    level: 1.35,
  },
  inline6: {
    cylinders: 6,
    idle: 700,
    redline: 6000,
    formants: [95, 320, 1250],
    bandwidths: [40, 120, 500],
    mix: [1.1, 0.7, 0.3],
    rough: 0.18,
    uneven: 0,
    clatter: 0,
    thump: 1.5,
    pops: 0.4,
    level: 1.05,
  },
  rover: {
    cylinders: 1,
    idle: 0,
    redline: 9000,
    formants: [0, 0, 0],
    bandwidths: [0, 0, 0],
    mix: [0, 0, 0],
    rough: 0,
    uneven: 0,
    clatter: 0,
    thump: 0,
    pops: 0,
    electric: true,
    ev: {
      poles: 4,
      orders: [[1, 0.32], [2, 0.16], [3, 0.07], [6, 0.11], [12, 0.06], [24, 0.025]],
      gear: 3.3,
      gearLevel: 0.2,
      carrier: 1250,
      steps: [[140, 9], [230, 7], [330, 5], [460, 3]],
      carrierLevel: 0.13,
      hum: 0.16,
      fan: 0.1,
      regen: 0.5,
    },
    level: 1.15,
  },
  electric: {
    cylinders: 1,
    idle: 0,
    redline: 9000,
    formants: [0, 0, 0],
    bandwidths: [0, 0, 0],
    mix: [0, 0, 0],
    rough: 0,
    uneven: 0,
    clatter: 0,
    thump: 0,
    pops: 0,
    electric: true,
    ev: {
      poles: 2,
      orders: [[1, 0.45], [3, 0.14], [6, 0.05]],
      gear: 2.97,
      gearLevel: 0.12,
      carrier: 1000,
      steps: [],
      carrierLevel: 0.05,
      hum: 0.05,
      fan: 0.04,
      regen: 0.2,
    },
    level: 1.3,
  },
};

const VEHICLE_ENGINE: Record<string, string> = {
  pickup: "inline4",
  taxi: "inline4",
  rally: "turbo4",
  monster: "v8",
  police: "v8",
  fire: "v8",
  hotrod: "bigcam",
  tractor: "diesel",
  van: "diesel",
  camper: "diesel",
  icecream: "diesel",
  dump: "diesel",
  racer: "race",
  coupe: "race",
  buggy: "flat4",
  jeep: "inline6",
  golf: "electric",
  rover: "rover",
  promax: "race",
  rocket: "v10",
  eggplane: "flat4",
  tuktuk: "twin",
  schoolbus: "diesel",
  snowcat: "diesel",
  limo: "v8",
  formula: "v10",
};

/** Sets which engine sound a (custom) vehicle uses. */
export function setVehicleEngine(vehicleId: string, engine: string): void {
  VEHICLE_ENGINE[vehicleId] = engine;
}

export function engineFor(vehicleId: string): EngineProfile {
  return ENGINES[VEHICLE_ENGINE[vehicleId] ?? "inline4"] ?? INLINE4;
}

/** The AudioWorklet processor, loaded from a Blob URL. Plain JS (runs in the audio thread). */
/** Drive into the soft clipper: measured so full throttle peaks below the clip point. */
export const ENGINE_DRIVE = 0.35;

export const ENGINE_WORKLET = `
const DRIVE = ${ENGINE_DRIVE};
class EngineSynth extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rpm", defaultValue: 800, minValue: 0, maxValue: 12000, automationRate: "k-rate" },
      { name: "load", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "gain", defaultValue: 0, minValue: 0, maxValue: 4, automationRate: "k-rate" },
      { name: "boost", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "gearHz", defaultValue: 0, minValue: 0, maxValue: 8000, automationRate: "k-rate" },
    ];
  }
  constructor(options) {
    super();
    this.p = null;
    // Overall drive into the soft clipper (tuned so full throttle is loud but not crushed)
    this.drive = (options && options.processorOptions && options.processorOptions.drive) || DRIVE;
    this.phase = 0;
    this.interval = 1;
    this.cyl = 0;
    this.amp = 0;
    this.env = 0;
    this.noiseEnv = 0;
    this.clatEnv = 0;
    this.popEnv = 0;
    this.popAmp = 0;
    this.lp = 0;
    this.hp = 0;
    this.y1 = [0, 0, 0];
    this.y2 = [0, 0, 0];
    this.w1 = 0;
    this.w2 = 0;
    this.tw = 0;
    this.liftTime = 0;
    this.popLp = 0;
    // Exhaust pipe: a short feedback delay that resonates (booms) when engine harmonics hit its pitch
    this.pipeBuf = new Float32Array(4096);
    this.pipeIdx = 0;
    // Valve-train tick and gearbox whine
    this.tickEnv = 0;
    this.tickLp = 0;
    this.gw = 0;
    this.smoothGear = 0;
    this.pm = 0;
    this.pg = 0;
    this.pc = 0;
    this.ph = 0;
    this.breath = 0;
    this.fanLp = 0;
    this.fc = 1000;
    this.regen = 0;
    this.smoothBoost = 0;
    this.smoothRpm = 800;
    this.smoothLoad = 0;
    this.envDecay = Math.exp(-1 / (sampleRate * 0.0022));
    this.noiseDecay = Math.exp(-1 / (sampleRate * 0.0012));
    this.clatDecay = Math.exp(-1 / (sampleRate * 0.0004));
    this.popDecay = Math.exp(-1 / (sampleRate * 0.006));
    this.port.onmessage = (e) => this.setProfile(e.data);
    // The profile arrives with the node so the engine never starts silent.
    if (options && options.processorOptions && options.processorOptions.profile) this.setProfile(options.processorOptions.profile);
  }
  /** Clears every filter, envelope and delay line (recovery from a bad value). */
  reset() {
    this.y1 = [0, 0, 0];
    this.y2 = [0, 0, 0];
    this.lp = this.hp = this.tickLp = this.popLp = this.fanLp = 0;
    this.env = this.noiseEnv = this.clatEnv = this.popEnv = this.tickEnv = 0;
    if (this.pipeBuf) this.pipeBuf.fill(0);
    if (!(this.smoothRpm === this.smoothRpm)) this.smoothRpm = 800;
    if (!(this.smoothLoad === this.smoothLoad)) this.smoothLoad = 0;
    if (!(this.smoothBoost === this.smoothBoost)) this.smoothBoost = 0;
    if (!(this.smoothGear === this.smoothGear)) this.smoothGear = 0;
    if (!(this.regen === this.regen)) this.regen = 0;
  }

  setProfile(p) {
    this.p = p;
    this.r = [];
    this.a1 = [];
    this.a2 = [];
    this.b0 = [];
    for (let k = 0; k < 3; k++) {
      const f = Math.min(p.formants[k], sampleRate * 0.45);
      const r = Math.exp(-Math.PI * Math.max(1, p.bandwidths[k]) / sampleRate);
      this.a1[k] = 2 * r * Math.cos((2 * Math.PI * f) / sampleRate);
      this.a2[k] = r * r;
      this.b0[k] = (1 - r * r) * 0.5;
    }
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const p = this.p;
    if (!out) return true;
    if (!p) { out.fill(0); return true; }
    const n = out.length;
    // Every input is clamped to a safe range: some browsers pass automation values through
    // unclamped, and one bad number would otherwise silence the whole game's sound.
    const safe = (v, lo, hi) => (v >= lo && v <= hi ? v : v > hi ? hi : lo);
    const gain = safe(params.gain[0], 0, 4);
    // Smooth control changes to avoid zipper noise
    this.smoothRpm += (safe(params.rpm[0], 0, 12000) - this.smoothRpm) * 0.2;
    this.smoothLoad += (safe(params.load[0], 0, 1) - this.smoothLoad) * 0.15;
    const rpm = this.smoothRpm;
    const load = this.smoothLoad;
    this.smoothBoost += (safe(params.boost[0], 0, 1) - this.smoothBoost) * 0.1;
    const boost = this.smoothBoost;
    if (gain <= 0.0005 && Math.abs(this.lp) < 1e-5) { out.fill(0); return true; }

    if (p.electric) {
      const ev = p.ev;
      const TAU = 6.283185307;
      const rpmNorm = Math.min(1, rpm / p.redline);
      const fm = 20 + (rpm / 60) * ev.poles; // electrical frequency
      // Inverter tone: a fixed carrier at low speed, then locked to the motor at stepped ratios
      let fc = ev.carrier;
      for (const st of ev.steps) if (fm > st[0]) fc = Math.max(ev.carrier * 0.8, fm * st[1]);
      this.fc += (fc - this.fc) * 0.35;
      // Coasting at speed = regenerative braking: the drive keeps singing
      this.regen += ((load < 0.05 ? rpmNorm : 0) - this.regen) * 0.05;
      const torque = 0.2 + 0.8 * load + this.regen * 0.5;
      const moving = Math.min(1, rpm / 600);
      const fanCoef = 1 - Math.exp(-TAU * 700 / sampleRate);
      const humLvl = ev.hum * (1 - 0.85 * rpmNorm);
      const carLvl = ev.carrierLevel * torque * moving * (1 - 0.65 * rpmNorm);
      const gearLvl = ev.gearLevel * Math.sqrt(rpmNorm) * (0.35 + 0.65 * load + this.regen * ev.regen);
      for (let i = 0; i < n; i++) {
        this.pm += fm / sampleRate;
        if (this.pm > 1000) this.pm -= 1000;
        this.pg += (fm * ev.gear) / sampleRate;
        if (this.pg > 1000) this.pg -= 1000;
        this.pc += this.fc / sampleRate;
        if (this.pc > 1000) this.pc -= 1000;
        this.ph += 100 / sampleRate;
        if (this.ph > 1000) this.ph -= 1000;
        this.breath += 0.7 / sampleRate;
        if (this.breath > 1) this.breath -= 1;
        let s = 0;
        // Motor orders (skip any above the audible band)
        for (const o of ev.orders) {
          if (fm * o[0] > 16000) continue;
          s += Math.sin(TAU * o[0] * this.pm) * o[1] * (o[0] >= 6 ? torque : 0.5 + 0.5 * torque) * moving;
        }
        s += Math.sin(TAU * this.pg) * gearLvl;
        // Switching tone with sidebands at carrier ± 2× electrical frequency
        s += Math.sin(TAU * this.pc) * (0.6 + 0.4 * Math.cos(TAU * 2 * this.pm)) * carLvl;
        // Standby hum: 100 Hz plus harmonics, gently pulsing
        const pulse = 0.75 + 0.25 * Math.sin(TAU * this.breath);
        s += (Math.sin(TAU * this.ph) + 0.4 * Math.sin(TAU * 3 * this.ph) + 0.15 * Math.sin(TAU * 5 * this.ph)) * humLvl * pulse;
        // Cooling fan: soft filtered air, faster under load
        const noise = Math.random() * 2 - 1;
        this.fanLp += (noise - this.fanLp) * fanCoef;
        s += this.fanLp * ev.fan * (0.5 + 0.5 * Math.max(load, rpmNorm)) * 2.5;
        const sample = Math.tanh(s * gain * p.level) * 0.55;
        out[i] = sample === sample ? sample : 0;
      }
      return true;
    }

    const rpmNorm = Math.min(1, rpm / p.redline);
    const fire = Math.max(2, (rpm / 60) * (p.cylinders / 2));
    const lpCoef = 1 - Math.exp(-2 * Math.PI * 140 / sampleRate);
    // Turbo whistle: a slightly unsteady sine that climbs with boost
    const turbo = p.turbo ? p.turbo * boost * boost * 0.065 : 0;
    const tf = 1800 + boost * 4200 + rpmNorm * 1200;
    // Pipe resonance pitch: from the exhaust body formant (longer pipes on big engines boom lower)
    const pipeLen = Math.max(40, Math.min(4000, Math.round(sampleRate / Math.max(30, p.formants[0] * 0.85))));
    const tickDecay = Math.exp(-1 / (sampleRate * 0.00035));
    const tickLvl = 0.01 * Math.pow(rpmNorm, 1.5) * (p.clatter ? 0.5 : 1);
    this.smoothGear += (safe(params.gearHz ? params.gearHz[0] : 0, 0, 8000) - this.smoothGear) * 0.2;
    const gearHz = this.smoothGear;
    const whine = gearHz > 40 ? 0.011 * Math.min(1, gearHz / 900) * (0.35 + 0.65 * load) : 0;
    // Overrun pops: a few in the first second or so after lifting off at high revs, then quiet
    if (load < 0.05) this.liftTime += n / sampleRate;
    else this.liftTime = 0;
    const popWindow = Math.max(0, 1 - this.liftTime / 1.4);
    const popRate = p.pops > 0 && load < 0.05 && rpmNorm > 0.55 ? (rpmNorm - 0.55) * 9 * p.pops * popWindow : 0;
    for (let i = 0; i < n; i++) {
      this.phase += (fire / sampleRate) * this.interval;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.cyl = (this.cyl + 1) % p.cylinders;
        // Uneven firing gaps (burble), fading out as revs rise
        this.interval = 1 + p.uneven * (this.cyl % 2 ? 0.35 : -0.35) * (1 - rpmNorm);
        const rnd = Math.random() * 2 - 1;
        this.amp = (0.3 + 0.7 * load) * (1 + p.rough * rnd * (1.15 - rpmNorm)) * (1 + 0.03 * Math.sin(this.cyl * 2.1));
        this.env = 1;
        this.noiseEnv = 1;
        this.clatEnv = 1;
        this.tickEnv = 1;
      }
      if (popRate > 0 && Math.random() < popRate / sampleRate) {
        this.popEnv = 1;
        this.popAmp = 0.4 + Math.random() * 0.5;
      }
      this.env *= this.envDecay;
      this.noiseEnv *= this.noiseDecay;
      this.clatEnv *= this.clatDecay;
      this.popEnv *= this.popDecay;
      const noise = Math.random() * 2 - 1;
      this.popLp += (noise - this.popLp) * 0.25;
      // Excitation: a combustion thump plus a short noisy burst; backfire pops on overrun
      const x = this.amp * (this.env + noise * this.noiseEnv * (0.3 + 0.6 * load)) + this.popLp * this.popEnv * this.popAmp;
      let y = 0;
      for (let k = 0; k < 3; k++) {
        const v = this.b0[k] * x + this.a1[k] * this.y1[k] - this.a2[k] * this.y2[k];
        this.y2[k] = this.y1[k];
        this.y1[k] = v;
        y += v * p.mix[k];
      }
      // Low thump and diesel clatter
      this.lp += (x - this.lp) * lpCoef;
      y += this.lp * p.thump * 0.6;
      if (p.clatter) y += noise * this.clatEnv * p.clatter * 0.12 * (0.5 + load);
      // Exhaust pipe resonance (feedback comb): adds body and an rpm-dependent "boom"
      const N = 4096;
      const back = this.pipeBuf[(this.pipeIdx - pipeLen + N) % N];
      const res = y + back * 0.38;
      this.pipeBuf[this.pipeIdx] = res;
      this.pipeIdx = (this.pipeIdx + 1) % N;
      y = y * 0.75 + res * 0.4;
      // Valve-train tick: a tiny bright click with each firing, louder at high rpm
      this.tickEnv *= tickDecay;
      this.tickLp += (noise - this.tickLp) * 0.35;
      y += (noise - this.tickLp) * this.tickEnv * tickLvl;
      // Remove DC, then soft-clip for a bit of grit at high load
      this.hp += (y - this.hp) * 0.002;
      const s = (y - this.hp) * gain * p.level * this.drive;
      let o = Math.tanh(s) * 0.55;
      if (turbo > 0) {
        this.tw += (2 * Math.PI * tf * (1 + 0.004 * Math.sin(this.tw * 0.0007))) / sampleRate;
        if (this.tw > 1e6) this.tw -= 6.283185 * 159154;
        o += (Math.sin(this.tw) + noise * 0.15) * turbo * Math.min(1.5, gain);
      }
      // Gearbox whine: rises and falls with road speed in each gear
      if (whine > 0) {
        this.gw += (6.283185 * gearHz) / sampleRate;
        if (this.gw > 6.283185) this.gw -= 6.283185;
        o += Math.sin(this.gw) * whine * Math.min(1.5, gain);
      }
      // Never let an invalid sample out: reset the synth's filters and output silence instead
      if (o !== o || o > 4 || o < -4) {
        this.reset();
        o = 0;
      }
      out[i] = o;
    }
    return true;
  }
}
registerProcessor("engine-synth", EngineSynth);
`;
