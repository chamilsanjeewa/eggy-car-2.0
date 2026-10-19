import { Car } from "./car";
import { Terrain } from "./terrain";
import { InteriorStyle, DEFAULT_STYLE } from "./interior";

/** Screen-space layout of the cockpit, as fractions of the screen size. */
export const COCKPIT = {
  /** Where the driver's eye sits on screen (only used while switching cameras). */
  eyeX: 0.5,
  eyeY: 0.42,
  /** Windshield opening. */
  winLeft: 0.02,
  winTop: 0.09,
  winRight: 0.98,
  winBottom: 0.7,
  /** Top edge of the dashboard. */
  dashTop: 0.68,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Motion of things inside the cabin, driven by the car's acceleration:
 * head bob from the suspension, swinging dice, wheel jolts and engine vibration.
 */
export class CockpitState {
  /** Head offset along the car's "up", in meters (negative = pushed down). */
  bob = 0;
  private bobV = 0;
  /** Dice swing angle relative to the car's "down", radians. */
  dice = 0;
  private diceV = 0;
  /** Steering wheel jolt, radians. */
  wheel = 0;
  /** Engine shake in screen pixels. */
  shakeX = 0;
  shakeY = 0;
  speedKmh = 0;
  /**
   * The driver's view pitch: follows the car but softened and smoothed, the way a real
   * driver's head steadies itself, so the horizon doesn't jerk on every bump.
   */
  viewPitch = 0;
  /**
   * Head pushed back (negative) under acceleration or thrown forward (positive) under braking,
   * in meters along the car. Moves the 3D eye and slightly zooms the cabin.
   */
  surge = 0;
  private surgeV = 0;
  private prev: { x: number; y: number } | null = null;

  reset(): void {
    this.bob = this.bobV = this.dice = this.diceV = this.wheel = this.surge = this.surgeV = 0;
    this.prev = null;
  }

  update(dt: number, car: Car, gravity: number, throttle: boolean): void {
    if (dt <= 0) return;
    const v = car.chassis.getLinearVelocity();
    if (!this.prev) this.prev = { x: v.x, y: v.y };
    const ax = (v.x - this.prev.x) / dt;
    const ay = (v.y - this.prev.y) / dt;
    this.prev = { x: v.x, y: v.y };

    // Acceleration and gravity in the car's own frame (x forward, y up).
    const a = car.chassis.getAngle();
    const firstFrame = !this.prev || this.speedKmh === 0;
    this.viewPitch = firstFrame ? a * 0.75 : this.viewPitch + (a * 0.75 - this.viewPitch) * Math.min(1, dt * 7);
    const c = Math.cos(-a);
    const s = Math.sin(-a);
    const lax = ax * c - ay * s;
    const lay = ax * s + ay * c;
    // Gravity (0, -g) rotated into the car frame
    const gx = -gravity * Math.sin(a);
    const gy = -gravity * Math.cos(a);

    // Head on a stiff spring: it dips when the car is pushed up (bumps, landings).
    this.bobV += (-this.bob * 110 - this.bobV * 12 - lay * 1.6) * dt;
    this.bob = Math.max(-0.35, Math.min(0.35, this.bob + this.bobV * dt));

    // Dice hang along the effective gravity felt inside the cabin.
    const ex = gx - lax;
    const ey = gy - lay;
    const target = Math.max(-1.3, Math.min(1.3, Math.atan2(ex, -ey)));
    this.diceV += ((target - this.dice) * 40 - this.diceV * 2.2) * dt;
    this.dice = Math.max(-1.5, Math.min(1.5, this.dice + this.diceV * dt));

    this.wheel += (this.bob * 0.9 - car.chassis.getAngularVelocity() * 0.04 - this.wheel) * Math.min(1, dt * 10);

    const rumble = throttle ? 1.2 : 0.4;
    this.shakeX = (Math.random() - 0.5) * rumble;
    this.shakeY = (Math.random() - 0.5) * rumble;
    this.speedKmh = Math.hypot(v.x, v.y) * 3.6;

    // Fore/aft: the body lags behind the car's acceleration, on a soft neck spring.
    const want = Math.max(-0.22, Math.min(0.22, -lax * 0.022));
    this.surgeV += ((want - this.surge) * 45 - this.surgeV * 9) * dt;
    this.surge = Math.max(-0.3, Math.min(0.3, this.surge + this.surgeV * dt));
  }
}

// ---------- cabin lighting ----------

const hexMix = (a: string, b: string, t: number): string => {
  const pa = a.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const pb = b.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!pa || !pb) return a;
  const c = [1, 2, 3].map((i) => Math.round(parseInt(pa[i], 16) * (1 - t) + parseInt(pb[i], 16) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};

/** How the outside light reaches the cabin: 1 = full daylight, lower at night and in rain. */
export interface CabinLight {
  /** Darkening amount, 0 (daylight) .. ~0.6 (night). */
  dark: number;
  /** Color the cabin shifts toward when dark. */
  tint: string;
  night: boolean;
}

/** `night` is how dark it is outside: 0 (day) .. 1 (night), or true/false for fixed-time terrains. */
export function cabinLight(night: number | boolean, wet: number): CabinLight {
  const n = typeof night === "boolean" ? (night ? 1 : 0) : night;
  return { dark: 0.58 * n + 0.3 * wet * (1 - n), tint: n > 0.3 ? "#0b1020" : "#1a1f28", night: n > 0.5 };
}

/** The interior colors as they look in this light (instrument lights stay bright). */
export function litStyle(style: InteriorStyle, light: CabinLight): InteriorStyle {
  if (light.dark <= 0) return style;
  const d = (c: string) => hexMix(c, light.tint, light.dark);
  return {
    ...style,
    dash: [d(style.dash[0]), d(style.dash[1]), d(style.dash[2])],
    trim: d(style.trim),
    wheelRim: d(style.wheelRim),
    wheelSpoke: d(style.wheelSpoke),
    glove: [d(style.glove[0]), d(style.glove[1])],
    sleeve: d(style.sleeve),
    visor: d(style.visor),
  };
}

export function litColor(c: string, light: CabinLight): string {
  return light.dark > 0 ? hexMix(c, light.tint, light.dark) : c;
}

/** Instrument backlighting at night: a soft glow around the speedometer and the sat-nav. */
export function drawInstrumentGlow(ctx: CanvasRenderingContext2D, w: number, h: number, accent: string): void {
  const top = h * COCKPIT.dashTop;
  const m = Math.min(w, h);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const glow = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexToRgba(accent, a));
    g.addColorStop(1, hexToRgba(accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(w * 0.3, top + (h - top) * 0.36, m * 0.16, 0.16);
  glow(w * 0.74, top + (h - top) * 0.55, m * 0.3, 0.1);
  ctx.restore();
}

function hexToRgba(hex: string, a: number): string {
  const p = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!p) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(p[1], 16)},${parseInt(p[2], 16)},${parseInt(p[3], 16)},${a})`;
}

// ---------- windshield: rain, wipers, reflections, glare ----------

/** Two wipers parked along the bottom of the glass, sweeping up together. */
const WIPERS = [
  { px: 0.27, len: 0.95 },
  { px: 0.6, len: 0.95 },
];
const WIPE_SWEEP = Math.PI * 0.78;

/** Wiper angle offset from parked (0..WIPE_SWEEP) at time t: up, back down, then a pause. */
function wiperAngle(t: number, period: number): number {
  const p = (t % period) / period;
  if (p < 0.35) return WIPE_SWEEP * (p / 0.35);
  if (p < 0.7) return WIPE_SWEEP * (1 - (p - 0.35) / 0.35);
  return 0;
}

/** When the wiper last swept past angle `a` (0..WIPE_SWEEP), at or before time t. */
function lastWipe(t: number, period: number, a: number): number {
  const start = Math.floor(t / period) * period;
  const up = start + period * 0.35 * (a / WIPE_SWEEP);
  const down = start + period * (0.35 + 0.35 * (1 - a / WIPE_SWEEP));
  if (t >= down) return down;
  if (t >= up) return up;
  return down - period;
}

/**
 * Rain on the glass: beads collect between wipes (more in a downpour), the wipers sweep them
 * away, and the blades are drawn on top. Everything is computed from time, nothing stored.
 */
export function drawRainGlass(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, rain: number, speedKmh: number): void {
  const win = windshieldPath(w, h);
  const top = h * COCKPIT.winTop;
  const bottom = h * COCKPIT.winBottom;
  const period = rain > 0.8 ? 1.3 : 1.9;
  const pivotY = bottom - 4;
  const m = Math.min(w, h);
  // Arms reach a little short of the top of the glass, like real wipers
  const reach = (bottom - top) * 0.95;
  ctx.save();
  ctx.clip(win);
  const n = Math.round(60 + 110 * rain);
  for (let i = 0; i < n; i++) {
    const hx = Math.sin(i * 12.9898) * 43758.5453;
    const hy = Math.sin(i * 78.233) * 43758.5453;
    const hr = Math.sin(i * 39.425) * 43758.5453;
    const fx = hx - Math.floor(hx);
    const fy = hy - Math.floor(hy);
    const fr = hr - Math.floor(hr);
    const x = w * (0.06 + 0.88 * fx);
    let y = top + (bottom - top) * fy;
    // Which wiper clears this spot, and when it last did
    let born = -Infinity;
    for (const wp of WIPERS) {
      const dx = x - w * wp.px;
      const dy = y - pivotY;
      const dist = Math.hypot(dx, dy);
      if (dist > reach * wp.len) continue;
      // Angle swept from the parked position (pointing left along the bottom)
      let a = Math.atan2(dy, dx);
      if (a > 0) a -= Math.PI * 2;
      const off = a + Math.PI; // 0 = parked (left), rising as the blade sweeps up
      if (off < 0 || off > WIPE_SWEEP) continue;
      born = Math.max(born, lastWipe(time, period, off));
    }
    if (born === -Infinity) born = Math.floor(time / 2.5 + fr) * 2.5 - fr * 2.5; // outside the wiped area: drops run off now and then
    const age = time - born - fr * period * 0.9; // each drop lands a little after the wipe
    if (age < 0) continue;
    // Heavier drops slowly run down the glass; at speed the wind pushes them up instead
    const run = Math.min(30, age * (speedKmh > 50 ? -14 : 9) * fr);
    y += run;
    const r = (1.6 + fr * 3.2) * Math.min(1, age * 3) * (m / 700 + 0.4);
    ctx.fillStyle = "rgba(190, 210, 230, 0.4)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wiper arms and blades
  const sweep = wiperAngle(time, period);
  ctx.lineCap = "round";
  for (const wp of WIPERS) {
    const px = w * wp.px;
    const len = reach * wp.len;
    const a = Math.PI + sweep;
    const ex = px + Math.cos(a) * len;
    const ey = pivotY + Math.sin(a) * len;
    ctx.strokeStyle = "#141518";
    ctx.lineWidth = Math.max(3, m * 0.007);
    ctx.beginPath();
    ctx.moveTo(px, pivotY);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.lineWidth = Math.max(4, m * 0.011);
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * len * 0.3, pivotY + Math.sin(a) * len * 0.3);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Glass you can feel: a faint reflection of the dashboard along the bottom of the windshield,
 * and (in clear daylight) soft glare where the low sun shines in from the left.
 */
export function drawGlassLight(ctx: CanvasRenderingContext2D, w: number, h: number, dashColor: string, light: CabinLight): void {
  const win = windshieldPath(w, h);
  const top = h * COCKPIT.winTop;
  const bottom = h * COCKPIT.winBottom;
  ctx.save();
  ctx.clip(win);
  const refl = ctx.createLinearGradient(0, bottom - (bottom - top) * 0.22, 0, bottom);
  refl.addColorStop(0, hexToRgba(dashColor, 0));
  refl.addColorStop(1, hexToRgba(dashColor, light.night ? 0.05 : 0.12));
  ctx.fillStyle = refl;
  ctx.fillRect(0, bottom - (bottom - top) * 0.22, w, (bottom - top) * 0.22);
  if (!light.night && light.dark < 0.15) {
    const gx = w * 0.06;
    const gy = top + (bottom - top) * 0.42;
    const r = Math.max(w, h) * 0.34;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
    g.addColorStop(0, "rgba(255, 244, 214, 0.22)");
    g.addColorStop(0.35, "rgba(255, 236, 200, 0.07)");
    g.addColorStop(1, "rgba(255, 236, 200, 0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, bottom - top);
  }
  ctx.restore();
}

/** Left and right door mirrors (glass rects), at the lower corners of the windshield. */
export function sideMirrorRects(w: number, h: number): { left: Rect; right: Rect } {
  const mw = Math.min(w * 0.13, 170);
  const mh = mw * 0.62;
  const y = h * (COCKPIT.winBottom - 0.07) - mh;
  return { left: { x: w * 0.035, y, w: mw, h: mh }, right: { x: w * 0.965 - mw, y, w: mw, h: mh } };
}

/** Housing and arm of a door mirror (drawn over its glass). */
export function drawSideMirrorFrame(ctx: CanvasRenderingContext2D, r: Rect, side: "left" | "right"): void {
  ctx.fillStyle = "#15161a";
  const armX = side === "left" ? r.x + r.w : r.x;
  ctx.fillRect(side === "left" ? armX : armX - 18, r.y + r.h * 0.55, 18, 10);
  ctx.strokeStyle = "#15161a";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 12);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h * 0.35);
}

/** The rear-view mirror's glass, in CSS pixels. */
export function mirrorRect(w: number, h: number): Rect {
  const mw = Math.min(w * 0.2, 240);
  const mh = Math.min(h * 0.11, mw * 0.42);
  // Sits just below the score panel at the top of the screen.
  return { x: w * 0.5 - mw / 2, y: Math.max(h * COCKPIT.winTop + 6, 100), w: mw, h: mh };
}

/** Wide windshield with a slanted A-pillar on each side. */
function windshieldPath(w: number, h: number): Path2D {
  const L = w * COCKPIT.winLeft;
  const T = h * COCKPIT.winTop;
  const R = w * COCKPIT.winRight;
  const B = h * COCKPIT.winBottom;
  const slant = w * 0.07;
  const r = Math.min(w, h) * 0.04;
  const p = new Path2D();
  p.moveTo(L + slant + r, T);
  p.lineTo(R - slant - r, T);
  p.quadraticCurveTo(R - slant, T, R - slant + r * 0.3, T + r);
  p.lineTo(R, B);
  p.lineTo(L, B);
  p.lineTo(L + slant - r * 0.3, T + r);
  p.quadraticCurveTo(L + slant, T, L + slant + r, T);
  p.closePath();
  return p;
}

/** Glass tint and reflections over the windshield (drawn before the hood and frame). */
export function drawGlass(ctx: CanvasRenderingContext2D, w: number, h: number, speedKmh = 0, time = 0): void {
  const win = windshieldPath(w, h);
  ctx.save();
  ctx.clip(win);
  // Faint streaks rushing past the edges of the view at speed
  const rush = Math.max(0, Math.min(1, (speedKmh - 45) / 60));
  if (rush > 0) {
    const cx = w * 0.5;
    const cy = h * 0.4;
    ctx.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      const seed = Math.sin(i * 91.7) * 43758.5;
      const ang = (seed - Math.floor(seed)) * Math.PI * 2;
      const phase = (time * (1.6 + (i % 5) * 0.3) + i * 0.37) % 1;
      const r0 = Math.max(w, h) * (0.32 + phase * 0.5);
      const len = Math.max(w, h) * 0.06 * (0.5 + phase);
      const x0 = cx + Math.cos(ang) * r0;
      const y0 = cy + Math.sin(ang) * r0 * 0.6;
      ctx.strokeStyle = `rgba(255,255,255,${0.16 * rush * (1 - phase)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len * 0.6);
      ctx.stroke();
    }
  }
  const tint = ctx.createLinearGradient(0, h * COCKPIT.winTop, 0, h * COCKPIT.winBottom);
  tint.addColorStop(0, "rgba(40, 70, 100, 0.22)"); // sun-strip tint at the top
  tint.addColorStop(0.18, "rgba(170, 210, 230, 0.05)");
  tint.addColorStop(1, "rgba(170, 210, 230, 0.03)");
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (const [a, b] of [
    [0.6, 0.66],
    [0.7, 0.72],
  ]) {
    ctx.beginPath();
    ctx.moveTo(w * a, h * COCKPIT.winTop);
    ctx.lineTo(w * b, h * COCKPIT.winTop);
    ctx.lineTo(w * (b - 0.16), h * COCKPIT.winBottom);
    ctx.lineTo(w * (a - 0.16), h * COCKPIT.winBottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The front of your own vehicle, painted in its body color, seen over the dashboard. */
export function drawHood(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  const top = h * (COCKPIT.dashTop - 0.075);
  const bottom = h * COCKPIT.dashTop + 4;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(w * 0.04, bottom);
  ctx.quadraticCurveTo(w * 0.12, top + h * 0.012, w * 0.5, top);
  ctx.quadraticCurveTo(w * 0.88, top + h * 0.012, w * 0.96, bottom);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.clip();
  const shade = ctx.createLinearGradient(0, top, 0, bottom);
  shade.addColorStop(0, "rgba(255,255,255,0.35)");
  shade.addColorStop(0.35, "rgba(255,255,255,0.05)");
  shade.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, top, w, bottom - top);
  // Sky reflection streak and a center crease
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.ellipse(w * 0.36, top + (bottom - top) * 0.35, w * 0.14, (bottom - top) * 0.1, -0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, top + 2);
  ctx.lineTo(w * 0.5, bottom);
  ctx.stroke();
  ctx.restore();
}

/** Cabin frame: roof, pillars, door edges — everything around the windshield. */
export function drawCabin(ctx: CanvasRenderingContext2D, w: number, h: number, style: InteriorStyle = DEFAULT_STYLE): void {
  const win = windshieldPath(w, h);
  const frame = new Path2D();
  frame.rect(-50, -50, w + 100, h + 100);
  frame.addPath(win);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "#17181d");
  g.addColorStop(0.15, style.trim);
  g.addColorStop(0.85, style.trim);
  g.addColorStop(1, "#17181d");
  ctx.fillStyle = g;
  ctx.fill(frame, "evenodd");

  // Headliner shading along the roof
  const roof = ctx.createLinearGradient(0, 0, 0, h * COCKPIT.winTop);
  roof.addColorStop(0, "rgba(0,0,0,0.35)");
  roof.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = roof;
  ctx.fillRect(0, 0, w, h * COCKPIT.winTop);

  // Rubber seal around the glass
  ctx.strokeStyle = "#0e0f12";
  ctx.lineWidth = 6;
  ctx.stroke(win);
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  ctx.stroke(win);

  // Sun visors and dome light
  ctx.fillStyle = style.visor;
  for (const x of [0.2, 0.68]) {
    ctx.beginPath();
    ctx.roundRect(w * x, h * 0.005, w * 0.12, h * (COCKPIT.winTop - 0.01), 10);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255, 245, 200, 0.45)";
  ctx.beginPath();
  ctx.roundRect(w * 0.47, h * 0.012, w * 0.06, h * 0.022, 4);
  ctx.fill();
}

export interface DashInfo {
  glue: number;
  /** 0..1, or -1 when fuel is switched off */
  fuel: number;
  rpm: number;
  gear: number;
  /** Null in the shop preview (no road to show). */
  terrain: Terrain | null;
  carX: number;
  /** Time-trial ghost position, if racing one. */
  ghostX: number | null;
  /** Show miles per hour instead of km/h. */
  mph: boolean;
  /** How settled the egg is in the bed. */
  egg: EggStatus;
  /** Run readout for the dash screen (distance or time, and best). */
  readout: string;
  /** Distance traveled this run (m), your best (m, 0 if none), the finish (m) on courses, and the run time on courses. */
  trip?: number;
  best?: number;
  goal?: number | null;
  time?: string | null;
  /** Truck tilt vs the ground, for the gyro. */
  attitude: Attitude;
}

export type EggStatus = "ok" | "slip" | "danger" | "glued" | "gone";

/** Dashboard: speedometer with fuel arc, and a navigation screen showing the road ahead. */
export function drawDashboard(ctx: CanvasRenderingContext2D, w: number, h: number, st: CockpitState, info: DashInfo, style: InteriorStyle = DEFAULT_STYLE): void {
  const top = h * COCKPIT.dashTop;
  const m = Math.min(w, h);

  // Dash body with a curved top, in the chosen material
  const dg = ctx.createLinearGradient(0, top, 0, h);
  dg.addColorStop(0, style.dash[0]);
  dg.addColorStop(0.25, style.dash[1]);
  dg.addColorStop(1, style.dash[2]);
  ctx.fillStyle = dg;
  const dashPath = new Path2D();
  dashPath.moveTo(-10, top + h * 0.03);
  dashPath.quadraticCurveTo(w * 0.5, top - h * 0.03, w + 10, top + h * 0.02);
  dashPath.lineTo(w + 10, h + 10);
  dashPath.lineTo(-10, h + 10);
  dashPath.closePath();
  ctx.fill(dashPath);
  if (style.woodGrain) {
    // Wavy walnut grain
    ctx.save();
    ctx.clip(dashPath);
    ctx.strokeStyle = "rgba(40, 20, 8, 0.25)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      const y0 = top + ((h - top) * i) / 18;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 40) ctx.lineTo(x, y0 + Math.sin(x * 0.012 + i * 1.7) * 5);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, top + h * 0.03);
  ctx.quadraticCurveTo(w * 0.5, top - h * 0.03, w + 10, top + h * 0.02);
  ctx.stroke();

  // Speedometer
  // Speedometer sits behind the steering wheel, seen through its open top.
  const cx = w * 0.3;
  const cy = top + (h - top) * 0.36;
  const r = Math.min(m * 0.085, (h - top) * 0.34);
  ctx.fillStyle = "#0f1013";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16181d";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const a0 = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  // A tick every 10 units, 0–140 km/h or 0–90 mph; the top two ticks are the red zone.
  const speed = info.mph ? st.speedKmh * 0.621371 : st.speedKmh;
  const maxSpeed = info.mph ? 90 : 140;
  const ticks = maxSpeed / 10;
  ctx.lineCap = "round";
  for (let k = 0; k <= ticks; k++) {
    const a = a0 + (span * k) / ticks;
    const major = k % 2 === 0;
    ctx.strokeStyle = k >= ticks - 2 ? "#ff5a4a" : "#d9dde6";
    ctx.lineWidth = major ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * (major ? 0.74 : 0.8), cy + Math.sin(a) * r * (major ? 0.74 : 0.8));
    ctx.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.stroke();
  }
  // Fuel arc along the bottom of the dial (hidden when fuel is switched off)
  if (info.fuel >= 0) {
    const f0 = Math.PI * 0.32;
    const f1 = Math.PI * 0.68;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, f1, f0, true);
    ctx.stroke();
    const low = info.fuel < 0.2;
    ctx.strokeStyle = low ? (Math.floor(performance.now() / 300) % 2 ? "#ff4a3a" : "#ffffff") : "#5cd65c";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, f1, f1 - (f1 - f0) * Math.max(0.001, info.fuel), true);
    ctx.stroke();
  }
  const na = a0 + (span * Math.min(maxSpeed, speed)) / maxSpeed;
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(na) * r * 0.82, cy + Math.sin(na) * r * 0.82);
  ctx.stroke();
  ctx.fillStyle = style.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(r * 0.32)}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(speed)), cx, cy + r * 0.4);
  ctx.font = `${Math.round(r * 0.14)}px Trebuchet MS, sans-serif`;
  ctx.fillStyle = "#9aa0ad";
  ctx.fillText(info.mph ? "mph" : "km/h", cx, cy + r * 0.6);
  ctx.fillStyle = style.accent;
  ctx.font = `bold ${Math.round(r * 0.18)}px Trebuchet MS, sans-serif`;
  ctx.fillText(info.rpm > 0 ? `${info.gear + 1}  ·  ${(info.rpm / 1000).toFixed(1)}k` : "OFF", cx, cy - r * 0.38);

  drawNav(ctx, w * 0.56, top + (h - top) * 0.12, w * 0.36, h - 12 - (top + (h - top) * 0.12), info, style.accent);
  drawEggLight(ctx, w * 0.455, top + (h - top) * 0.16, w * 0.095, (h - top) * 0.5, info.egg);
  // Trip odometer under the egg lamp (clear of the steering wheel rim)
  drawOdometer(ctx, w * 0.455, top + (h - top) * 0.76, w * 0.095, Math.min((h - top) * 0.16, w * 0.026), Math.max(0, info.carX));
  // Gyro on the left of the dash: clear of the steering wheel and the on-screen brake pedal
  const gr = Math.min(w * 0.045, (h - top) * 0.26);
  if (gr > 16) drawGyro(ctx, w * 0.11, top + (h - top) * 0.32, gr, info.attitude);
}

/** Egg status lamp on the center console: green settled, amber sliding, red about to fall, blue glued. */
function drawEggLight(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, status: EggStatus): void {
  if (w < 50) return;
  const look: Record<EggStatus, [string, string]> = {
    ok: ["#5cd65c", "EGG OK"],
    slip: ["#f5c400", "SLIDING"],
    danger: ["#ff4a3a", "DANGER!"],
    glued: ["#3d8bff", "GLUED"],
    gone: ["#6b707c", "NO EGG"],
  };
  const [color, label] = look[status];
  const blink = status === "danger" && Math.floor(performance.now() / 180) % 2 === 0;
  ctx.save();
  ctx.fillStyle = "#0b0d12";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  // Egg glyph lit in the status color
  const ex = x + w / 2;
  const ey = y + h * 0.42;
  const er = Math.min(w, h) * 0.24;
  ctx.shadowColor = color;
  ctx.shadowBlur = blink ? 4 : 14;
  ctx.fillStyle = blink ? "#3a2020" : color;
  ctx.beginPath();
  ctx.ellipse(ex, ey, er * 0.78, er, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = status === "gone" ? "#9aa0ad" : "#ffffff";
  ctx.font = `bold ${Math.max(9, Math.round(h * 0.15))}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, ex, y + h * 0.84);
  ctx.restore();
}

/**
 * Sat-nav screen: a perspective map with the route ahead as a blue line, map pins for pickups and
 * hazards, a turn-by-turn style banner for the next event, a compass and an elevation strip.
 */
export function drawNav(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, info: DashInfo, accent = "#7fd3ff"): void {
  if (w < 80 || h < 50) return;
  const t = info.terrain;
  ctx.save();
  // Bezel and screen
  ctx.fillStyle = "#0b0d12";
  ctx.beginPath();
  ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  ctx.clip();

  const big = h > 110;
  const bannerH = Math.max(18, h * (big ? 0.2 : 0.24));
  const barH = Math.max(18, h * (big ? 0.2 : 0.18));
  const mapTop = y + bannerH;
  const mapBottom = y + h - barH;
  const font = (px: number, bold = true) => `${bold ? "bold " : ""}${Math.round(px)}px Trebuchet MS, sans-serif`;

  // ----- map -----
  const land = ctx.createLinearGradient(0, mapTop, 0, mapBottom);
  land.addColorStop(0, "#1a2a33");
  land.addColorStop(1, "#22343d");
  ctx.fillStyle = land;
  ctx.fillRect(x, mapTop, w, mapBottom - mapTop);

  if (!t) {
    ctx.fillStyle = "rgba(127,211,255,0.35)";
    ctx.font = font(h * 0.1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("◆ NAV ◆", x + w / 2, (mapTop + mapBottom) / 2);
    drawBanner("↑", "Navigation", "", "#2b6b3f");
    ctx.restore();
    return;
  }

  const carX = info.carX;
  const AHEAD = 260;
  const horizon = mapTop + (mapBottom - mapTop) * 0.08;
  const baseY = mapBottom - (mapBottom - mapTop) * 0.1;
  const cx0 = x + w / 2;
  // Gentle bends so the straight 2D road reads like a real route on a map
  const bend = (wx: number) => Math.sin(wx * 0.008) * 0.9 + Math.sin(wx * 0.019 + 1.3) * 0.35;
  const project = (d: number, lat = 0) => {
    const k = d / (d + 70); // perspective squash toward the horizon
    const py = baseY - k * (baseY - horizon);
    const scale = 1 - k * 0.82;
    const curve = (bend(carX + d) - bend(carX)) * w * 0.13 * k;
    return { x: cx0 + curve + lat * scale, y: py, s: scale };
  };

  // Side streets and parks every so often, for a map-like look
  for (let d0 = 40 - (carX % 40); d0 < AHEAD; d0 += 40) {
    const a = project(d0);
    const side = Math.floor((carX + d0) / 40) % 2 ? 1 : -1;
    ctx.strokeStyle = "rgba(160, 185, 200, 0.28)";
    ctx.lineWidth = Math.max(1, 6 * a.s);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + side * w * 0.6 * a.s, a.y - 4 * a.s);
    ctx.stroke();
    if (Math.floor((carX + d0) / 40) % 3 === 0) {
      const b = project(d0 + 18);
      ctx.fillStyle = "rgba(70, 140, 80, 0.35)";
      ctx.beginPath();
      ctx.ellipse((a.x + b.x) / 2 - side * w * 0.22 * a.s, (a.y + b.y) / 2, w * 0.12 * a.s, Math.max(2, (a.y - b.y) * 0.45), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Road casing, then the highlighted route
  const route = new Path2D();
  for (let d = 0; d <= AHEAD; d += 6) {
    const p = project(d);
    if (d === 0) route.moveTo(p.x, p.y);
    else route.lineTo(p.x, p.y);
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#4a5d68";
  ctx.lineWidth = Math.max(10, w * 0.07);
  ctx.stroke(route);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(7, w * 0.05);
  ctx.stroke(route);
  ctx.strokeStyle = "#2f8cff";
  ctx.lineWidth = Math.max(5, w * 0.038);
  ctx.stroke(route);

  // Map pins for what's coming up
  type Pin = { d: number; icon: string; color: string };
  const pins: Pin[] = [];
  for (const pu of t.powerUps) {
    if (pu.taken) continue;
    const d = pu.x - carX;
    if (d < 2 || d > AHEAD) continue;
    pins.push({ d, icon: pu.kind === "glue" ? "🧴" : pu.kind === "fuel" ? "⛽" : "❤", color: pu.kind === "glue" ? "#3d8bff" : pu.kind === "fuel" ? "#e2483d" : "#ff6b8a" });
  }
  for (const c of t.coins) {
    const d = c.x - carX;
    if (!c.taken && c.value > 1 && d > 2 && d < AHEAD) pins.push({ d, icon: "★", color: "#e8a317" });
  }
  for (const f of t.features) {
    const d = (f.kind === "ramp" ? f.x - 7 : f.x) - carX;
    if (d > 2 && d < AHEAD) pins.push({ d, icon: "⚠", color: "#f5a623" });
  }
  if (t.finishX !== null) {
    const d = t.finishX - carX;
    if (d > 2 && d < AHEAD) pins.push({ d, icon: "🏁", color: "#222" });
  }
  if (info.ghostX !== null) {
    const d = info.ghostX - carX;
    if (d > -5 && d < AHEAD) {
      const p = project(Math.max(0, d));
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, 6 * p.s), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  pins.sort((a, b) => b.d - a.d); // far first so near pins draw on top
  for (const pin of pins) {
    const p = project(pin.d);
    const r = Math.max(6, Math.min(13, h * 0.075) * (0.45 + p.s * 0.75));
    const side = Math.floor(pin.d / 15) % 2 ? 1 : -1;
    const px = p.x + side * r * 1.4;
    const py = p.y - r * 1.2;
    // Teardrop pin
    ctx.fillStyle = pin.color;
    ctx.beginPath();
    ctx.moveTo(px, p.y);
    ctx.arc(px, py, r, Math.PI * 0.8, Math.PI * 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = font(r * 1.05, false);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pin.icon, px, py + 1);
  }

  // Your car: a navigation chevron with a soft halo
  const me = project(0);
  ctx.fillStyle = "rgba(47,140,255,0.25)";
  ctx.beginPath();
  ctx.arc(me.x, me.y, Math.max(12, w * 0.06), 0, Math.PI * 2);
  ctx.fill();
  const cr = Math.max(8, w * 0.035);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1f5fbf";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(me.x, me.y - cr * 1.2);
  ctx.lineTo(me.x + cr * 0.85, me.y + cr * 0.8);
  ctx.lineTo(me.x, me.y + cr * 0.35);
  ctx.lineTo(me.x - cr * 0.85, me.y + cr * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Compass (you always head east in this world)
  if (big) {
    const kr = Math.max(9, h * 0.07);
    const kx = x + w - kr - 6;
    const ky = mapTop + kr + 6;
    ctx.fillStyle = "rgba(10,14,20,0.75)";
    ctx.beginPath();
    ctx.arc(kx, ky, kr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e2483d";
    ctx.beginPath();
    ctx.moveTo(kx - kr * 0.7, ky);
    ctx.lineTo(kx, ky - kr * 0.25);
    ctx.lineTo(kx, ky + kr * 0.25);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = font(kr * 0.8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", kx + kr * 0.35, ky + 1);
  }

  // Elevation strip in the bottom-left of the map
  if (big) {
    const ew = w * 0.32;
    const eh = (mapBottom - mapTop) * 0.2;
    const ex = x + 6;
    const ey = mapBottom - eh - 4;
    ctx.fillStyle = "rgba(10,14,20,0.6)";
    ctx.beginPath();
    ctx.roundRect(ex, ey, ew, eh, 4);
    ctx.fill();
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = 0; d <= AHEAD; d += 10) {
      const v = t.height(carX + d);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const range = Math.max(6, hi - lo);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let d = 0; d <= AHEAD; d += 5) {
      const px = ex + 3 + (d / AHEAD) * (ew - 6);
      const py = ey + eh - 3 - ((t.height(carX + d) - lo) / range) * (eh - 6);
      if (d === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // ----- turn-by-turn banner: the next thing on the road -----
  type Next = { d: number; arrow: string; text: string; color: string };
  let next: Next | null = null;
  const consider = (n: Next) => {
    if (n.d > 3 && n.d < 400 && (!next || n.d < next.d)) next = n;
  };
  for (const f of t.features) {
    if (f.kind === "ramp") consider({ d: f.x - 7 - carX, arrow: "⤴", text: "Jump ramp", color: "#b8650a" });
    else consider({ d: f.x - carX, arrow: "⑂", text: "Fork: bridge or road", color: "#8a4a12" });
  }
  for (const pu of t.powerUps) {
    if (pu.taken) continue;
    if (pu.kind === "fuel") consider({ d: pu.x - carX, arrow: "⛽", text: "Fuel can", color: "#2b6b3f" });
    else if (pu.kind === "life") consider({ d: pu.x - carX, arrow: "❤", text: "Extra life", color: "#8a2a45" });
  }
  if (t.finishX !== null) consider({ d: t.finishX - carX, arrow: "🏁", text: "Finish", color: "#1f2a44" });
  const n = next as Next | null;
  if (n) drawBanner(n.arrow, n.text, `${Math.round(n.d / 10) * 10} m`, n.color);
  else drawBanner("↑", "Follow the road", "", "#2b6b3f");

  // ----- bottom info bar: distance traveled, progress, and a reminder chip -----
  const barGrad = ctx.createLinearGradient(0, mapBottom, 0, mapBottom + barH);
  barGrad.addColorStop(0, "#162029");
  barGrad.addColorStop(1, "#0b1116");
  ctx.fillStyle = barGrad;
  ctx.fillRect(x, mapBottom, w, barH);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x, mapBottom, w, 1);
  const midY = mapBottom + barH / 2;
  ctx.textBaseline = "middle";
  if (info.trip === undefined) {
    ctx.font = font(barH * 0.55);
    ctx.textAlign = "left";
    ctx.fillStyle = accent;
    ctx.fillText(info.readout || "", x + 6, midY);
    ctx.restore();
    return;
  }
  // Right chip first (so the progress bar knows how much room is left)
  let chip = "";
  let chipColor = "#cfe9ff";
  if (info.glue > 0 && (info.glue > 3 || Math.floor(performance.now() / 200) % 2 === 0)) {
    chip = `🧴 ${Math.ceil(info.glue)}s`;
    chipColor = "#6fb2ff";
  } else if (info.time) {
    chip = `⏱ ${info.time}`;
  } else {
    let fuel: number | null = null;
    for (const pu of t.powerUps) if (!pu.taken && pu.kind === "fuel" && pu.x > carX && (fuel === null || pu.x < fuel)) fuel = pu.x;
    if (fuel !== null) chip = `⛽ ${Math.round(fuel - carX)} m`;
  }
  ctx.font = font(barH * 0.42);
  const chipW = chip ? ctx.measureText(chip).width + 14 : 0;
  if (chip) {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(x + w - chipW - 5, midY - barH * 0.3, chipW, barH * 0.6, barH * 0.3);
    ctx.fill();
    ctx.fillStyle = chipColor;
    ctx.textAlign = "center";
    ctx.fillText(chip, x + w - 5 - chipW / 2, midY + 1);
  }
  // Distance traveled: route icon, big number, unit
  const trip = Math.max(0, info.trip);
  const km = trip >= 10000;
  const num = km ? (trip / 1000).toFixed(1) : String(Math.floor(trip));
  const unit = km ? "km" : "m";
  const iconR = barH * 0.26;
  const ix = x + 8 + iconR;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, barH * 0.07);
  ctx.beginPath();
  ctx.moveTo(ix - iconR, midY + iconR);
  ctx.bezierCurveTo(ix - iconR * 0.2, midY + iconR * 0.2, ix + iconR * 0.2, midY - iconR * 0.2, ix + iconR, midY - iconR);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(ix + iconR, midY - iconR, iconR * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.font = font(barH * 0.66);
  ctx.fillStyle = "#ffffff";
  const nx = ix + iconR + 8;
  ctx.fillText(num, nx, midY + 1);
  const numW = ctx.measureText(num).width;
  ctx.font = font(barH * 0.36);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(unit, nx + numW + 3, midY + barH * 0.08);
  const unitW = ctx.measureText(unit).width;
  // Progress: toward the finish on courses, toward your best otherwise
  const px0 = nx + numW + unitW + 12;
  const px1 = x + w - chipW - 12;
  const goal = info.goal ?? null;
  const best = info.best ?? 0;
  const target = goal ?? best;
  if (px1 - px0 > 40 && target > 0) {
    const frac = Math.min(1, trip / target);
    const beat = goal === null && trip > best;
    const labelH = barH * 0.32;
    const trackY = midY + barH * 0.14;
    const trackH = Math.max(3, barH * 0.13);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.roundRect(px0, trackY - trackH / 2, px1 - px0, trackH, trackH / 2);
    ctx.fill();
    const fill = ctx.createLinearGradient(px0, 0, px1, 0);
    fill.addColorStop(0, beat ? "#ffb300" : accent);
    fill.addColorStop(1, beat ? "#ffe066" : "#ffffff");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(px0, trackY - trackH / 2, Math.max(trackH, (px1 - px0) * frac), trackH, trackH / 2);
    ctx.fill();
    // Label above the bar
    ctx.font = font(labelH);
    ctx.textAlign = "left";
    ctx.fillStyle = beat ? "#ffd84a" : "rgba(255,255,255,0.7)";
    const left = Math.max(0, Math.ceil(target - trip));
    const label = goal !== null ? `🏁 ${left} m to go` : beat ? `🏆 NEW BEST · +${Math.floor(trip - best)} m` : `BEST ${Math.floor(best)} m · ${left} m to beat`;
    ctx.fillText(label, px0, midY - barH * 0.17);
  }
  ctx.restore();

  function drawBanner(arrow: string, text: string, dist: string, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, bannerH);
    const box = bannerH - 6;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 3, box, box, 5);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(box * 0.72, false);
    ctx.fillText(arrow, x + 4 + box / 2, y + bannerH / 2 + 1);
    ctx.textAlign = "left";
    ctx.font = font(bannerH * 0.48);
    ctx.fillText(dist, x + box + 10, y + bannerH * (big ? 0.34 : 0.5));
    ctx.font = font(bannerH * (big ? 0.32 : 0.4), !big);
    if (big) ctx.fillText(text, x + box + 10, y + bannerH * 0.74);
    else ctx.fillText(`${text}`, x + box + 10 + (dist ? ctx.measureText(dist).width + 30 : 0), y + bannerH / 2);
  }
}

/** Steering wheel with the driver's hands, seen from the driver's seat. */
export function drawSteeringWheel(ctx: CanvasRenderingContext2D, w: number, h: number, st: CockpitState, style: InteriorStyle = DEFAULT_STYLE): void {
  const m = Math.min(w, h);
  const cx = w * 0.3;
  const cy = h * 0.97;
  // Capped by width too, so on tall screens the rim never covers the egg lamp beside it.
  const r = Math.min(m * 0.26, w * 0.13);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(st.wheel);

  // Column and hub
  ctx.fillStyle = "#15161a";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = style.wheelSpoke;
  ctx.lineWidth = r * 0.12;
  ctx.lineCap = "round";
  for (const a of [Math.PI, 0, Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    ctx.stroke();
  }
  // Rim
  ctx.strokeStyle = style.wheelRim;
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  if (style.carbon) {
    // Carbon weave: short alternating ticks around the rim
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = r * 0.03;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const o = k % 2 ? 0.05 : -0.05;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * (0.94 + o), Math.sin(a) * r * (0.94 + o));
      ctx.lineTo(Math.cos(a + 0.06) * r * (1.06 + o), Math.sin(a + 0.06) * r * (1.06 + o));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.03, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  // Little badge
  ctx.fillStyle = "#e8a317";
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.02, r * 0.09, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Gloved hands at ten and two
  for (const side of [-1, 1]) {
    const a = -Math.PI / 2 + side * 0.95;
    const hx = Math.cos(a) * r;
    const hy = Math.sin(a) * r;
    ctx.fillStyle = style.glove[0];
    ctx.beginPath();
    ctx.ellipse(hx, hy, r * 0.13, r * 0.17, a + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.glove[1];
    ctx.beginPath();
    ctx.ellipse(hx + side * r * 0.02, hy + r * 0.12, r * 0.1, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Sleeve going down off screen
    ctx.strokeStyle = style.sleeve;
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(hx + side * r * 0.05, hy + r * 0.15);
    ctx.lineTo(hx + side * r * 0.35, hy + r * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Mirror housing (drawn after the mirror image) and the fuzzy dice hanging from it. */
export function drawMirrorFrame(ctx: CanvasRenderingContext2D, rect: Rect, st: CockpitState, style: InteriorStyle = DEFAULT_STYLE): void {
  const { x, y, w, h } = rect;
  // Stem up to the roof
  ctx.fillStyle = "#15161a";
  ctx.fillRect(x + w / 2 - 4, 0, 8, y + 2);
  // Housing
  ctx.strokeStyle = "#15161a";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 8);
  ctx.stroke();

  if (style.charm === "none") return;
  // The charm swings on its string with the forces in the cabin
  const ax = x + w * 0.8;
  const ay = y + h;
  const len = Math.max(36, h * 0.9);
  const size = Math.max(14, h * 0.32);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(-st.dice); // screen y is down; positive swing goes toward the windshield (right)
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (style.charm === "dice") {
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, len);
    ctx.moveTo(0, 0);
    ctx.lineTo(7, len * 0.8);
    ctx.stroke();
    die(ctx, -6, len, size, 0.25, [5]);
    die(ctx, 7, len * 0.8, size * 0.9, -0.3, [3]);
  } else {
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len);
    ctx.stroke();
    drawCharm(ctx, style.charm, 0, len, size * 1.2);
  }
  ctx.restore();
}

/** Hanging charms other than the dice, drawn centered below (x, y). */
function drawCharm(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  if (kind === "pine") {
    // Cardboard pine-tree air freshener
    ctx.fillStyle = "#2f8a4a";
    ctx.strokeStyle = "#1d5c30";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.5, s * 0.55);
    ctx.lineTo(s * 0.25, s * 0.55);
    ctx.lineTo(s * 0.6, s * 1.05);
    ctx.lineTo(s * 0.1, s * 1.05);
    ctx.lineTo(s * 0.1, s * 1.3);
    ctx.lineTo(-s * 0.1, s * 1.3);
    ctx.lineTo(-s * 0.1, s * 1.05);
    ctx.lineTo(-s * 0.6, s * 1.05);
    ctx.lineTo(-s * 0.25, s * 0.55);
    ctx.lineTo(-s * 0.5, s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "egg") {
    const g = ctx.createRadialGradient(-s * 0.12, s * 0.35, 1, 0, s * 0.45, s * 0.5);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#e6cfa6");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.45, s * 0.32, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b39a6b";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (kind === "star") {
    ctx.fillStyle = "#ffd84a";
    ctx.strokeStyle = "#c79100";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 ? s * 0.22 : s * 0.5;
      const px = Math.cos(a) * r;
      const py = s * 0.5 + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A little toy stuck to the top of the dashboard, wobbling with the cabin's motion. */
export function drawDashToy(ctx: CanvasRenderingContext2D, w: number, h: number, st: CockpitState, style: InteriorStyle): void {
  if (style.toy === "none") return;
  const m = Math.min(w, h);
  const s = m * 0.06;
  const x = w * 0.5;
  const y = h * COCKPIT.dashTop - h * 0.006;
  const wobble = st.dice * 0.35;
  const bob = Math.max(-1, Math.min(1, st.bob * 4));
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  if (style.toy === "chick") {
    // Body on a spring, head bobbing on top
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -s * 0.35);
    ctx.stroke();
    ctx.rotate(wobble);
    ctx.translate(0, -s * (0.35 + 0.08 * bob));
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.3, s * 0.38, s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s * 0.1, -s * 0.8, s * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff8a1f";
    ctx.beginPath();
    ctx.moveTo(s * 0.33, -s * 0.82);
    ctx.lineTo(s * 0.5, -s * 0.76);
    ctx.lineTo(s * 0.33, -s * 0.7);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(s * 0.18, -s * 0.86, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  } else if (style.toy === "cactus") {
    ctx.rotate(wobble * 0.4);
    ctx.fillStyle = "#c2603a";
    ctx.fillRect(-s * 0.3, -s * 0.35, s * 0.6, s * 0.35);
    ctx.fillStyle = "#3f8f4a";
    ctx.beginPath();
    ctx.roundRect(-s * 0.13, -s * 1.05, s * 0.26, s * 0.75, s * 0.13);
    ctx.roundRect(-s * 0.38, -s * 0.8, s * 0.18, s * 0.35, s * 0.09);
    ctx.roundRect(s * 0.2, -s * 0.9, s * 0.18, s * 0.38, s * 0.09);
    ctx.fill();
  } else if (style.toy === "duck") {
    ctx.rotate(wobble * 0.6);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.28, s * 0.5, s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s * 0.25, -s * 0.68, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff8a1f";
    ctx.beginPath();
    ctx.ellipse(s * 0.5, -s * 0.64, s * 0.14, s * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(s * 0.32, -s * 0.74, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  } else if (style.toy === "trophy") {
    ctx.rotate(wobble * 0.3);
    const g = ctx.createLinearGradient(-s * 0.4, 0, s * 0.4, 0);
    g.addColorStop(0, "#c79100");
    g.addColorStop(0.5, "#ffe27a");
    g.addColorStop(1, "#b37f00");
    ctx.fillStyle = g;
    ctx.fillRect(-s * 0.32, -s * 0.15, s * 0.64, s * 0.15);
    ctx.fillRect(-s * 0.06, -s * 0.45, s * 0.12, s * 0.3);
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, -s * 1.0);
    ctx.lineTo(s * 0.4, -s * 1.0);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.45, 0, -s * 0.45);
    ctx.quadraticCurveTo(-s * 0.35, -s * 0.45, -s * 0.4, -s * 1.0);
    ctx.fill();
  }
  ctx.restore();
}

function die(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, faces: number[]): void {
  ctx.save();
  ctx.translate(x, y + s / 2);
  ctx.rotate(rot);
  ctx.fillStyle = "#f2f2f2";
  ctx.strokeStyle = "#bdbdbd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.25);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e2483d";
  const d = s * 0.27;
  const pips: Record<number, [number, number][]> = {
    3: [
      [-d, -d],
      [0, 0],
      [d, d],
    ],
    5: [
      [-d, -d],
      [d, -d],
      [0, 0],
      [-d, d],
      [d, d],
    ],
  };
  for (const [px, py] of pips[faces[0]] ?? []) {
    ctx.beginPath();
    ctx.arc(px, py, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The truck's attitude, for the gyro: its tilt, the ground's slope under it, and whether it's flying. */
export interface Attitude {
  /** Truck pitch in radians (positive = nose up). */
  pitch: number;
  /** Slope of the ground under the truck in radians (positive = uphill). */
  slope: number;
  airborne: boolean;
}

/**
 * Gyro / artificial horizon. The sky-and-ground disc tilts with the truck; the yellow line is the
 * ground under you, so when it lines up with the truck symbol you're flat on the ground (or set to land).
 */
export function drawGyro(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a: Attitude): void {
  const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
  const align = a.pitch - a.slope;
  // Status text and color
  let label: string;
  let color: string;
  if (a.airborne) {
    const off = Math.abs(deg(align));
    if (off <= 12) {
      label = "LAND OK";
      color = "#5cd65c";
    } else {
      label = align > 0 ? "NOSE UP" : "NOSE DOWN";
      color = off > 30 ? "#ff4a3a" : "#f5c400";
    }
  } else {
    const tilt = deg(a.pitch);
    if (Math.abs(tilt) <= 3) {
      label = "FLAT";
      color = "#5cd65c";
    } else {
      label = `${tilt > 0 ? "UPHILL" : "DOWNHILL"} ${Math.abs(tilt)}°`;
      color = Math.abs(deg(align)) > 15 ? "#f5c400" : "#9fd8ff";
    }
  }

  ctx.save();
  // Bezel
  ctx.fillStyle = "#0f1013";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  // Horizon disc: rotates with the truck's pitch
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a.pitch);
  ctx.fillStyle = "#3d8fd6";
  ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2);
  ctx.fillStyle = "#8a5a32";
  ctx.fillRect(-r * 2, 0, r * 4, r * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-r * 2, 0);
  ctx.lineTo(r * 2, 0);
  ctx.stroke();
  // Pitch ladder every 15°
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  for (const k of [-2, -1, 1, 2]) {
    const yy = (-k * r) / 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, yy);
    ctx.lineTo(r * 0.25, yy);
    ctx.stroke();
  }
  ctx.restore();
  // The ground under you (yellow): level with the truck symbol = flat on it
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(align);
  ctx.strokeStyle = "#ffd84a";
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, r * 0.42);
  ctx.lineTo(r * 0.95, r * 0.42);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // Fixed truck symbol in the middle
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, 0);
  ctx.lineTo(-r * 0.18, 0);
  ctx.moveTo(r * 0.18, 0);
  ctx.lineTo(r * 0.55, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Ring and label
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `bold ${Math.max(10, Math.round(r * 0.3))}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const tw = ctx.measureText(label).width + 12;
  ctx.fillStyle = "rgba(14,15,19,0.85)";
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, cy + r + 6, tw, Math.max(14, r * 0.42), 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(label, cx, cy + r + 8);
}

/**
 * Trip odometer: rolling number wheels, like a car's mechanical trip meter. The last wheel turns
 * smoothly, and each wheel rolls over when the one to its right passes 9.
 */
export function drawOdometer(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, meters: number): void {
  const digits = 5;
  const unitW = w * 0.2;
  const cellW = (w - unitW) / digits;
  ctx.save();
  // Bezel and label
  ctx.fillStyle = "#0d0e11";
  ctx.beginPath();
  ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `bold ${Math.max(8, h * 0.32)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("TRIP", x, y - 5);
  ctx.beginPath();
  ctx.roundRect(x, y, w - unitW, h, 3);
  ctx.clip();
  const v = Math.min(99999.99, meters);
  ctx.font = `700 ${h * 0.72}px "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < digits; i++) {
    const place = 10 ** (digits - 1 - i);
    const cx = x + cellW * (i + 0.5);
    // Wheel position: the last one turns continuously; others only during their neighbour's rollover
    const below = v % place;
    let pos = Math.floor(v / place) % 10;
    if (place === 1) pos = v % 10;
    else if (below > place - 1) pos += below - (place - 1);
    const frac = pos - Math.floor(pos);
    const d0 = Math.floor(pos) % 10;
    // Drum: dark with a curved shading, digits sliding up as it turns
    const drum = ctx.createLinearGradient(0, y, 0, y + h);
    drum.addColorStop(0, "#1a1b1f");
    drum.addColorStop(0.5, "#2c2e34");
    drum.addColorStop(1, "#1a1b1f");
    ctx.fillStyle = drum;
    ctx.fillRect(cx - cellW / 2 + 1, y, cellW - 2, h);
    ctx.fillStyle = "#f2f2ee";
    ctx.fillText(String(d0), cx, y + h / 2 - frac * h);
    ctx.fillText(String((d0 + 1) % 10), cx, y + h / 2 + (1 - frac) * h);
  }
  ctx.restore();
  // Glass sheen and unit
  ctx.save();
  const sheen = ctx.createLinearGradient(0, y, 0, y + h);
  sheen.addColorStop(0, "rgba(255,255,255,0.18)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w - unitW, h);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `bold ${h * 0.55}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("m", x + w - unitW / 2, y + h / 2);
  ctx.restore();
}
