import type { Scene } from "./render";
import { paintSky, drawDecor, drawGlueBottle, drawFuelCan, drawLifeHeart, mixColor, hash, paintDistanceSign } from "./render";
import { RAMP, FORK, BIG_COIN_VALUE } from "./terrain";
import { viewMap } from "./maps";

/**
 * First-person road view for the driver's seat.
 *
 * The world is a 2D height profile, so the road is drawn as a straight strip running away from the
 * camera. Each slice of road is projected with simple perspective (screen size ∝ 1/distance) and
 * slices are painted far-to-near, so a nearer hill crest naturally hides what's behind it. Objects
 * along the road are drawn in the same far-to-near pass so crests hide them too.
 */

/** Screen layout: the eye looks at (cx, horizon) when level; focal length is a fraction of height. */
const VIEW = { cx: 0.5, horizon: 0.4, focal: 0.95 };
const FAR = 240; // meters of road drawn ahead
const ROAD_HALF = 2.4;

interface Eye {
  x: number;
  y: number;
  /** Nose-up pitch of the view in radians. */
  pitch: number;
}

interface P {
  x: number;
  y: number;
  /** Pixels per meter at this depth. */
  s: number;
  z: number;
}

export function drawFirstPerson(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene, eye: Eye): void {
  const t = scene.terrain;
  const map = viewMap(t.map, eye.x + 30);
  const f = h * VIEW.focal;
  const cx = w * VIEW.cx;
  const cy = h * VIEW.horizon;
  const c = Math.cos(eye.pitch);
  const sn = Math.sin(eye.pitch);

  const project = (x: number, y: number, lat = 0): P | null => {
    const dz = x - eye.x;
    const dy = y - eye.y;
    const z = dz * c + dy * sn;
    if (z < 0.35) return null;
    const yy = -dz * sn + dy * c;
    const s = f / z;
    return { x: cx + lat * s, y: cy - yy * s, s, z };
  };

  // ---- sky and distant scenery, sitting on the horizon ----
  const horizonY = Math.max(-h, Math.min(2 * h, cy + f * Math.tan(eye.pitch)));
  ctx.fillStyle = map.sky[0];
  ctx.fillRect(0, 0, w, h);
  const farGround = mixColor(map.top[0], map.sky[2], 0.45);
  ctx.fillStyle = farGround;
  ctx.fillRect(0, horizonY, w, h - horizonY + 10);
  ctx.save();
  ctx.translate(0, horizonY - h * 0.7);
  paintSky(ctx, w, h, map, scene.time, eye.x * 0.6, 0);
  ctx.restore();

  // ---- road slices, far to near ----
  const dists: number[] = [];
  for (let d = 0.6; d <= FAR; d += d < 25 ? 0.5 : d < 70 ? 1 : 2.5) dists.push(d);

  // Index objects by position so each slice can draw the ones inside it.
  const objects = collectObjects(scene, eye.x, eye.x + FAR);
  let oi = objects.length - 1;

  // Ground bands are kept subtle (strong stripes look like an old arcade racer)
  const grassA = map.top[1];
  const grassB = mixColor(map.top[1], map.top[0], 0.18);
  const hillGrass = mixColor(map.top[0], map.top[1], 0.35);
  // Rolling hills on both sides of the road (flat in the city, where the skyline stands behind)
  const hillAmp = map.skyline ? 0 : map.shape.ampA * 2.6;
  const hill = (x: number, side: number) =>
    hillAmp * (1.25 + 1.0 * Math.sin(x * 0.043 + side * 1.7) + 0.55 * Math.sin(x * 0.11 - side * 0.9));
  const roadA = mixColor(map.ground, "#ffffff", 0.18);
  const roadB = mixColor(map.ground, "#ffffff", 0.1);
  const edge = mixColor(map.bands[1], "#000000", 0.2);

  for (let i = dists.length - 1; i >= 1; i--) {
    const xn = eye.x + dists[i - 1];
    const xf = eye.x + dists[i];
    const pn = project(xn, t.height(xn));
    const pf = project(xf, t.height(xf));
    if (pn && pf) {
      const fog = Math.min(1, dists[i] / FAR) ** 1.6 * 0.75;
      const stripe = Math.floor(xf / 4) % 2 === 0;
      // Light and shade: ground sloping up toward you catches more light, dips are darker
      const slope = (t.height(xf) - t.height(xn)) / Math.max(0.1, xf - xn);
      const shadeTo = slope > 0 ? "#fff6dc" : "#0c1408";
      const shadeK = Math.min(0.22, Math.abs(slope) * 0.6);
      const lit = (c: string) => mixColor(mixColor(c, shadeTo, shadeK), map.sky[2], fog);
      // Ground on both sides, out to the edges of the view
      quad(ctx, pn, pf, 400, lit(stripe ? grassA : grassB));
      // Hills rising on each side; drawn far to near, so nearer hills hide farther ones
      if (hillAmp > 0) {
        for (const side of [-1, 1]) {
          const hn = t.height(xn);
          const hf = t.height(xf);
          const on = project(xn, hn + hill(xn, side), side * 60);
          const of = project(xf, hf + hill(xf, side), side * 60);
          if (on && of) {
            const inner = side * (ROAD_HALF + 1.6);
            const hillSlope = (hill(xf, side) - hill(xn, side)) / Math.max(0.1, xf - xn);
            const hk = Math.min(0.25, Math.abs(hillSlope) * 0.9);
            ctx.fillStyle = mixColor(mixColor(hillGrass, hillSlope > 0 ? "#fff6dc" : "#0c1408", hk), map.sky[2], fog * 1.1);
            ctx.beginPath();
            ctx.moveTo(pn.x + inner * pn.s, pn.y + 0.5);
            ctx.lineTo(on.x, on.y + 0.5);
            ctx.lineTo(of.x, of.y);
            ctx.lineTo(pf.x + inner * pf.s, pf.y);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      // Shoulder, road surface, and a dashed center line
      quad(ctx, pn, pf, ROAD_HALF + 0.35, mixColor(edge, map.sky[2], fog));
      const onRamp = t.features.some((ft) => ft.kind === "ramp" && xf > ft.x - RAMP.length && xf <= ft.x);
      // Steel ramp deck: diamond-plate grey with tread bands
      const tread = Math.floor(xf * 3) % 2 === 0;
      // Conveyor belt: dark rubber with cross-ribs that run forward
      const rib = map.conveyor ? Math.floor((xf - scene.time * map.conveyor) / 0.4) % 2 === 0 : false;
      const surface = onRamp ? (tread ? "#a3aab3" : "#8b929b") : map.conveyor ? (rib ? "#4a4c52" : "#2a2b2f") : stripe ? roadA : roadB;
      quad(ctx, pn, pf, ROAD_HALF, lit(surface));
      if (!onRamp) {
        // Two darker worn tyre tracks instead of a painted center line
        const rut = lit(mixColor(surface, "#000000", 0.16));
        quadAt(ctx, pn, pf, -0.95, 0.32, rut);
        quadAt(ctx, pn, pf, 0.95, 0.32, rut);
      }
      // Ramp lip warning stripes
      for (const ft of t.features) {
        if (ft.kind === "ramp" && xf > ft.x - 0.6 && xn <= ft.x) quad(ctx, pn, pf, ROAD_HALF, Math.floor(xf * 4) % 2 ? "#1c1c1f" : "#f5c400");
      }
    }
    // Canyon bridge deck at this slice (drawn over the valley road)
    drawBridgeSlice(ctx, scene, xn, xf, project);
    // Objects inside this slice
    while (oi >= 0 && objects[oi].x > xn) {
      if (objects[oi].x <= xf) objects[oi].draw(ctx, project);
      oi--;
    }
  }
}

/** Fills the strip between two projected road points, `half` meters each side of center. */
function quad(ctx: CanvasRenderingContext2D, a: P, b: P, half: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x - half * a.s, a.y + 0.5);
  ctx.lineTo(a.x + half * a.s, a.y + 0.5);
  ctx.lineTo(b.x + half * b.s, b.y);
  ctx.lineTo(b.x - half * b.s, b.y);
  ctx.closePath();
  ctx.fill();
}

/** Like `quad`, but a strip `half` meters wide centered `lat` meters off the road's center. */
function quadAt(ctx: CanvasRenderingContext2D, a: P, b: P, lat: number, half: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x + (lat - half) * a.s, a.y + 0.5);
  ctx.lineTo(a.x + (lat + half) * a.s, a.y + 0.5);
  ctx.lineTo(b.x + (lat + half) * b.s, b.y);
  ctx.lineTo(b.x + (lat - half) * b.s, b.y);
  ctx.closePath();
  ctx.fill();
}

type Project = (x: number, y: number, lat?: number) => P | null;

function drawBridgeSlice(ctx: CanvasRenderingContext2D, scene: Scene, xn: number, xf: number, project: Project): void {
  const t = scene.terrain;
  for (const fork of t.forks) {
    const dn = xn - fork.x;
    const df = xf - fork.x;
    if (df <= 0 || dn >= FORK.length) continue;
    if (dn >= FORK.gapStart && df <= FORK.gapEnd) continue; // the gap
    const a = project(xn, t.deckHeight(fork, Math.max(0, dn)));
    const b = project(xf, t.deckHeight(fork, Math.min(FORK.length, df)));
    if (!a || !b) continue;
    quad(ctx, a, b, ROAD_HALF + 0.2, "#6b4423");
    quad(ctx, a, b, ROAD_HALF, Math.floor(xf * 2) % 2 ? "#b07a44" : "#9a6638");
    // Rope railing posts
    if (Math.floor(xf / 2.5) !== Math.floor(xn / 2.5)) {
      ctx.strokeStyle = "#5e3b1d";
      ctx.lineWidth = Math.max(1, 0.1 * b.s);
      for (const side of [-1, 1]) {
        const x = b.x + side * (ROAD_HALF + 0.1) * b.s;
        ctx.beginPath();
        ctx.moveTo(x, b.y);
        ctx.lineTo(x, b.y - 0.95 * b.s);
        ctx.stroke();
      }
    }
  }
}

interface Obj {
  x: number;
  draw: (ctx: CanvasRenderingContext2D, project: Project) => void;
}

/** Things along the road, sorted by x, each knowing how to draw itself as a billboard. */
function collectObjects(scene: Scene, from: number, to: number): Obj[] {
  const t = scene.terrain;
  const map = viewMap(t.map, from + 30);
  const objs: Obj[] = [];
  const inRange = (x: number) => x > from + 0.5 && x < to;

  /** Runs `fn` in a world-like frame (meters, y up) anchored at a projected point. */
  const sprite = (p: P, fn: (c: CanvasRenderingContext2D) => void) => (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(p.s, -p.s);
    fn(ctx);
    ctx.restore();
  };

  // Roadside trees/decor, both sides
  const i0 = t.vertexIndex(from);
  const i1 = t.vertexIndex(to);
  for (let i = i0 - (i0 % 7); i <= i1; i += 7) {
    const x = t.vertexX(i);
    if (!inRange(x) || hash(i * 3 + 1) < 0.3 || t.nearFeature(x, -6)) continue;
    for (const side of [-1, 1]) {
      const r = hash(i * 7 + side * 13);
      if (r < 0.35) continue;
      const lat = side * (ROAD_HALF + 2.2 + r * 9);
      const size = 1.2 + hash(i + side) * 0.9;
      objs.push({
        x,
        draw: (ctx, project) => {
          const p = project(x, t.height(x) - 0.1, lat);
          if (p) sprite(p, (c) => drawDecor(c, map, 0, 0, size))(ctx);
        },
      });
    }
  }

  // Reflector posts every 10 m and distance boards every 50 m
  for (let x = Math.ceil(from / 10) * 10; x < to; x += 10) {
    if (!inRange(x)) continue;
    objs.push({
      x,
      draw: (ctx, project) => {
        for (const side of [-1, 1]) {
          const p = project(x, t.height(x), side * (ROAD_HALF + 0.9));
          if (!p) continue;
          ctx.fillStyle = "#f2f2f2";
          ctx.fillRect(p.x - 0.05 * p.s, p.y - 1 * p.s, 0.1 * p.s, 1 * p.s);
          ctx.fillStyle = side < 0 ? "#ff8a1f" : "#e2483d";
          ctx.fillRect(p.x - 0.05 * p.s, p.y - 1 * p.s, 0.1 * p.s, 0.18 * p.s);
        }
        if (x % 50 === 0 && x > 0) {
          // A road sign on two posts (same artwork as the 3D view), cached as an image per distance
          const p = project(x, t.height(x), ROAD_HALF + 2.4);
          if (!p || p.s < 2) return;
          const milestone = x % 250 === 0;
          const sw = (milestone ? 2.2 : 1.5) * p.s;
          const sh = (milestone ? 1.0 : 0.72) * p.s;
          const top = (milestone ? 2.6 : 2.15) * p.s;
          ctx.fillStyle = "#9aa0a8";
          for (const px of [-0.32, 0.32]) ctx.fillRect(p.x + px * sw - 0.04 * p.s, p.y - top + sh * 0.5, 0.08 * p.s, top - sh * 0.5);
          if (sw > 6) ctx.drawImage(signImage(x), p.x - sw / 2, p.y - top, sw, sh);
        }
      },
    });
  }

  // Warning signs before ramps and forks
  for (const ft of t.features) {
    const x = ft.kind === "ramp" ? ft.x - RAMP.length - 5 : ft.x - 9;
    if (!inRange(x)) continue;
    objs.push({
      x,
      draw: (ctx, project) => {
        const p = project(x, t.height(x), ROAD_HALF + 1.4);
        if (!p) return;
        ctx.fillStyle = "#5a3d22";
        ctx.fillRect(p.x - 0.05 * p.s, p.y - 1.5 * p.s, 0.1 * p.s, 1.5 * p.s);
        ctx.save();
        ctx.translate(p.x, p.y - 1.9 * p.s);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#f5c400";
        ctx.strokeStyle = "#2b1d12";
        ctx.lineWidth = Math.max(1, 0.06 * p.s);
        ctx.fillRect(-0.38 * p.s, -0.38 * p.s, 0.76 * p.s, 0.76 * p.s);
        ctx.strokeRect(-0.38 * p.s, -0.38 * p.s, 0.76 * p.s, 0.76 * p.s);
        ctx.restore();
        ctx.fillStyle = "#2b1d12";
        ctx.font = `bold ${Math.max(6, 0.4 * p.s)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ft.kind === "ramp" ? "⤴" : "⑂", p.x, p.y - 1.9 * p.s);
      },
    });
  }

  // Coins
  for (const coin of t.coins) {
    if (coin.taken || !inRange(coin.x)) continue;
    const big = coin.value >= BIG_COIN_VALUE;
    objs.push({
      x: coin.x,
      draw: (ctx, project) => {
        const p = project(coin.x, coin.y);
        if (!p) return;
        const r = (big ? 0.6 : 0.32) * p.s;
        const spin = Math.max(0.15, Math.abs(Math.cos(scene.time * 3 + coin.x)));
        if (big) {
          const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 2);
          glow.addColorStop(0, "rgba(255,220,90,0.5)");
          glow.addColorStop(1, "rgba(255,220,90,0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#c79100";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * spin, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd84a";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 0.78 * spin, r * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }

  // Pickups (glue, fuel, hearts)
  for (const pu of t.powerUps) {
    if (pu.taken || !inRange(pu.x)) continue;
    objs.push({
      x: pu.x,
      draw: (ctx, project) => {
        const bob = pu.kind === "fuel" ? 0 : Math.sin(scene.time * 3 + pu.x) * 0.12;
        const p = project(pu.x, pu.y + bob);
        if (!p) return;
        const hc = pu.kind === "glue" ? "120,180,255" : pu.kind === "life" ? "255,120,150" : "255,220,120";
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 0.9 * p.s);
        halo.addColorStop(0, `rgba(${hc},0.5)`);
        halo.addColorStop(1, `rgba(${hc},0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.9 * p.s, 0, Math.PI * 2);
        ctx.fill();
        sprite(p, (c) => {
          if (pu.kind === "glue") drawGlueBottle(c, scene.time);
          else if (pu.kind === "fuel") drawFuelCan(c);
          else drawLifeHeart(c, scene.time);
        })(ctx);
      },
    });
  }

  // Finish banner
  if (t.finishX !== null && inRange(t.finishX)) {
    const x = t.finishX;
    objs.push({
      x,
      draw: (ctx, project) => {
        const g = t.height(x);
        const l = project(x, g, -3);
        const r = project(x, g, 3);
        if (!l || !r) return;
        ctx.fillStyle = "#d8d8d8";
        for (const p of [l, r]) ctx.fillRect(p.x - 0.07 * p.s, p.y - 4.2 * p.s, 0.14 * p.s, 4.2 * p.s);
        const cols = 16;
        const cw = (r.x - l.x) / cols;
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < cols; col++) {
            ctx.fillStyle = (row + col) % 2 ? "#111" : "#f4f4f4";
            ctx.fillRect(l.x + col * cw, l.y - (4.2 - row * 0.25) * l.s, cw + 0.5, 0.25 * l.s + 0.5);
          }
        }
      },
    });
  }

  // Your time-trial ghost, as a see-through car from behind
  const gp = scene.ghost?.pose;
  if (gp && inRange(gp.x)) {
    const def = scene.ghost!.def;
    const color = bodyColor(def.parts);
    objs.push({
      x: gp.x,
      draw: (ctx, project) => {
        const p = project(gp.x, t.height(gp.x));
        if (!p) return;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = "#111";
        for (const side of [-1, 1]) ctx.fillRect(p.x + side * 0.8 * p.s - 0.2 * p.s, p.y - 0.7 * p.s, 0.4 * p.s, 0.7 * p.s);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(p.x - 1.0 * p.s, p.y - 1.5 * p.s, 2.0 * p.s, 0.9 * p.s, 0.15 * p.s);
        ctx.fill();
        ctx.fillStyle = "#bfe8f7";
        ctx.fillRect(p.x - 0.7 * p.s, p.y - 1.45 * p.s, 1.4 * p.s, 0.35 * p.s);
        ctx.fillStyle = "#ff5a2a";
        for (const side of [-1, 1]) ctx.fillRect(p.x + side * 0.85 * p.s - 0.1 * p.s, p.y - 0.95 * p.s, 0.2 * p.s, 0.12 * p.s);
        ctx.restore();
      },
    });
  }

  return objs.sort((a, b) => a.x - b.x);
}

/** The main body color of a vehicle: its largest solid, non-glass part. */
export function bodyColor(parts: { pts: { x: number; y: number }[]; fill: string; solid?: boolean }[]): string {
  let best = parts[0]?.fill ?? "#e2483d";
  let bestArea = -1;
  for (const part of parts) {
    if (part.solid === false || part.fill === "#bfe8f7") continue;
    const xs = part.pts.map((q) => q.x);
    const ys = part.pts.map((q) => q.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) {
      bestArea = area;
      best = part.fill;
    }
  }
  return best;
}

/** Headlight beams at night: two soft pools of light on the road ahead (drawn over the dark tint). */
export function drawHeadlightPool(ctx: CanvasRenderingContext2D, w: number, h: number, night: number): void {
  if (night < 0.25) return;
  const k = Math.min(1, (night - 0.25) / 0.5);
  const cy = h * (VIEW.horizon + 0.17);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const dx of [-0.07, 0.07]) {
    const x = w * (VIEW.cx + dx);
    const g = ctx.createRadialGradient(x, cy, 0, x, cy, w * 0.26);
    g.addColorStop(0, `rgba(255, 238, 200, ${0.3 * k})`);
    g.addColorStop(0.45, `rgba(255, 230, 190, ${0.12 * k})`);
    g.addColorStop(1, "rgba(255, 230, 190, 0)");
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(1, 0.38);
    ctx.translate(-x, -cy);
    ctx.fillRect(x - w * 0.3, cy - w * 0.3, w * 0.6, w * 0.6);
    ctx.restore();
  }
  ctx.restore();
}

const signCache = new Map<number, HTMLCanvasElement>();
/** The distance sign artwork for `meters`, painted once and reused. */
function signImage(meters: number): HTMLCanvasElement {
  let c = signCache.get(meters);
  if (!c) {
    const milestone = meters % 250 === 0;
    c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.round(256 * (milestone ? 1.0 / 2.2 : 0.72 / 1.5));
    paintDistanceSign(c.getContext("2d")!, c.width, c.height, meters);
    if (signCache.size > 60) signCache.clear();
    signCache.set(meters, c);
  }
  return c;
}
