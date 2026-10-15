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
  /**
   * Under low gravity everything is scaled like Earth in slow motion: forces scale with g and
   * speeds/spring rates with sqrt(g). Otherwise bumps launch the egg straight out of the bed.
   */
  private readonly gravityScale: number;
  private readonly speedScale: number;

  /** Spawns the car with its wheels resting on ground height `groundY`. */
  constructor(world: World, readonly def: VehicleDef, x: number, groundY: number, eggFriction = 0.55, gravity = 10) {
    this.gravityScale = gravity / 10;
    this.speedScale = Math.sqrt(this.gravityScale);
    const y = groundY + rideHeight(def);
    this.chassis = world.createBody({ type: "dynamic", position: new Vec2(x, y) });
    for (const part of def.parts) {
      if (part.solid === false) continue;
      this.chassis.createFixture({ shape: new Polygon(part.pts), density: def.density, friction: 0.7, userData: "car" });
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
        userData: idx === 0 ? "wheel0" : "wheel1",
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
    });
    // Two overlapping circles approximate the egg: a fat bottom and a narrower top.
    const eggFix = { density: 0.55, friction: eggFriction, restitution: 0.15, filterGroupIndex: NO_EGG_WHEEL, userData: "egg" };
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
    const driveTorque = this.def.torque * this.gravityScale;
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
      speed = gas ? -maxSpeed : maxSpeed * 0.55; // brake while stopped = reverse
      torque = Math.max(IDLE_TORQUE, driveTorque * this.throttle);
    }
    this.load = !this.braking && pressing && hasFuel ? this.throttle : 0;
    // Braking targets a deceleration (m/s²): each wheel gets the torque to stop its share of the mass.
    const decel = this.def.brake * this.gravityScale * this.brakeRamp;
    this.joints.forEach((j, i) => {
      j.setMotorSpeed(speed);
      j.setMaxMotorTorque(this.braking ? Math.max(IDLE_TORQUE, (this.mass * decel * this.def.wheels[i].r) / 2) : torque);
    });
    // Lean the car while airborne: gas tips the nose up, brake tips it down.
    if (!this.onGround) {
      if (gas && !brake) this.chassis.applyTorque(airTorque, true);
      else if (brake && !gas) this.chassis.applyTorque(-airTorque, true);
    }
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

  cutEngine(): void {
    this.braking = false;
    this.load = 0;
    for (const j of this.joints) {
      j.setMotorSpeed(0);
      j.setMaxMotorTorque(IDLE_TORQUE * 3);
    }
  }
}
