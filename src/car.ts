import { World, Vec2, Circle, Polygon, WheelJoint, Body } from "planck";
import { VehicleDef } from "./vehicles";

export const EGG_RX = 0.34;
export const EGG_RY_TOP = 0.5;
export const EGG_RY_BOTTOM = 0.4;

const IDLE_TORQUE = 1.2;
const THROTTLE_RAMP = 0.5; // seconds from idle to full torque
const STEP = 1 / 60;
const BRAKE_RAMP = 0.25; // seconds to full brake force
/** Shared negative group: the egg and wheels never collide (a squatting wheel could otherwise poke up through the bed). */
const NO_EGG_WHEEL = -1;

/**
 * Collision categories. Rival race cars pass through you and each other: every rival has its own
 * category and only touches the ground and itself. Canyon bridges have their own category so
 * rivals (who always take the valley road) never land on them.
 */
export const CAT_GROUND = 0x0001;
export const CAT_PLAYER = 0x0002;
export const CAT_BRIDGE = 0x8000;
const RIVAL_BASE = 0x0004;
export const MAX_RIVALS = 5;
const ALL_RIVALS = ((1 << MAX_RIVALS) - 1) * RIVAL_BASE;

export interface CarOptions {
  /** Rival index (0..MAX_RIVALS-1); omitted for the player's car. */
  rival?: number;
  /** Air (or water) density relative to Earth's air: 0 on the Moon, more underwater. */
  air?: number;
  /** Rain on the road (0 = dry, 1 = downpour): tires can't brake or pull as hard. */
  wet?: number;
}

/** Suspension travel (as a fraction of wheel diameter): droop below rest, bump travel above. */
const SUSPENSION_DROOP = 0.24;
const SUSPENSION_BUMP = 0.27;
/** How quickly a wheel past its travel limit is eased back inside it (fraction per step). */
const STOP_CORRECTION = 0.2;

/** Reverse gear: top speed and pulling power as fractions of forward. */
const REVERSE_SPEED = 0.3;
const REVERSE_TORQUE = 0.45;

/** Air drag: deceleration (m/s²) per (m/s)², about 1 m/s² at 90 km/h. */
const DRAG = 0.0016;
/** Rolling resistance as a fraction of gravity. */
const ROLLING = 0.012;

export function eggOutline(n = 16): Vec2[] {
  const pts: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const s = Math.sin(a);
    pts.push(new Vec2(EGG_RX * Math.cos(a), (s > 0 ? EGG_RY_TOP : EGG_RY_BOTTOM) * s));
  }
  return pts;
}

/** Chassis height above the ground so the wheels rest on it at spawn. */
export function rideHeight(def: VehicleDef): number {
  return -Math.min(...def.wheels.map((w) => w.y - w.r)) + 0.05;
}

export class Car {
  readonly chassis: Body;
  readonly wheels: Body[];
  readonly egg: Body;
  private joints: WheelJoint[];
  /** Number of ground contacts per wheel, maintained by the game's contact listener. */
  readonly wheelContacts = [0, 0];
  private throttle = 0;
  private brakeRamp = 0;
  /** True while the brakes are clamped on a moving car (for skid sounds). */
  braking = false;
  /** Engine load 0..1 this step (for fuel use and engine sound). */
  load = 0;
  /** Rocket thrust this step, 0..1 (for flames and sound). */
  rocketOn = 0;
  /** Plane landing autopilot engaged (reverse held in the air). */
  landing = false;
  /**
   * Under low gravity everything is scaled like Earth in slow motion: forces scale with g and
   * speeds/spring rates with sqrt(g). Otherwise bumps launch the egg straight out of the bed.
   */
  private gravityScale: number;
  private speedScale: number;
  private readonly air: number;
  /** Tire grip left in the wet (1 = dry): scales the hardest braking and pulling the tires can take. */
  private readonly grip: number;

  /** Spawns the car with its wheels resting on ground height `groundY`. */
  constructor(world: World, readonly def: VehicleDef, x: number, groundY: number, eggFriction = 0.55, gravity = 10, opts: CarOptions = {}) {
    const rival = opts.rival;
    const cat = rival === undefined ? CAT_PLAYER : RIVAL_BASE << rival;
    const filter = {
      filterCategoryBits: cat,
      filterMaskBits: rival === undefined ? 0xffff & ~ALL_RIVALS : CAT_GROUND | cat,
    };
    // Rivals tag their fixtures so the game's contact listener tells them apart from yours.
    const tag = (name: string) => (rival === undefined ? name : `rival:${rival}:${name}`);
    this.air = opts.air ?? 1;
    this.grip = 1 - 0.38 * (opts.wet ?? 0);
    this.gravityScale = gravity / 10;
    this.speedScale = Math.sqrt(this.gravityScale);
    const y = groundY + rideHeight(def);
    this.chassis = world.createBody({ type: "dynamic", position: new Vec2(x, y) });
    for (const part of def.parts) {
      if (part.solid === false) continue;
      this.chassis.createFixture({ shape: new Polygon(part.pts), density: def.density, friction: 0.7, userData: tag("car"), ...filter });
    }

    this.wheels = [];
    this.joints = [];
    def.wheels.forEach((w, idx) => {
      const pos = new Vec2(x + w.x, y + w.y);
      const wheel = world.createBody({ type: "dynamic", position: pos, angularDamping: 0.1 });
      wheel.createFixture({
        shape: new Circle(w.r),
        density: 1.2,
        friction: def.wheelFriction,
        restitution: 0.05,
        filterGroupIndex: NO_EGG_WHEEL,
        ...filter,
        userData: tag(idx === 0 ? "wheel0" : "wheel1"),
      });
      const joint = world.createJoint(
        new WheelJoint(
          {
            enableMotor: true,
            motorSpeed: 0,
            maxMotorTorque: IDLE_TORQUE,
            frequencyHz: def.suspension.hz * this.speedScale,
            dampingRatio: def.suspension.damping,
          },
          this.chassis,
          wheel,
          pos,
          new Vec2(0, 1),
        ),
      ) as WheelJoint;
      this.wheels.push(wheel);
      this.joints.push(joint);
    });

    this.egg = world.createBody({
      type: "dynamic",
      position: new Vec2(x + def.egg.x, y + def.egg.y),
      angularDamping: 0.05,
      // Continuous collision checks, so a fast egg can't skip through the bed's thin walls
      bullet: true,
    });
    // Two overlapping circles approximate the egg: a fat bottom and a narrower top.
    const eggFix = { density: 0.55, friction: eggFriction, restitution: 0.15, filterGroupIndex: NO_EGG_WHEEL, ...filter, userData: tag("egg") };
    this.egg.createFixture({ shape: new Circle(new Vec2(0, -0.06), EGG_RX), ...eggFix });
    this.egg.createFixture({ shape: new Circle(new Vec2(0, EGG_RY_TOP - 0.24), 0.24), ...eggFix });
  }

  /** Whether world point `p` lies within `pad` meters of the vehicle's outline (chassis + wheels). */
  touches(p: Vec2, pad: number): boolean {
    const local = this.chassis.getLocalPoint(p);
    for (const part of this.def.parts) {
      const xs = part.pts.map((q) => q.x);
      const ys = part.pts.map((q) => q.y);
      if (
        local.x >= Math.min(...xs) - pad &&
        local.x <= Math.max(...xs) + pad &&
        local.y >= Math.min(...ys) - pad &&
        local.y <= Math.max(...ys) + pad
      )
        return true;
    }
    return this.wheels.some((w, i) => Vec2.distance(w.getPosition(), p) <= this.def.wheels[i].r + pad);
  }

  /** Changes the gravity the car's power, grip and speed are scaled for (terrains where it varies). */
  setGravity(g: number): void {
    this.gravityScale = g / 10;
    this.speedScale = Math.sqrt(this.gravityScale);
  }

  /** Top road speed in m/s (motor limit × wheel radius). */
  get topSpeed(): number {
    return this.def.maxSpeed * this.speedScale * this.def.wheels[1].r;
  }

  /** Total mass of chassis and wheels. */
  private get mass(): number {
    return this.chassis.getMass() + this.wheels.reduce((m, w) => m + w.getMass(), 0);
  }

  get onGround(): boolean {
    return this.wheelContacts[0] > 0 || this.wheelContacts[1] > 0;
  }

  /** Front wheel ground speed in m/s (positive = moving forward). */
  get wheelSpeed(): number {
    return -this.wheels[1].getAngularVelocity() * this.def.wheels[1].r;
  }

  /**
   * Gas accelerates; brake clamps the wheels hard while rolling forward, then reverses once stopped.
   * Without fuel the engine is dead but the brakes still work.
   */
  drive(gas: boolean, brake: boolean, hasFuel = true): void {
    const maxSpeed = this.def.maxSpeed * this.speedScale;
    // Wet tires spin up sooner, so less of the engine's pull reaches the road.
    const driveTorque = this.def.torque * this.gravityScale * (0.55 + 0.45 * this.grip);
    const airTorque = this.def.airTorque * this.gravityScale;
    if (!hasFuel) gas = false;
    const pressing = gas !== brake;
    const rollingForward = this.wheelSpeed > 0.8 * this.speedScale;
    this.braking = brake && !gas && rollingForward;
    // Torque builds up gradually so a stomp on the pedal doesn't fling the egg.
    this.throttle = pressing && !this.braking ? Math.min(1, this.throttle + STEP / THROTTLE_RAMP) : 0;
    let speed = 0;
    let torque = IDLE_TORQUE;
    // Brakes bite within a fraction of a second (an instant lock would pitch the egg out).
    this.brakeRamp = this.braking ? Math.min(1, this.brakeRamp + STEP / BRAKE_RAMP) : 0;
    if (pressing && hasFuel && !this.braking) {
      // Brake while stopped = reverse, in a gentle low gear like a real car (full power backwards
      // would rear the car up onto its tail).
      speed = gas ? -maxSpeed : maxSpeed * REVERSE_SPEED;
      torque = Math.max(IDLE_TORQUE, driveTorque * this.throttle * (gas ? 1 : REVERSE_TORQUE));
    }
    this.load = !this.braking && pressing && hasFuel ? this.throttle : 0;
    // Braking targets a deceleration (m/s²): each wheel gets the torque to stop its share of the mass.
    const decel = this.def.brake * this.gravityScale * this.brakeRamp * this.grip;
    this.joints.forEach((j, i) => {
      j.setMotorSpeed(speed);
      j.setMaxMotorTorque(this.braking ? Math.max(IDLE_TORQUE, (this.mass * decel * this.def.wheels[i].r) / 2) : torque);
    });
    this.suspensionStops();
    // Air drag grows with the square of speed; tires add a little rolling resistance on the ground.
    const vel = this.chassis.getLinearVelocity();
    const airSpeed = vel.length();
    if (airSpeed > 0.3) {
      const decel = DRAG * this.air * (this.def.dragScale ?? 1) * airSpeed * airSpeed + (this.onGround ? ROLLING * 10 * this.gravityScale : 0);
      const f = (this.mass * decel) / airSpeed;
      this.chassis.applyForceToCenter(new Vec2(-vel.x * f, -vel.y * f), true);
    }
    // Rocket engines: real thrust along the car, fading out as it nears top speed
    const rk = this.def.rocket;
    this.rocketOn = 0;
    if (rk && gas && !brake && hasFuel && !(rk.airOnly && this.onGround)) {
      const v = Math.max(0, Vec2.dot(this.chassis.getLinearVelocity(), this.chassis.getWorldVector(new Vec2(1, 0))));
      const top = rk.top * this.speedScale;
      const k = Math.min(1, Math.max(0, (top - v) / (6 * this.speedScale))) * Math.min(1, this.throttle * 1.5);
      this.rocketOn = k;
      if (k > 0) {
        const f = this.mass * rk.thrust * this.gravityScale * k;
        const dir = this.chassis.getWorldVector(new Vec2(1, 0));
        // Pushes through the car's center of mass, so it doesn't flip the car over
        this.chassis.applyForceToCenter(Vec2.mul(dir, f), true);
      }
    }
    // Plane: propeller thrust, wing lift from forward speed, and flight controls in the air
    const pl = this.def.plane;
    if (pl) {
      const fwd = this.chassis.getWorldVector(new Vec2(1, 0));
      const up = this.chassis.getWorldVector(new Vec2(0, 1));
      const vel = this.chassis.getLinearVelocity();
      const vf = Math.max(0, Vec2.dot(vel, fwd));
      const g = 10 * this.gravityScale;
      if (gas && !brake && hasFuel) {
        const k = Math.min(1, Math.max(0, (pl.top * this.speedScale - vf) / (8 * this.speedScale))) * Math.min(1, this.throttle * 1.5);
        this.chassis.applyForceToCenter(Vec2.mul(fwd, this.mass * pl.thrust * this.gravityScale * k), true);
        this.load = Math.max(this.load, k);
      }
      // Lift grows with speed squared (scaled so low gravity flies the same), up to a limit;
      // thin air above ~150 m fades it out, so the plane cruises instead of climbing forever
      const height = this.onGround ? 0 : this.altitude(260);
      const thin = Math.min(1, Math.max(0, (230 - height) / 80));
      const lift = Math.min(pl.maxLift, (pl.lift * vf * vf) / this.gravityScale) * (0.75 + 0.25 * thin) * (thin > 0 || vel.y < 0 ? 1 : 0.7);
      this.chassis.applyForceToCenter(Vec2.mul(up, this.mass * g * lift), true);
      const landing = brake && !gas && !this.onGround;
      this.landing = landing;
      if (landing) {
        // Landing autopilot: air brakes slow it to approach speed, it sinks at a steady rate and
        // flares just above the ground so the wheels touch down softly
        const alt = height;
        const approach = 20 * this.speedScale;
        const vx = Vec2.dot(vel, fwd);
        if (vx > approach) {
          const slow = Math.min(6, (vx - approach) * 0.6) * this.gravityScale;
          this.chassis.applyForceToCenter(Vec2.mul(fwd, -this.mass * slow), true);
        }
        const sink = (alt < 3 ? -0.8 : alt < 10 ? -2.5 : alt < 40 ? -6 : -20) * Math.sqrt(this.gravityScale);
        const dvy = sink - vel.y;
        // Wings + flaps hold the sink rate (counters gravity, so the lift above isn't doubled)
        const fy = this.mass * (g * (1 - lift * up.y) + dvy * 3);
        // Spoilers can pull it down out of a climb, but never below 0.4 g of support: any harder
        // and the plane would drop out from under the egg
        this.chassis.applyForceToCenter(new Vec2(0, Math.max(this.mass * g * (0.4 - lift * up.y), fy)), true);
      }
      if (!this.onGround && vel.length() > 3) {
        // Pitch control: gas climbs, letting go glides gently down, reverse lands (nose level, slight flare)
        const target = gas && !brake ? 0.32 : landing ? 0.06 : -0.08;
        const a = Math.atan2(Math.sin(this.chassis.getAngle()), Math.cos(this.chassis.getAngle()));
        const I = this.chassis.getInertia();
        this.chassis.applyTorque(I * 6 * this.gravityScale * ((target - a) * 1.2 - this.chassis.getAngularVelocity() * 0.6), true);
      }
    }
    // Downforce: wings press the car onto the road, harder the faster it goes
    if (this.def.downforce && this.onGround) {
      const v2 = this.chassis.getLinearVelocity().lengthSquared();
      const down = this.chassis.getWorldVector(new Vec2(0, -1));
      this.chassis.applyForceToCenter(Vec2.mul(down, this.mass * 10 * this.gravityScale * Math.min(0.9, this.def.downforce * v2)), true);
    }
    // Lean the car while airborne: gas tips the nose up, brake tips it down.
    if (!this.onGround) {
      if (gas && !brake && !rk && !pl) this.chassis.applyTorque(airTorque, true);
      else if (brake && !gas && !pl) this.chassis.applyTorque(-airTorque, true);
      // Gyro stabilizer: steers the nose back to level and damps any spin
      if (this.def.gyro) {
        const a = Math.atan2(Math.sin(this.chassis.getAngle()), Math.cos(this.chassis.getAngle()));
        const I = this.chassis.getInertia();
        this.chassis.applyTorque(I * this.def.gyro * this.gravityScale * (-a * 1.0 - this.chassis.getAngularVelocity() * 0.5), true);
      }
    }
  }

  /** Height of the chassis above the ground below it (capped at `max`). */
  private altitude(max: number): number {
    const from = this.chassis.getPosition();
    const to = new Vec2(from.x, from.y - max);
    let best = max;
    this.chassis.getWorld().rayCast(from, to, (f, _p, _n, frac) => {
      if (f.getUserData() !== "ground") return -1;
      best = Math.min(best, frac * max);
      return frac;
    });
    return best;
  }

  /**
   * Safety net against physics glitches: if the egg has ended up inside the car's body or under
   * the bed floor (which it can't reach legitimately), put it back in its seat, moving with the car.
   * Returns true if it had to.
   */
  keepEggInside(): boolean {
    const ep = this.egg.getPosition();
    let inside = false;
    for (let f = this.chassis.getFixtureList(); f; f = f.getNext()) {
      if (f.testPoint(ep)) {
        inside = true;
        break;
      }
    }
    const local = this.chassis.getLocalPoint(ep);
    const floor = this.def.egg.y - 0.42;
    const under = Math.abs(local.x - this.def.egg.x) < 0.7 && local.y < floor - 0.15 && local.y > floor - 0.9;
    if (!inside && !under) return false;
    const seat = this.chassis.getWorldPoint(new Vec2(this.def.egg.x, this.def.egg.y + 0.05));
    this.egg.setTransform(seat, this.chassis.getAngle());
    this.egg.setLinearVelocity(this.chassis.getLinearVelocityFromWorldPoint(seat));
    this.egg.setAngularVelocity(0);
    this.egg.setAwake(true);
    return true;
  }

  /** Puts the egg back in the bed at rest relative to the car. */
  resetEgg(): void {
    const pos = this.chassis.getWorldPoint(new Vec2(this.def.egg.x, this.def.egg.y + 0.05));
    this.egg.setTransform(pos, this.chassis.getAngle());
    this.egg.setLinearVelocity(this.chassis.getLinearVelocity());
    this.egg.setAngularVelocity(0);
    this.egg.setAwake(true);
  }

  /** Sets the car upright, resting on `groundY` at its current x, and stops it. */
  placeUpright(groundY: number): void {
    const x = this.chassis.getPosition().x;
    const y = groundY + rideHeight(this.def) + 0.3;
    this.chassis.setTransform(new Vec2(x, y), 0);
    this.chassis.setLinearVelocity(new Vec2(0, 0));
    this.chassis.setAngularVelocity(0);
    this.wheels.forEach((w, i) => {
      w.setTransform(new Vec2(x + this.def.wheels[i].x, y + this.def.wheels[i].y), 0);
      w.setLinearVelocity(new Vec2(0, 0));
      w.setAngularVelocity(0);
    });
  }

  /**
   * Real suspension travel: once a wheel moves past the end of its travel, a stiff rubber bump stop
   * (or the droop limit) pushes back, instead of the spring stretching or compressing forever.
   */
  private suspensionStops(): void {
    const axis = this.chassis.getWorldVector(new Vec2(0, 1));
    const chassisMass = this.chassis.getMass();
    this.joints.forEach((j, i) => {
      const r = this.def.wheels[i].r;
      const t = j.getJointTranslation();
      const up = SUSPENSION_BUMP * r * 2;
      const down = -SUSPENSION_DROOP * r * 2;
      if (t <= up && t >= down) return;
      const wheel = this.wheels[i];
      const anchor = wheel.getPosition();
      // Wheel speed along the axis relative to the chassis (positive = moving up into the body)
      const rel = Vec2.dot(Vec2.sub(wheel.getLinearVelocity(), this.chassis.getLinearVelocityFromWorldPoint(anchor)), axis);
      const past = t > up ? t - up : t - down; // + beyond the bump stop, − beyond full droop
      // Only resist motion that goes further past the limit, plus a gentle push back inside it.
      const target = -STOP_CORRECTION * past * 60;
      const dv = t > up ? Math.max(0, rel - target) : Math.min(0, rel - target);
      if (dv === 0) return;
      const reduced = 1 / (1 / wheel.getMass() + 1 / chassisMass);
      const impulse = reduced * dv;
      wheel.applyLinearImpulse(Vec2.mul(axis, -impulse), anchor, true);
      this.chassis.applyLinearImpulse(Vec2.mul(axis, impulse), anchor, true);
    });
  }

  /** Moves the car and its egg up by `dy` meters together, dropping any downward speed. */
  private lift(dy: number): void {
    for (const b of [this.chassis, ...this.wheels, this.egg]) {
      const p = b.getPosition();
      b.setTransform(new Vec2(p.x, p.y + dy), b.getAngle());
      const v = b.getLinearVelocity();
      if (v.y < 0) b.setLinearVelocity(new Vec2(v.x, 0));
      b.setAwake(true);
    }
  }

  /**
   * If a hard landing punched a wheel or the body through the ground, pops the car back on top.
   * Returns true when it had to.
   */
  unsink(height: (x: number) => number): boolean {
    let need = 0;
    this.wheels.forEach((w, i) => {
      const p = w.getPosition();
      const r = this.def.wheels[i].r;
      // A wheel resting on the road has its bottom at ground level; more than half sunk means it went through.
      const depth = height(p.x) - (p.y - r);
      if (depth > r * 0.6) need = Math.max(need, depth + 0.05);
    });
    const c = this.chassis.getPosition();
    const below = height(c.x) - c.y;
    if (below > -0.05) need = Math.max(need, below + rideHeight(this.def) * 0.6);
    if (need <= 0) return false;
    this.lift(need);
    return true;
  }

  /** Wedged or stuck: sets the car upright on the road a little further on, egg still in the bed. */
  unstick(height: (x: number) => number): void {
    const eggLocal = this.chassis.getLocalPoint(this.egg.getPosition());
    const eggAngle = this.egg.getAngle() - this.chassis.getAngle();
    const x = this.chassis.getPosition().x + 0.6;
    this.chassis.setTransform(new Vec2(x, this.chassis.getPosition().y), this.chassis.getAngle());
    this.placeUpright(height(x));
    // Keep the egg where it was in the bed (clamped so it can't end up inside the cab).
    const local = new Vec2(Math.max(eggLocal.x, this.def.egg.x - 0.6), Math.max(eggLocal.y, this.def.egg.y));
    this.egg.setTransform(this.chassis.getWorldPoint(local), eggAngle);
    this.egg.setLinearVelocity(new Vec2(0, 0));
    this.egg.setAngularVelocity(0);
    this.egg.setAwake(true);
  }

  /** How far over the car has tipped: 0 = level, 1 = on its side, 2 = upside down. */
  get tipped(): number {
    const a = Math.atan2(Math.sin(this.chassis.getAngle()), Math.cos(this.chassis.getAngle()));
    return Math.abs(a) / (Math.PI / 2);
  }

  /** Flips the car back onto its wheels where it is, with the egg back in the bed. */
  flipUpright(height: (x: number) => number): void {
    const x = this.chassis.getPosition().x;
    this.placeUpright(height(x));
    this.resetEgg();
    this.egg.setLinearVelocity(new Vec2(0, 0));
  }

  cutEngine(): void {
    this.braking = false;
    this.load = 0;
    for (const j of this.joints) {
      j.setMotorSpeed(0);
      j.setMaxMotorTorque(IDLE_TORQUE * 3);
    }
  }
}
