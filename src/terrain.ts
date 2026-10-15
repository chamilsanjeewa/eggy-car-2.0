import { World, Vec2, Chain, Body } from "planck";
import { Difficulty } from "./difficulty";
import { MapDef } from "./maps";

/** Horizontal distance between terrain vertices, in meters. */
export const SEG = 0.5;
const CHUNK_SEGS = 120; // 60 m per physics chunk
const START_X = -20; // left boundary of the world

/** Jump ramps that guard each glue bottle. Distances are relative to the ramp's lip. */
export const RAMP = {
  /** Length of the run-up ramp before the lip. */
  length: 7,
  /** Height of the lip above the flattened ground. */
  height: 1.6,
  /** Length of the smooth landing slope after the lip. */
  landing: 9,
  /** Bottle position: meters past the lip, and height above the lip. */
  bottleDist: 6,
  bottleHeight: 3.2,
};

/**
 * Canyon forks: the road dips into a valley while a bridge (with a gap to jump) spans it.
 * Distances are relative to the fork's start.
 */
export const FORK = {
  length: 44,
  depth: 2.4,
  /** Length of the valley's down/up slopes (long and gentle so the valley road is safe at speed). */
  slope: 15,
  gapStart: 20,
  gapEnd: 23,
  /** Small kicker on the deck just before the gap. */
  kick: 0.35,
};

const FLAT_BEFORE = 13; // ground is straightened from here before a feature...
const FLAT_EASE = 9; // ...and blended back into the natural hills over this distance

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export type PowerUpKind = "glue" | "fuel" | "life";

export interface PowerUp {
  kind: PowerUpKind;
  x: number;
  y: number;
  taken: boolean;
  takenAt: number;
}

export interface Coin {
  x: number;
  y: number;
  /** Coins worth more are big and placed in hard-to-reach spots. */
  value: number;
  taken: boolean;
  takenAt: number;
}

export const BIG_COIN_VALUE = 10;

export interface Feature {
  kind: "ramp" | "fork";
  /** Ramp: x of the lip. Fork: x where the valley starts. */
  x: number;
}

export interface Fork {
  x: number;
  index: number;
  /** Which way the player went; decided as they reach the fork. */
  choice: "bridge" | "valley" | null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1D smooth value noise in [-1, 1]. */
class Noise1D {
  private values: number[] = [];
  constructor(private rand: () => number) {}

  private lattice(i: number): number {
    while (this.values.length <= i) this.values.push(this.rand() * 2 - 1);
    return this.values[i];
  }

  at(x: number): number {
    const i = Math.floor(x);
    const t = x - i;
    const s = (1 - Math.cos(t * Math.PI)) / 2;
    return this.lattice(i) * (1 - s) + this.lattice(i + 1) * s;
  }
}

export class Terrain {
  readonly coins: Coin[] = [];
  readonly powerUps: PowerUp[] = [];
  readonly features: Feature[] = [];
  readonly forks: Fork[] = [];
  private noiseA: Noise1D;
  private noiseB: Noise1D;
  private noiseC: Noise1D;
  private heights = new Map<number, number>();
  private chunks: { index: number; body: Body }[] = [];
  private nextChunk = 0;
  private nextCoinX = 35;
  private nextFeatureX: number;
  private nextFuelX = 170;
  private nextLifeX: number;
  private nextBigCoinX = 90;
  private rand: () => number;
  private featureRand: () => number;
  private itemRand: () => number;

  /** `finishX` marks the end of a time-trial course (no features are placed near it). */
  constructor(
    private world: World,
    seed: number,
    private difficulty: Difficulty,
    readonly map: MapDef,
    readonly finishX: number | null = null,
  ) {
    this.rand = mulberry32(seed);
    this.noiseA = new Noise1D(mulberry32(seed + 1));
    this.noiseB = new Noise1D(mulberry32(seed + 2));
    this.noiseC = new Noise1D(mulberry32(seed + 3));
    this.featureRand = mulberry32(seed + 4);
    this.itemRand = mulberry32(seed + 5);
    this.nextFeatureX = 150 + 80 * this.featureRand();
    this.nextLifeX = 600 + 400 * this.itemRand();

    // Wall at the far left so the car can't reverse off the world.
    const wall = world.createBody({ type: "static" });
    wall.createFixture({
      shape: new Chain([new Vec2(START_X, 30), new Vec2(START_X, this.height(START_X))], false),
      friction: map.groundFriction,
      userData: "ground",
    });
  }

  /** ---------- shape ---------- */

  private static extent(f: Feature): [number, number] {
    return f.kind === "ramp" ? [f.x - FLAT_BEFORE, f.x + 14] : [f.x - FLAT_BEFORE, f.x + FORK.length + 4];
  }

  private featureNear(x: number): Feature | undefined {
    for (const f of this.features) {
      const [a, b] = Terrain.extent(f);
      if (x < a - FLAT_EASE) return undefined;
      if (x <= b + FLAT_EASE) return f;
    }
    return undefined;
  }

  /** The straight incline a feature sits on, and how strongly it replaces the hills at x. */
  private featureBase(f: Feature, x: number): { line: number; w: number } {
    const [a, b] = Terrain.extent(f);
    const x0 = a - FLAT_EASE;
    const x1 = b + FLAT_EASE;
    const h0 = this.baseHeight(x0);
    const h1 = this.baseHeight(x1);
    const line = h0 + ((h1 - h0) * (x - x0)) / (x1 - x0);
    const w = x < a ? smoothstep((x - x0) / FLAT_EASE) : x > b ? 1 - smoothstep((x - b) / FLAT_EASE) : 1;
    return { line, w };
  }

  /** Terrain (road) height at world x, including ramps and canyon valleys. */
  height(x: number): number {
    const f = this.featureNear(x);
    if (!f) return this.baseHeight(x);
    const { line, w } = this.featureBase(f, x);
    const d = x - f.x;
    let shape = 0;
    if (f.kind === "ramp") {
      if (d > -RAMP.length && d <= 0) shape = RAMP.height * Math.pow((d + RAMP.length) / RAMP.length, 1.5);
      else if (d > 0 && d < RAMP.landing) shape = RAMP.height * (1 - smoothstep(d / RAMP.landing));
    } else if (d > 0 && d < FORK.length) {
      const down = smoothstep(d / FORK.slope);
      const up = 1 - smoothstep((d - (FORK.length - FORK.slope)) / FORK.slope);
      shape = -FORK.depth * Math.min(down, up);
    }
    return this.baseHeight(x) * (1 - w) + line * w + shape;
  }

  /** Bridge deck height over a fork at offset d from its start. */
  deckHeight(fork: Fork, d: number): number {
    const f = this.features.find((q) => q.kind === "fork" && q.x === fork.x)!;
    const { line } = this.featureBase(f, fork.x + d);
    const k0 = FORK.gapStart - 3;
    const kick = d > k0 && d <= FORK.gapStart ? FORK.kick * Math.pow((d - k0) / 3, 2) : 0;
    return line + kick;
  }

  private baseHeight(x: number): number {
    if (x < 10) return 0;
    const { rampDistance, hillScale } = this.difficulty;
    const d = Math.min(1, (x - 10) / rampDistance); // hills grow over the ramp distance
    const blend = Math.min(1, (x - 10) / 25); // ease out of the flat start
    const s = this.map.shape;
    const h =
      this.noiseA.at(x / s.waveA) * (2.5 + 4.5 * d) * s.ampA +
      this.noiseB.at(x / s.waveB) * (0.8 + 1.7 * d) * s.ampB +
      this.noiseC.at(x / s.waveC) * (0.1 + 0.35 * d) * s.ampC;
    return h * blend * hillScale;
  }

  /** Cached height at vertex index i (x = START_X + i * SEG). */
  vertexHeight(i: number): number {
    let h = this.heights.get(i);
    if (h === undefined) {
      h = this.height(START_X + i * SEG);
      this.heights.set(i, h);
    }
    return h;
  }

  vertexIndex(x: number): number {
    return Math.floor((x - START_X) / SEG);
  }

  vertexX(i: number): number {
    return START_X + i * SEG;
  }

  /** Whether x lies within `margin` of a ramp or fork. */
  nearFeature(x: number, margin = 0): boolean {
    return this.features.some((f) => {
      const [a, b] = Terrain.extent(f);
      return x > a - FLAT_EASE - margin && x < b + FLAT_EASE + margin;
    });
  }

  /** ---------- streaming ---------- */

  /** Make sure physics exists ahead of `x` and drop chunks far behind `behindX`. */
  update(x: number, behindX: number): void {
    // Features must be planned before any height near them is sampled.
    while (this.nextFeatureX < x + 300) this.planFeature();
    const chunkLen = CHUNK_SEGS * SEG;
    while (START_X + this.nextChunk * chunkLen < x + 80) {
      this.buildChunk(this.nextChunk++);
    }
    while (this.chunks.length > 2 && START_X + (this.chunks[0].index + 1) * chunkLen < behindX - 30) {
      this.world.destroyBody(this.chunks.shift()!.body);
    }
    while (this.nextCoinX < x + 80) this.spawnCoins();
    while (this.nextFuelX < x + 120) this.spawnFuel();
    while (this.nextLifeX < x + 120) this.spawnLife();
    while (this.nextBigCoinX < x + 120) this.spawnBigCoin();
  }

  private buildChunk(index: number): void {
    const first = index * CHUNK_SEGS;
    const verts: Vec2[] = [];
    for (let i = first; i <= first + CHUNK_SEGS; i++) {
      verts.push(new Vec2(this.vertexX(i), this.vertexHeight(i)));
    }
    const chain = new Chain(verts, false);
    // Ghost vertices so wheels roll smoothly across chunk seams.
    chain.setPrevVertex(new Vec2(this.vertexX(first - 1), this.vertexHeight(first - 1)));
    chain.setNextVertex(new Vec2(this.vertexX(first + CHUNK_SEGS + 1), this.vertexHeight(first + CHUNK_SEGS + 1)));

    const body = this.world.createBody({ type: "static" });
    body.createFixture({ shape: chain, friction: this.map.groundFriction, userData: "ground" });
    this.chunks.push({ index, body });
  }

  /** ---------- features ---------- */

  /**
   * Every ~180–400 m: a glue bottle challenge. Normally a jump ramp with the bottle hanging high
   * above the landing; on fork maps an optional bridge with the bottle over a gap.
   */
  private planFeature(): void {
    const kind = this.map.forks ? "fork" : "ramp";
    const x = this.calmestSpot(kind, this.nextFeatureX, this.nextFeatureX + 150);
    this.nextFeatureX = x + 180 + this.featureRand() * 220;
    if (this.finishX !== null && x > this.finishX - 80) return; // keep the finish straight clear
    this.features.push({ kind, x });

    if (kind === "ramp") {
      const lipY = this.height(x);
      this.powerUps.push({ kind: "glue", x: x + RAMP.bottleDist, y: lipY + RAMP.bottleHeight, taken: false, takenAt: 0 });
      // Even higher and further: a big coin for a full-speed launch.
      this.coins.push({ x: x + 11, y: lipY + 4.4, value: BIG_COIN_VALUE, taken: false, takenAt: 0 });
    } else {
      const fork: Fork = { x, index: this.forks.length, choice: null };
      this.forks.push(fork);
      this.buildBridge(fork);
      const mid = (FORK.gapStart + FORK.gapEnd) / 2;
      const deck = this.deckHeight(fork, mid);
      this.powerUps.push({ kind: "glue", x: x + mid, y: deck + 1.3, taken: false, takenAt: 0 });
      this.coins.push({ x: x + mid, y: deck + 3.4, value: BIG_COIN_VALUE, taken: false, takenAt: 0 });
    }
  }

  /** Static bridge decks (two spans with a gap). Collision is enabled only for drivers who chose the bridge. */
  private buildBridge(fork: Fork): void {
    const body = this.world.createBody({ type: "static" });
    const span = (from: number, to: number) => {
      const verts: Vec2[] = [];
      for (let d = from; d <= to + 1e-6; d += SEG) verts.push(new Vec2(fork.x + d, this.deckHeight(fork, d)));
      body.createFixture({ shape: new Chain(verts, false), friction: this.map.groundFriction, userData: `bridge:${fork.index}` });
    };
    span(0, FORK.gapStart);
    span(FORK.gapEnd, FORK.length);
  }

  /**
   * Picks the position in [from, to] where the natural hills deviate least from the straight
   * incline the feature sits on, so blending into it never creates a sharp dip or wall.
   */
  private calmestSpot(kind: Feature["kind"], from: number, to: number): number {
    let best = from;
    let bestScore = Infinity;
    for (let x = from; x <= to; x += 4) {
      const [a, b] = Terrain.extent({ kind, x });
      const x0 = a - FLAT_EASE;
      const x1 = b + FLAT_EASE;
      const h0 = this.baseHeight(x0);
      const h1 = this.baseHeight(x1);
      let score = Math.abs(h1 - h0) / (x1 - x0); // prefer a level incline
      for (let s = x0; s <= x1; s += 1) {
        score = Math.max(score, Math.abs(this.baseHeight(s) - (h0 + ((h1 - h0) * (s - x0)) / (x1 - x0))) / 6);
      }
      if (score < bestScore) {
        bestScore = score;
        best = x;
      }
    }
    return best;
  }

  /** ---------- pickups ---------- */

  /** Moves x forward until it's clear of features. */
  private clearSpot(x: number, margin: number): number {
    while (this.nearFeature(x, margin)) x += 5;
    return x;
  }

  private spawnCoins(): void {
    const count = 3 + Math.floor(this.rand() * 4);
    let start = this.clearSpot(this.nextCoinX, 2);
    while (this.nearFeature(start + count * 1.3, 2)) start = this.clearSpot(start + 5, 2);
    for (let k = 0; k < count; k++) {
      const x = start + k * 1.3;
      this.coins.push({ x, y: this.height(x) + 1.6, value: 1, taken: false, takenAt: 0 });
    }
    this.nextCoinX = start + count * 1.3 + 25 + this.rand() * 30;
  }

  /** Fuel cans sit on the road every ~200–330 m. */
  private spawnFuel(): void {
    const x = this.clearSpot(this.nextFuelX, 3);
    this.powerUps.push({ kind: "fuel", x, y: this.height(x) + 0.75, taken: false, takenAt: 0 });
    this.nextFuelX = x + 200 + this.itemRand() * 130;
  }

  /** A rare extra life every ~700–1100 m. */
  private spawnLife(): void {
    const x = this.clearSpot(this.nextLifeX, 3);
    this.powerUps.push({ kind: "life", x, y: this.height(x) + 1.2, taken: false, takenAt: 0 });
    this.nextLifeX = x + 700 + this.itemRand() * 400;
  }

  /** Big coins float high above hill crests: you need speed to catch air over the top. */
  private spawnBigCoin(): void {
    let x = this.clearSpot(this.nextBigCoinX, 5);
    // Find the highest point within the next 40 m.
    let crest = x;
    for (let s = x; s < x + 40; s += 1) {
      if (!this.nearFeature(s, 5) && this.height(s) > this.height(crest)) crest = s;
    }
    x = crest + 2;
    this.coins.push({ x, y: this.height(crest) + 3.6, value: BIG_COIN_VALUE, taken: false, takenAt: 0 });
    this.nextBigCoinX = x + 160 + this.itemRand() * 120;
  }
}
