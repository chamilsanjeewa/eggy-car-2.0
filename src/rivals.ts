/**
 * Race mode rivals: computer drivers in their own cars, each carrying an egg, racing you to the
 * finish. They are full physics cars on the same course but pass through you (no bumping).
 */
import { World, Vec2 } from "planck";
import { Car, MAX_RIVALS } from "./car";
import { Terrain } from "./terrain";
import { VEHICLES, VehicleDef } from "./vehicles";
import { applyMods, NO_MODS } from "./upgrades";
import { airDensity } from "./maps";

export type RivalSkillId = "rookie" | "pro" | "champion" | "legend";

export interface RivalSkill {
  id: RivalSkillId;
  name: string;
  blurb: string;
  /** Cruising speed as a fraction of the car's top speed. */
  pace: number;
  /** How much they slow for downhills and jumps (0 = never, 1 = a lot). */
  caution: number;
  /** Seconds lost after cracking an egg before they're back on the road. */
  recover: number;
  /** Rivals drive cars from the fastest this fraction of the garage (1 = any car). */
  carPick: number;
  /** Engine and tire upgrade level on their cars. */
  upgrades: number;
  /** Extra pace while they're behind you, so they hunt you down. */
  catchUp: number;
  /** Egg grip multiplier: better drivers keep their egg settled. */
  grip: number;
  /** Slipstream push (m/s²) when tucked in behind you, up to 30 m back. */
  draft: number;
}

export const RIVAL_SKILLS: RivalSkill[] = [
  { id: "rookie", name: "Rookie", blurb: "Quick, upgraded cars. Clean, fast driving wins.", pace: 0.86, caution: 0.35, recover: 1.6, carPick: 0.7, upgrades: 2, catchUp: 0.1, grip: 1.1, draft: 0.6 },
  { id: "pro", name: "Pro", blurb: "Fast cars, fully tuned, rarely drop their egg. You'll need to push.", pace: 0.95, caution: 0.18, recover: 1.1, carPick: 0.45, upgrades: 4, catchUp: 0.15, grip: 1.25, draft: 1.1 },
  { id: "champion", name: "Champion", blurb: "The quickest cars, flat out everywhere, slipstreaming you.", pace: 1, caution: 0.08, recover: 0.7, carPick: 0.35, upgrades: 4, catchUp: 0.2, grip: 1.55, draft: 1.6 },
  { id: "legend", name: "Legend", blurb: "Beyond-max race-tuned cars that never lift. Almost unbeatable.", pace: 1, caution: 0.04, recover: 0.4, carPick: 0.25, upgrades: 5, catchUp: 0.25, grip: 1.9, draft: 2.4 },
];

export const rivalSkillById = (id: string) => RIVAL_SKILLS.find((s) => s.id === id) ?? RIVAL_SKILLS[0];

const NAMES = ["Blaze", "Pepper", "Rusty", "Nova", "Pixel", "Bolt", "Maple", "Ziggy", "Comet", "Juniper", "Dash", "Sunny"];
const PAINTS = ["red", "orange", "lime", "teal", "blue", "purple", "pink", "black", "white"];

/** Rivals start in a staggered grid just ahead of you (you start from the back). */
const GRID_GAP = 4.5;

export class Rival {
  readonly car: Car;
  finishTime: number | null = null;
  eggBroken = false;
  /** Seconds until the rival is back on the road after a crash. */
  private recoverTimer = 0;
  private stuckTimer = 0;
  private flipTimer = 0;
  /** Per-driver variation, so a field of rivals doesn't drive in lockstep. */
  private readonly jitter: number;
  private readonly wobble: number;
  readonly wheelContacts: number[];
  crashes = 0;
  private readonly gravity: number;

  constructor(
    world: World,
    readonly index: number,
    readonly name: string,
    readonly def: VehicleDef,
    x: number,
    terrain: Terrain,
    readonly skill: RivalSkill,
    eggFriction: number,
    gravity: number,
    rand: () => number,
  ) {
    this.car = new Car(world, def, x, terrain.height(x), eggFriction * skill.grip, gravity, { rival: index, air: airDensity(terrain.map), wet: terrain.map.wet ?? 0 });
    this.gravity = gravity;
    this.wheelContacts = this.car.wheelContacts;
    this.jitter = 0.92 + rand() * 0.16;
    this.wobble = rand() * 10;
  }

  get x(): number {
    return this.car.chassis.getPosition().x;
  }

  get crashed(): boolean {
    return this.recoverTimer > 0;
  }

  /** The egg touched the ground: the rival loses time, then carries on with a fresh egg. */
  crack(): void {
    if (this.eggBroken || this.finishTime !== null) return;
    this.eggBroken = true;
    this.crashes++;
    this.recoverTimer = this.skill.recover;
  }

  /** One physics step of driving. */
  drive(terrain: Terrain, time: number, step: number, racing: boolean, playerX = 0): void {
    const car = this.car;
    if (!racing || this.finishTime !== null) {
      // Before the start, and after the finish line: brakes on.
      car.drive(false, car.wheelSpeed > 0.5, true);
      return;
    }
    if (this.recoverTimer > 0) {
      car.cutEngine();
      this.recoverTimer -= step;
      if (this.recoverTimer <= 0) this.respawn(terrain);
      return;
    }

    car.unsink((x) => terrain.height(x));
    const pos = car.chassis.getPosition();
    const angle = car.chassis.getAngle();
    const speed = car.wheelSpeed;
    // Look ahead at the road: ease off for steep drops and for jumps.
    const h0 = terrain.height(pos.x + 2);
    const h1 = terrain.height(pos.x + 9);
    const slope = (h1 - h0) / 7;
    let target = car.topSpeed * this.skill.pace * this.jitter * (0.94 + 0.06 * Math.sin(time * 0.4 + this.wobble));
    if (slope < -0.2) target *= 1 - this.skill.caution * Math.min(0.5, (-slope - 0.2) * 1.5);
    const ramp = terrain.features.find((f) => f.kind === "ramp" && f.x > pos.x && f.x - pos.x < 25);
    if (ramp) target *= 1 - this.skill.caution * 0.3;
    // Behind you: push harder to catch up.
    if (playerX - pos.x > 15) target *= 1 + this.skill.catchUp;

    // Egg check: if it's bouncing up out of the bed or rattling around, back off.
    // (Resting against the back of the bed under acceleration is fine.)
    const egg = car.chassis.getLocalPoint(car.egg.getPosition());
    const rel = car.egg.getLinearVelocity().clone().sub(car.chassis.getLinearVelocity());
    const loose = egg.y > this.def.egg.y + 0.28 || rel.length() > 2.5;

    let gas = false;
    let brake = false;
    if (car.onGround) {
      gas = speed < target && !loose && angle < 0.85;
      brake = speed > target * 1.3 || (loose && speed > target * 0.8);
    } else {
      // In the air: keep the nose level (gas tips it up, brake tips it down).
      if (angle > 0.2) brake = true;
      else if (angle < -0.2) gas = true;
    }
    car.drive(gas, brake, true);

    // Slipstream: tucked in behind you, the air does some of the work.
    const gap = playerX - pos.x;
    if (car.onGround && gas && gap > 2 && gap < 30) {
      const mass = car.chassis.getMass() + car.wheels.reduce((m, w) => m + w.getMass(), 0);
      const push = this.skill.draft * (this.gravity / 10) * (1 - gap / 30);
      car.chassis.applyForceToCenter(new Vec2(Math.cos(angle) * mass * push, Math.sin(angle) * mass * push), true);
    }

    // Stuck or upside down for a while: put back on the road (like a marshal would).
    this.flipTimer = Math.abs(angle) > 1.7 ? this.flipTimer + step : 0;
    this.stuckTimer = Math.abs(speed) < 0.4 ? this.stuckTimer + step : 0;
    if (this.flipTimer > 1.2 || this.stuckTimer > 3) this.crack();
    // Fell through the world somehow
    if (car.egg.getPosition().y < terrain.height(car.egg.getPosition().x) - 6) this.crack();
  }

  private respawn(terrain: Terrain): void {
    const x = Math.max(2, this.x - 1);
    const car = this.car;
    car.chassis.setTransform(new Vec2(x, car.chassis.getPosition().y), 0);
    car.placeUpright(terrain.height(x));
    car.resetEgg();
    this.eggBroken = false;
    this.flipTimer = 0;
    this.stuckTimer = 0;
  }
}

/** Builds a field of `count` rivals in different vehicles (not the one you're driving). */
export function makeRivals(
  world: World,
  terrain: Terrain,
  count: number,
  skill: RivalSkill,
  playerVehicle: string,
  startX: number,
  eggFriction: number,
  gravity: number,
  seed: number,
): Rival[] {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
  // Better drivers get faster cars: pick from the quickest part of the garage.
  const top = (v: VehicleDef) => v.maxSpeed * v.wheels[1].r;
  const all = VEHICLES.filter((v) => v.id !== playerVehicle && !v.plane).sort((a, b) => top(b) - top(a));
  const pool = all.slice(0, Math.max(Math.min(count, MAX_RIVALS) + 1, Math.round(all.length * skill.carPick)));
  const names = [...NAMES];
  const rivals: Rival[] = [];
  for (let i = 0; i < Math.min(count, MAX_RIVALS); i++) {
    const def = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const name = names.splice(Math.floor(rand() * names.length), 1)[0];
    const paint = PAINTS[Math.floor(rand() * PAINTS.length)];
    const styled = applyMods(def, { ...NO_MODS, engine: skill.upgrades, tires: Math.min(4, skill.upgrades), suspension: Math.min(3, skill.upgrades), paint });
    rivals.push(new Rival(world, i, name, styled, startX + GRID_GAP * (i + 1), terrain, skill, eggFriction, gravity, rand));
  }
  return rivals;
}

/** "rival:2:egg" → { index: 2, part: "egg" }. */
export function rivalPart(userData: unknown): { index: number; part: string } | null {
  if (typeof userData !== "string" || !userData.startsWith("rival:")) return null;
  const [, i, part] = userData.split(":");
  return { index: Number(i), part };
}
