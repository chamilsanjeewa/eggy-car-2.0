import { Car } from "./car";
import { Terrain } from "./terrain";

/** Screen-space layout of the cockpit, as fractions of the screen size. */
export const COCKPIT = {
  /** Where the driver's eye sits on screen (the camera focus). */
  eyeX: 0.22,
  eyeY: 0.45,
  /** Windshield opening. */
  winLeft: 0.3,
  winTop: 0.12,
  winRight: 0.97,
  winBottom: 0.68,
  /** Top edge of the dashboard. */
  dashTop: 0.66,
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
  private prev: { x: number; y: number } | null = null;

  reset(): void {
    this.bob = this.bobV = this.dice = this.diceV = this.wheel = 0;
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
  }
}

/** The rear-view mirror's glass, in CSS pixels. */
export function mirrorRect(w: number, h: number): Rect {
  const mw = Math.min(w * 0.2, 240);
  const mh = Math.min(h * 0.11, mw * 0.42);
  return { x: w * 0.62 - mw / 2, y: h * COCKPIT.winTop + 10, w: mw, h: mh };
}

function windshieldPath(w: number, h: number): Path2D {
  const L = w * COCKPIT.winLeft;
  const T = h * COCKPIT.winTop;
  const R = w * COCKPIT.winRight;
  const B = h * COCKPIT.winBottom;
  const r = Math.min(w, h) * 0.05;
  const p = new Path2D();
  p.moveTo(L + r, T);
  p.lineTo(R - w * 0.12, T);
  p.quadraticCurveTo(R - w * 0.09, T, R - w * 0.075, T + r);
  p.lineTo(R, B - h * 0.18); // slanted A-pillar
  p.lineTo(R, B);
  p.lineTo(L, B);
  p.lineTo(L, T + r);
  p.quadraticCurveTo(L, T, L + r, T);
  p.closePath();
  return p;
}

/** Cabin frame, door, glass glare: everything around the windshield. */
export function drawCabin(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const win = windshieldPath(w, h);

  // Glass tint and glare inside the windshield
  ctx.save();
  ctx.clip(win);
  ctx.fillStyle = "rgba(170, 210, 230, 0.08)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(w * 0.62, h * COCKPIT.winTop);
  ctx.lineTo(w * 0.7, h * COCKPIT.winTop);
  ctx.lineTo(w * 0.52, h * COCKPIT.winBottom);
  ctx.lineTo(w * 0.47, h * COCKPIT.winBottom);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Interior panels: whole screen minus the windshield
  const frame = new Path2D();
  frame.rect(-50, -50, w + 100, h + 100);
  frame.addPath(win);
  const g = ctx.createLinearGradient(0, 0, w * 0.4, 0);
  g.addColorStop(0, "#1c1e24");
  g.addColorStop(1, "#30333b");
  ctx.fillStyle = g;
  ctx.fill(frame, "evenodd");

  // Rubber seal around the glass
  ctx.strokeStyle = "#0e0f12";
  ctx.lineWidth = 6;
  ctx.stroke(win);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 2;
  ctx.stroke(win);

  // Roof: dome light and stitching
  ctx.fillStyle = "#3b3e46";
  ctx.fillRect(w * 0.36, h * 0.03, w * 0.08, h * 0.035);
  ctx.fillStyle = "rgba(255, 245, 200, 0.5)";
  ctx.fillRect(w * 0.37, h * 0.04, w * 0.06, h * 0.015);

  // Door panel on the left: side window, handle, headrest
  const L = w * COCKPIT.winLeft;
  ctx.fillStyle = "#262830";
  ctx.beginPath();
  ctx.roundRect(w * 0.02, h * 0.18, L - w * 0.06, h * 0.3, 12);
  ctx.fill();
  ctx.fillStyle = "rgba(140, 190, 220, 0.18)";
  ctx.beginPath();
  ctx.roundRect(w * 0.035, h * 0.2, L - w * 0.09, h * 0.18, 10);
  ctx.fill();
  ctx.fillStyle = "#4a4d57";
  ctx.beginPath();
  ctx.roundRect(L - w * 0.12, h * 0.52, w * 0.06, h * 0.025, 6);
  ctx.fill();
  ctx.fillStyle = "#3a2a22";
  ctx.beginPath();
  ctx.roundRect(-w * 0.02, h * 0.3, w * 0.07, h * 0.24, 18);
  ctx.fill();
}

export interface DashInfo {
  glue: number;
  /** 0..1 */
  fuel: number;
  rpm: number;
  gear: number;
  terrain: Terrain;
  carX: number;
  /** Time-trial ghost position, if racing one. */
  ghostX: number | null;
}

/** Dashboard: speedometer with fuel arc, and a navigation screen showing the road ahead. */
export function drawDashboard(ctx: CanvasRenderingContext2D, w: number, h: number, st: CockpitState, info: DashInfo): void {
  const top = h * COCKPIT.dashTop;
  const m = Math.min(w, h);

  // Dash body with a curved top
  const dg = ctx.createLinearGradient(0, top, 0, h);
  dg.addColorStop(0, "#3a3d46");
  dg.addColorStop(0.25, "#2a2c33");
  dg.addColorStop(1, "#1a1b20");
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.moveTo(-10, top + h * 0.03);
  ctx.quadraticCurveTo(w * 0.5, top - h * 0.03, w + 10, top + h * 0.02);
  ctx.lineTo(w + 10, h + 10);
  ctx.lineTo(-10, h + 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, top + h * 0.03);
  ctx.quadraticCurveTo(w * 0.5, top - h * 0.03, w + 10, top + h * 0.02);
  ctx.stroke();

  // Speedometer
  const cx = w * 0.56;
  const cy = top + (h - top) * 0.52;
  const r = Math.min(m * 0.11, (h - top) * 0.42);
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
  const maxKmh = 140;
  ctx.lineCap = "round";
  for (let k = 0; k <= 14; k++) {
    const a = a0 + (span * k) / 14;
    const major = k % 2 === 0;
    ctx.strokeStyle = k >= 12 ? "#ff5a4a" : "#d9dde6";
    ctx.lineWidth = major ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * (major ? 0.74 : 0.8), cy + Math.sin(a) * r * (major ? 0.74 : 0.8));
    ctx.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.stroke();
  }
  // Fuel arc along the bottom of the dial
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

  const kmh = Math.min(maxKmh, st.speedKmh);
  const na = a0 + (span * kmh) / maxKmh;
  ctx.strokeStyle = "#ff8a1f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(na) * r * 0.82, cy + Math.sin(na) * r * 0.82);
  ctx.stroke();
  ctx.fillStyle = "#ff8a1f";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(r * 0.32)}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(st.speedKmh)), cx, cy + r * 0.4);
  ctx.font = `${Math.round(r * 0.14)}px Trebuchet MS, sans-serif`;
  ctx.fillStyle = "#9aa0ad";
  ctx.fillText("km/h", cx, cy + r * 0.6);
  ctx.fillStyle = "#4fc3ff";
  ctx.font = `bold ${Math.round(r * 0.18)}px Trebuchet MS, sans-serif`;
  ctx.fillText(info.rpm > 0 ? `${info.gear + 1}  ·  ${(info.rpm / 1000).toFixed(1)}k` : "OFF", cx, cy - r * 0.38);

  drawNav(ctx, w * 0.665, top + (h - top) * 0.14, w * 0.3, h - 12 - (top + (h - top) * 0.14), info);
}

/** GPS-style screen: the road profile ahead with upcoming pickups and features. */
function drawNav(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, info: DashInfo): void {
  if (w < 80 || h < 50) return;
  const t = info.terrain;
  ctx.save();
  ctx.fillStyle = "#0b0d12";
  ctx.beginPath();
  ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, "#0f2333");
  bg.addColorStop(1, "#08141e");
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);

  // Header: status pills
  const head = Math.max(16, h * 0.16);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x, y, w, head);
  ctx.font = `bold ${Math.round(head * 0.62)}px Trebuchet MS, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#7fd3ff";
  ctx.fillText("NAV", x + 6, y + head / 2);
  if (info.glue > 0 && (info.glue > 3 || Math.floor(performance.now() / 200) % 2 === 0)) {
    ctx.fillStyle = "#3d8bff";
    ctx.beginPath();
    ctx.roundRect(x + w - 58, y + 3, 52, head - 6, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(`GLUE ${Math.ceil(info.glue)}`, x + w - 32, y + head / 2);
  }

  // Road profile: from 15 m behind to 220 m ahead
  const back = 15;
  const ahead = 220;
  const x0 = info.carX - back;
  const span = back + ahead;
  const top = y + head + 6;
  const bottom = y + h - 18;
  let lo = Infinity;
  let hi = -Infinity;
  for (let s = x0; s <= x0 + span; s += 4) {
    const v = t.height(s);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const range = Math.max(8, hi - lo);
  const px = (wx: number) => x + 6 + ((wx - x0) / span) * (w - 12);
  const py = (wy: number) => bottom - ((wy - lo) / range) * (bottom - top);

  // Grid
  ctx.strokeStyle = "rgba(127,211,255,0.08)";
  ctx.lineWidth = 1;
  for (let gx = Math.ceil(x0 / 50) * 50; gx < x0 + span; gx += 50) {
    ctx.beginPath();
    ctx.moveTo(px(gx), top);
    ctx.lineTo(px(gx), bottom);
    ctx.stroke();
  }
  // Road line
  ctx.strokeStyle = "#5fd0ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let s = x0; s <= x0 + span; s += 2) {
    if (s === x0) ctx.moveTo(px(s), py(t.height(s)));
    else ctx.lineTo(px(s), py(t.height(s)));
  }
  ctx.stroke();
  // Bridges over forks
  ctx.strokeStyle = "#d9824f";
  ctx.lineWidth = 2;
  for (const fork of t.forks) {
    if (fork.x > x0 + span || fork.x + 44 < x0) continue;
    ctx.beginPath();
    for (let d = 0; d <= 44; d += 2) {
      const s = fork.x + d;
      if (d === 0) ctx.moveTo(px(s), py(t.deckHeight(fork, d)));
      else ctx.lineTo(px(s), py(t.deckHeight(fork, d)));
    }
    ctx.stroke();
  }

  const dot = (wx: number, wy: number, color: string, size = 3.5) => {
    if (wx < x0 || wx > x0 + span) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px(wx), Math.max(top, Math.min(bottom, py(wy))), size, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const c of t.coins) if (!c.taken && c.value > 1) dot(c.x, c.y, "#ffd84a", 3);
  let nextFuel: number | null = null;
  for (const pu of t.powerUps) {
    if (pu.taken) continue;
    if (pu.kind === "fuel" && pu.x > info.carX && (nextFuel === null || pu.x < nextFuel)) nextFuel = pu.x;
    dot(pu.x, pu.y, pu.kind === "glue" ? "#3d8bff" : pu.kind === "fuel" ? "#ff5a4a" : "#ff6b8a", 4);
  }
  if (t.finishX !== null && t.finishX < x0 + span) {
    const fx = px(t.finishX);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = k % 2 ? "#111" : "#fff";
      ctx.fillRect(fx - 3 + (k % 2) * 3, top + Math.floor(k / 2) * 4, 3, 4);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(fx - 0.5, top, 1, bottom - top);
  }
  if (info.ghostX !== null) dot(info.ghostX, t.height(info.ghostX) + 1, "rgba(255,255,255,0.7)", 4);
  // The car
  const cxp = px(info.carX);
  const cyp = py(t.height(info.carX));
  ctx.fillStyle = "#ff8a1f";
  ctx.beginPath();
  ctx.moveTo(cxp + 7, cyp - 4);
  ctx.lineTo(cxp - 5, cyp - 9);
  ctx.lineTo(cxp - 5, cyp + 1);
  ctx.closePath();
  ctx.fill();

  // Footer: distances
  ctx.font = `bold ${Math.max(10, Math.round(h * 0.11))}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillStyle = "#cfe9ff";
  const parts: string[] = [];
  if (nextFuel !== null) parts.push(`⛽ ${Math.round(nextFuel - info.carX)} m`);
  if (t.finishX !== null) parts.push(`🏁 ${Math.max(0, Math.round(t.finishX - info.carX))} m`);
  ctx.fillText(parts.join("   "), x + 6, y + h - 8);
  ctx.restore();
}

/** Steering wheel with the driver's hands, seen from the driver's seat. */
export function drawSteeringWheel(ctx: CanvasRenderingContext2D, w: number, h: number, st: CockpitState): void {
  const m = Math.min(w, h);
  const cx = w * 0.3;
  const cy = h * 0.97;
  const r = m * 0.26;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(st.wheel);

  // Column and hub
  ctx.fillStyle = "#15161a";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1d1f24";
  ctx.lineWidth = r * 0.12;
  ctx.lineCap = "round";
  for (const a of [Math.PI, 0, -Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    ctx.stroke();
  }
  // Rim
  ctx.strokeStyle = "#101114";
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
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
    ctx.fillStyle = "#e2483d";
    ctx.beginPath();
    ctx.ellipse(hx, hy, r * 0.13, r * 0.17, a + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b8352c";
    ctx.beginPath();
    ctx.ellipse(hx + side * r * 0.02, hy + r * 0.12, r * 0.1, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    // Sleeve going down off screen
    ctx.strokeStyle = "#3b6fb6";
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(hx + side * r * 0.05, hy + r * 0.15);
    ctx.lineTo(hx + side * r * 0.35, hy + r * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Mirror housing (drawn after the mirror image) and the fuzzy dice hanging from it. */
export function drawMirrorFrame(ctx: CanvasRenderingContext2D, rect: Rect, st: CockpitState): void {
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

  // Fuzzy dice on a string
  const ax = x + w * 0.8;
  const ay = y + h;
  const len = Math.max(36, h * 0.9);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(-st.dice); // screen y is down; positive swing goes toward the windshield (right)
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, len);
  ctx.moveTo(0, 0);
  ctx.lineTo(7, len * 0.8);
  ctx.stroke();
  const size = Math.max(14, h * 0.32);
  die(ctx, -6, len, size, 0.25, [5]);
  die(ctx, 7, len * 0.8, size * 0.9, -0.3, [3]);
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
