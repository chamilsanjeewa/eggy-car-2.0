import { Vec2 } from "planck";

export interface WheelDef {
  /** Local position relative to the chassis origin. */
  x: number;
  y: number;
  r: number;
}

export interface Part {
  pts: Vec2[];
  fill: string;
  /** Collides with the world/egg. Defaults to true; decorations set it false. */
  solid?: boolean;
  /** Draw an outline. Defaults to the value of `solid`. */
  outline?: boolean;
}

export interface VehicleDef {
  id: string;
  name: string;
  price: number;
  blurb: string;
  /** 1–5 ratings shown in the garage. */
  stats: { speed: number; power: number; stability: number };

  maxSpeed: number; // wheel rad/s
  torque: number;
  /** Braking deceleration in m/s². */
  brake: number;
  /** Fuel tank size, in seconds of full throttle. */
  fuel: number;
  airTorque: number;
  density: number;
  wheelFriction: number;
  suspension: { hz: number; damping: number };
  wheels: [WheelDef, WheelDef]; // rear, front

  /** Drawn in order; solid parts become chassis fixtures (must be convex, ≤ 8 points). */
  parts: Part[];
  /** Local position of the egg's center when spawned. */
  egg: { x: number; y: number };
  driver: { x: number; y: number; helmet?: string };
  headlight: { x: number; y: number };
  taillight: { x: number; y: number };
  /** Extra line work (roll cages, exhaust pipes), drawn as thick strokes. */
  lines?: { pts: Vec2[]; color: string; width: number }[];
  /** Decorative extra wheels (e.g. a rover's middle axle), in chassis space. */
  extraWheels?: WheelDef[];
  wheelColor: string;
  hubColor: string;
}

const P = (...xy: number[]): Vec2[] => {
  const pts: Vec2[] = [];
  for (let i = 0; i < xy.length; i += 2) pts.push(new Vec2(xy[i], xy[i + 1]));
  return pts;
};

/** Axis-aligned rectangle from (x0, y0) to (x1, y1). */
const R = (x0: number, y0: number, x1: number, y1: number) => P(x0, y0, x1, y0, x1, y1, x0, y1);

const EGG_BOTTOM = 0.42; // distance from egg center to its lowest point, plus a hair

export const VEHICLES: VehicleDef[] = [
  {
    id: "pickup",
    name: "Pickup",
    price: 0,
    blurb: "Trusty all-rounder. A good place to start.",
    stats: { speed: 3, power: 3, stability: 3 },
    maxSpeed: 50,
    torque: 40,
    brake: 7,
    fuel: 45,
    airTorque: 7,
    density: 1.6,
    wheelFriction: 1.4,
    suspension: { hz: 4.5, damping: 0.65 },
    wheels: [
      { x: -1.05, y: -0.4, r: 0.42 },
      { x: 1.08, y: -0.4, r: 0.42 },
    ],
    parts: [
      { pts: P(0.5, 0.15, 1.6, 0.15, 1.6, 0.55, 1.12, 1.08, 0.5, 1.08), fill: "#e2483d" },
      { pts: P(0.66, 0.6, 1.42, 0.6, 1.08, 0.95, 0.66, 0.95), fill: "#bfe8f7", solid: false, outline: true },
      { pts: R(-1.5, 0.15, -1.36, 0.52), fill: "#c23a30" },
      { pts: P(-1.5, -0.18, 1.55, -0.18, 1.6, 0.15, -1.5, 0.15), fill: "#c23a30" },
      { pts: R(-1.36, 0.08, 0.5, 0.15), fill: "#f1e3c6", solid: false },
    ],
    egg: { x: -0.45, y: 0.15 + EGG_BOTTOM },
    driver: { x: 0.86, y: 0.76 },
    headlight: { x: 1.5, y: 0.38 },
    taillight: { x: -1.46, y: 0.03 },
    wheelColor: "#222",
    hubColor: "#bbb",
  },
  {
    id: "tractor",
    name: "Hay Hauler",
    price: 50,
    blurb: "Slow and steady. Tall walls keep the egg tucked in.",
    stats: { speed: 1, power: 3, stability: 5 },
    maxSpeed: 22,
    torque: 18,
    brake: 7,
    fuel: 60,
    airTorque: 9,
    density: 1.6,
    wheelFriction: 1.6,
    suspension: { hz: 4, damping: 0.7 },
    wheels: [
      { x: -0.85, y: -0.5, r: 0.6 },
      { x: 1.12, y: -0.7, r: 0.4 },
    ],
    parts: [
      { pts: R(0.3, 0.15, 0.95, 1.35), fill: "#3f9b3a" },
      { pts: R(0.4, 0.72, 0.86, 1.25), fill: "#bfe8f7", solid: false, outline: true },
      { pts: P(0.95, 0.15, 1.6, 0.15, 1.6, 0.58, 0.95, 0.7), fill: "#3f9b3a" },
      { pts: R(0.2, 1.35, 1.05, 1.46), fill: "#2b6e27" },
      { pts: R(-1.45, 0.15, -1.3, 0.85), fill: "#2e7a2b" },
      { pts: P(-1.45, -0.2, 1.55, -0.2, 1.6, 0.15, -1.45, 0.15), fill: "#2e7a2b" },
      { pts: R(-1.3, 0.08, 0.3, 0.15), fill: "#e8cf7a", solid: false },
    ],
    egg: { x: -0.5, y: 0.15 + EGG_BOTTOM },
    driver: { x: 0.63, y: 0.92 },
    headlight: { x: 1.52, y: 0.42 },
    taillight: { x: -1.41, y: 0.0 },
    lines: [{ pts: P(1.3, 0.6, 1.3, 1.15), color: "#444", width: 0.09 }],
    wheelColor: "#262626",
    hubColor: "#f5c400",
  },
  {
    id: "buggy",
    name: "Dune Buggy",
    price: 150,
    blurb: "Light and bouncy. Big soft tires soak up the bumps.",
    stats: { speed: 4, power: 2, stability: 3 },
    maxSpeed: 48,
    torque: 18,
    brake: 7,
    fuel: 35,
    airTorque: 5,
    density: 1.0,
    wheelFriction: 1.7,
    suspension: { hz: 3, damping: 0.45 },
    wheels: [
      { x: -1.1, y: -0.55, r: 0.5 },
      { x: 1.2, y: -0.55, r: 0.5 },
    ],
    parts: [
      { pts: P(0.45, 0.12, 1.65, 0.12, 1.25, 0.45, 0.45, 0.55), fill: "#f08a24" },
      { pts: R(-1.45, 0.12, -1.32, 0.62), fill: "#d56f12" },
      { pts: P(-1.45, -0.12, 1.5, -0.12, 1.65, 0.12, -1.45, 0.12), fill: "#d56f12" },
      { pts: R(-1.32, 0.06, 0.45, 0.12), fill: "#3a3a3a", solid: false },
    ],
    egg: { x: -0.45, y: 0.12 + EGG_BOTTOM },
    driver: { x: 0.78, y: 0.78, helmet: "#2f7ae5" },
    headlight: { x: 1.5, y: 0.2 },
    taillight: { x: -1.41, y: 0.0 },
    lines: [{ pts: P(0.45, 0.55, 0.6, 1.15, 1.15, 1.15, 1.45, 0.3), color: "#333", width: 0.08 }],
    wheelColor: "#1d1d1d",
    hubColor: "#f08a24",
  },
  {
    id: "monster",
    name: "Mud Stomper",
    price: 350,
    blurb: "Huge tires and loads of torque. Rolls over anything.",
    stats: { speed: 3, power: 4, stability: 3 },
    maxSpeed: 34,
    torque: 40,
    brake: 6.5,
    fuel: 42,
    airTorque: 16,
    density: 1.6,
    wheelFriction: 1.6,
    suspension: { hz: 2.6, damping: 0.75 },
    wheels: [
      { x: -1.15, y: -0.95, r: 0.72 },
      { x: 1.2, y: -0.95, r: 0.72 },
    ],
    parts: [
      { pts: P(0.5, 0.15, 1.6, 0.15, 1.6, 0.55, 1.12, 1.08, 0.5, 1.08), fill: "#7b4bd1" },
      { pts: P(0.66, 0.6, 1.42, 0.6, 1.08, 0.95, 0.66, 0.95), fill: "#bfe8f7", solid: false, outline: true },
      { pts: R(-1.5, 0.15, -1.36, 0.68), fill: "#5f35ad" },
      { pts: P(-1.5, -0.25, 1.55, -0.25, 1.6, 0.15, -1.5, 0.15), fill: "#5f35ad" },
      { pts: R(-1.36, 0.08, 0.5, 0.15), fill: "#c9b8f0", solid: false },
      { pts: R(-1.6, -0.45, 1.65, -0.25), fill: "#3a3a3a", solid: false },
    ],
    egg: { x: -0.45, y: 0.15 + EGG_BOTTOM },
    driver: { x: 0.86, y: 0.76 },
    headlight: { x: 1.5, y: 0.38 },
    taillight: { x: -1.46, y: 0.0 },
    wheelColor: "#1a1a1a",
    hubColor: "#a0a0a0",
  },
  {
    id: "racer",
    name: "Speedster",
    price: 700,
    blurb: "Blistering top speed with a padded egg cradle.",
    stats: { speed: 5, power: 4, stability: 3 },
    maxSpeed: 80,
    torque: 40,
    brake: 7.5,
    fuel: 36,
    airTorque: 8,
    density: 1.4,
    wheelFriction: 1.7,
    suspension: { hz: 5.5, damping: 0.7 },
    wheels: [
      { x: -1.15, y: -0.32, r: 0.38 },
      { x: 1.25, y: -0.32, r: 0.38 },
    ],
    parts: [
      { pts: P(0.4, 0.18, 1.7, 0.18, 1.2, 0.6, 0.55, 0.75, 0.4, 0.75), fill: "#2f7ae5" },
      { pts: P(0.62, 0.42, 1.12, 0.42, 0.98, 0.6, 0.62, 0.66), fill: "#bfe8f7", solid: false, outline: true },
      { pts: R(-1.6, 0.18, -1.45, 0.7), fill: "#1f5fbf" },
      { pts: R(-1.82, 0.78, -1.3, 0.88), fill: "#1f5fbf", solid: false, outline: true },
      { pts: R(-1.0, 0.18, -0.9, 0.3), fill: "#f1e3c6" },
      { pts: P(-1.6, -0.12, 1.6, -0.12, 1.85, 0.05, 1.7, 0.18, -1.6, 0.18), fill: "#1f5fbf" },
      { pts: R(-1.6, 0.0, 1.75, 0.06), fill: "#ffffff", solid: false },
    ],
    egg: { x: -0.3, y: 0.18 + EGG_BOTTOM },
    driver: { x: 0.8, y: 0.62, helmet: "#e2483d" },
    headlight: { x: 1.72, y: 0.1 },
    taillight: { x: -1.56, y: 0.08 },
    lines: [{ pts: P(-1.53, 0.7, -1.53, 0.8), color: "#1f5fbf", width: 0.06 }],
    wheelColor: "#1d1d1d",
    hubColor: "#d8d8d8",
  },
  {
    id: "van",
    name: "Mail Van",
    price: 180,
    blurb: "Tall cargo walls cradle the egg. Heavy and a bit top-heavy.",
    stats: { speed: 2, power: 3, stability: 5 },
    maxSpeed: 40,
    torque: 45,
    brake: 6.5,
    fuel: 70,
    airTorque: 10,
    density: 2.0,
    wheelFriction: 1.4,
    suspension: { hz: 4, damping: 0.7 },
    wheels: [
      { x: -1.05, y: -0.42, r: 0.4 },
      { x: 1.1, y: -0.42, r: 0.4 },
    ],
    parts: [
      { pts: P(0.55, 0.15, 1.6, 0.15, 1.6, 0.6, 1.3, 1.35, 0.55, 1.35), fill: "#e9e4d6" },
      { pts: P(0.7, 0.75, 1.32, 0.75, 1.15, 1.2, 0.7, 1.2), fill: "#bfe8f7", solid: false, outline: true },
      { pts: R(-1.55, 0.15, -1.4, 1.0), fill: "#d8d2c2" },
      { pts: P(-1.55, -0.2, 1.5, -0.2, 1.6, 0.15, -1.55, 0.15), fill: "#d8d2c2" },
      { pts: R(-1.55, -0.05, 1.58, 0.03), fill: "#2f7ae5", solid: false },
      { pts: R(0.62, 0.3, 1.5, 0.4), fill: "#e2483d", solid: false },
      { pts: R(-1.4, 0.08, 0.55, 0.15), fill: "#b9b2a0", solid: false },
    ],
    egg: { x: -0.45, y: 0.15 + EGG_BOTTOM },
    driver: { x: 0.9, y: 0.92 },
    headlight: { x: 1.52, y: 0.45 },
    taillight: { x: -1.51, y: 0.4 },
    wheelColor: "#222",
    hubColor: "#c9c9c9",
  },
  {
    id: "rally",
    name: "Rally Hatch",
    price: 250,
    blurb: "Nimble rally car with sticky tires and sharp brakes.",
    stats: { speed: 4, power: 3, stability: 3 },
    maxSpeed: 62,
    torque: 22,
    brake: 8.5,
    fuel: 38,
    airTorque: 7,
    density: 1.4,
    wheelFriction: 1.8,
    suspension: { hz: 4.5, damping: 0.62 },
    wheels: [
      { x: -1.0, y: -0.38, r: 0.4 },
      { x: 1.1, y: -0.38, r: 0.4 },
    ],
    parts: [
      { pts: P(0.35, 0.2, 1.6, 0.2, 1.25, 0.62, 0.55, 0.82, 0.35, 0.82), fill: "#f5c400" },
      { pts: P(0.5, 0.45, 1.2, 0.45, 1.0, 0.7, 0.5, 0.75), fill: "#bfe8f7", solid: false, outline: true },
      { pts: R(-1.45, 0.2, -1.32, 0.72), fill: "#d9a400" },
      { pts: P(-1.45, -0.15, 1.5, -0.15, 1.72, 0.05, 1.6, 0.2, -1.45, 0.2), fill: "#d9a400" },
      { pts: R(-1.45, 0.02, 1.65, 0.08), fill: "#1f1f1f", solid: false },
      { pts: R(-1.32, 0.14, 0.35, 0.2), fill: "#3a3a3a", solid: false },
    ],
    egg: { x: -0.45, y: 0.2 + EGG_BOTTOM },
    driver: { x: 0.78, y: 0.6, helmet: "#e2483d" },
    headlight: { x: 1.62, y: 0.12 },
    taillight: { x: -1.41, y: 0.1 },
    wheelColor: "#1d1d1d",
    hubColor: "#f5f5f5",
  },
  {
    id: "jeep",
    name: "Safari Jeep",
    price: 300,
    blurb: "Off-road legend. Soft springs, chunky tires, lots of grunt.",
    stats: { speed: 3, power: 4, stability: 4 },
    maxSpeed: 44,
    torque: 26,
    brake: 7,
    fuel: 50,
    airTorque: 9,
    density: 1.6,
    wheelFriction: 1.9,
    suspension: { hz: 3.2, damping: 0.68 },
    wheels: [
      { x: -1.05, y: -0.55, r: 0.5 },
      { x: 1.1, y: -0.55, r: 0.5 },
    ],
    parts: [
      { pts: P(0.45, 0.2, 1.65, 0.2, 1.65, 0.55, 0.45, 0.62), fill: "#6f7d3a" },
      { pts: R(-1.5, 0.2, -1.36, 0.76), fill: "#5a6630" },
      { pts: P(-1.5, -0.2, 1.55, -0.2, 1.65, 0.2, -1.5, 0.2), fill: "#5a6630" },
      { pts: R(-1.36, 0.14, 0.45, 0.2), fill: "#3d4421", solid: false },
      { pts: R(1.45, 0.25, 1.62, 0.5), fill: "#2a2a2a", solid: false },
    ],
    egg: { x: -0.45, y: 0.2 + EGG_BOTTOM },
    driver: { x: 0.78, y: 0.86, helmet: "#c8a26a" },
    headlight: { x: 1.56, y: 0.42 },
    taillight: { x: -1.46, y: 0.08 },
    lines: [
      { pts: P(0.52, 0.62, 0.66, 1.08), color: "#333", width: 0.07 },
      { pts: P(0.2, 0.62, 0.24, 1.2, 0.6, 1.2), color: "#2a2a2a", width: 0.08 },
    ],
    wheelColor: "#1b1b1b",
    hubColor: "#9a9a7a",
  },
  {
    id: "rover",
    name: "Lunar Rover",
    price: 600,
    blurb: "Feather-light with six wheels. Floats over bumps, grips like glue.",
    stats: { speed: 3, power: 3, stability: 4 },
    maxSpeed: 46,
    torque: 18,
    brake: 7.5,
    fuel: 60,
    airTorque: 6,
    density: 1.0,
    wheelFriction: 2.0,
    suspension: { hz: 3, damping: 0.72 },
    wheels: [
      { x: -1.2, y: -0.45, r: 0.42 },
      { x: 1.2, y: -0.45, r: 0.42 },
    ],
    extraWheels: [{ x: 0, y: -0.45, r: 0.42 }],
    parts: [
      { pts: P(0.6, 0.15, 1.7, 0.15, 1.5, 0.5, 0.6, 0.5), fill: "#c9ccd3" },
      { pts: R(-1.6, 0.15, -1.46, 0.88), fill: "#c9ccd3" },
      { pts: P(-1.6, -0.1, 1.6, -0.1, 1.7, 0.15, -1.6, 0.15), fill: "#9ea3ad" },
      { pts: R(-1.6, -0.02, 1.62, 0.06), fill: "#e0a526", solid: false },
      { pts: R(-1.46, 0.09, 0.6, 0.15), fill: "#6c707a", solid: false },
    ],
    egg: { x: -0.45, y: 0.15 + EGG_BOTTOM },
    driver: { x: 0.95, y: 0.72, helmet: "#f2f2f2" },
    headlight: { x: 1.55, y: 0.3 },
    taillight: { x: -1.56, y: 0.05 },
    lines: [
      { pts: P(1.25, 0.5, 1.25, 1.3), color: "#8a8f99", width: 0.05 },
      { pts: P(1.02, 1.36, 1.48, 1.24), color: "#d8dbe2", width: 0.08 },
    ],
    wheelColor: "#3a3d44",
    hubColor: "#d8dbe2",
  },
];

export function vehicleById(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}
