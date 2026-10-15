import { Vec2, Body } from "planck";
import { Car, eggOutline, rideHeight, EGG_RX, EGG_RY_TOP } from "./car";
import { VehicleDef, WheelDef } from "./vehicles";
import { MapDef } from "./maps";
import { CockpitState, DashInfo, drawCabin, drawDashboard, drawSteeringWheel, drawMirrorFrame, mirrorRect, Rect } from "./cockpit";
import { Terrain, RAMP, FORK, Fork, BIG_COIN_VALUE } from "./terrain";

export interface Camera {
  x: number;
  y: number;
  /** CSS pixels per meter. */
  scale: number;
  /** View rotation in radians (driver view tilts with the car). */
  angle: number;
  /** Where the camera point appears on screen, as fractions of width/height (0.5 = center). */
  focusX: number;
  focusY: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
}

/** Soft puffs of dust kicked up by the wheels. */
export interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
}

export interface Splat {
  x: number;
  y: number;
  angle: number;
  t: number; // seconds since impact
}

export interface GhostPose {
  x: number;
  y: number;
  a: number;
}

export interface Gauges {
  kmh: number;
  rpm: number;
  gear: number;
  /** 0..1 */
  fuel: number;
}

export interface Scene {
  terrain: Terrain;
  car: Car;
  camera: Camera;
  time: number;
  eggBroken: boolean;
  splat: Splat | null;
  particles: Particle[];
  dust: Dust[];
  /** Seconds of glue left (0 = not glued). */
  glue: number;
  /** Seconds of post-rescue invulnerability left. */
  shield: number;
  /** Armor charges left this run (draws plating on the egg). */
  armor: number;
  /** Set when the camera is inside the car (driver view). */
  cockpit: CockpitState | null;
  /** Time-trial ghost of your best run. */
  ghost: { def: VehicleDef; pose: GhostPose | null } | null;
  /** Seconds since the egg smashed (full-screen splatter), or null. */
  smash: number | null;
  /** Screen shake in pixels. */
  shake: number;
  gauges: Gauges;
  dash: Omit<DashInfo, "terrain" | "carX">;
}

const EGG_SHAPE = eggOutline(48);
const GLASS = "#bfe8f7";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  /** Pixels per meter that fits a sensible view on any screen shape. */
  baseScale(): number {
    return Math.min(this.height / 13, this.width / 16);
  }

  draw(scene: Scene): void {
    const { ctx } = this;
    const cam = scene.camera;
    const w = this.width;
    const h = this.height;
    const shakeX = (Math.random() - 0.5) * scene.shake + (scene.cockpit?.shakeX ?? 0);
    const shakeY = (Math.random() - 0.5) * scene.shake + (scene.cockpit?.shakeY ?? 0);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (cam.angle === 0) {
      paintSky(ctx, w, h, scene.terrain.map, scene.time, cam.x * cam.scale, cam.y * cam.scale);
    } else {
      // Rotated view: draw the sky oversized so the corners stay covered.
      const pad = Math.hypot(w, h) / 2 - Math.min(w, h) / 2 + 2;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(cam.angle);
      ctx.translate(-w / 2 - pad, -h / 2 - pad);
      paintSky(ctx, w + pad * 2, h + pad * 2, scene.terrain.map, scene.time, cam.x * cam.scale, cam.y * cam.scale);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // World transform: meters, y up, rotated about the camera's focus point.
    const s = cam.scale;
    ctx.translate(w * cam.focusX + shakeX, h * cam.focusY + shakeY);
    ctx.scale(s, -s);
    ctx.rotate(-cam.angle);
    ctx.translate(-cam.x, -cam.y);

    // When rotated or off-center, anything within a screen diagonal of the camera may be visible.
    const centered = cam.angle === 0 && cam.focusX === 0.5 && cam.focusY === 0.5;
    const halfW = (centered ? w / 2 : Math.hypot(w, h)) / s;
    const halfH = (centered ? h / 2 : Math.hypot(w, h)) / s;
    this.drawWorld(scene, cam.x - halfW - 1, cam.x + halfW + 1, cam.y - halfH - 2, true);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (scene.cockpit) {
      this.drawCockpit(scene, scene.cockpit);
    } else {
      this.vignette();
      drawGauges(ctx, w, h, scene.gauges);
    }
    if (scene.smash !== null) drawSmash(ctx, w, h, scene.smash);
  }

  private vignette(): void {
    const { ctx, width: w, height: h } = this;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** Inside-the-car overlay: cabin, live rear-view mirror showing the egg, dashboard and wheel. */
  private drawCockpit(scene: Scene, st: CockpitState): void {
    const { ctx, width: w, height: h } = this;
    drawCabin(ctx, w, h);
    const mirror = mirrorRect(w, h);
    this.drawMirror(scene, mirror);
    drawMirrorFrame(ctx, mirror, st);
    drawDashboard(ctx, w, h, st, { ...scene.dash, terrain: scene.terrain, carX: scene.car.chassis.getPosition().x });
    drawSteeringWheel(ctx, w, h, st);
  }

  /** Renders the truck bed and egg, flipped like a real mirror, into the mirror's glass. */
  private drawMirror(scene: Scene, r: Rect): void {
    const { ctx } = this;
    const chassis = scene.car.chassis;
    const map = scene.terrain.map;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 8);
    ctx.clip();
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, map.sky[0]);
    g.addColorStop(1, map.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Look back at the bed: a point behind the cab, slightly above the bed floor.
    const focus = chassis.getWorldPoint({ x: -0.55, y: 0.6 });
    const s = r.h / 2.2;
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.scale(-s, -s); // mirror image: left/right flipped, y up
    ctx.rotate(-chassis.getAngle());
    ctx.translate(-focus.x, -focus.y);
    const reach = Math.hypot(r.w, r.h) / s;
    this.drawWorld(scene, focus.x - reach - 1, focus.x + reach + 1, focus.y - reach - 2, false);
    ctx.restore();

    // Slight glass sheen
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(r.x, r.y, r.w, r.h * 0.4);
  }

  /** Everything in world space, culled to [left, right] and down to `bottom`. Assumes the world transform is set. */
  private drawWorld(scene: Scene, left: number, right: number, bottom: number, full: boolean): void {
    const t = scene.terrain;
    this.drawBridgeSupports(t, left, right);
    this.drawTerrain(t, left, right, bottom, full);
    this.drawBridges(t, left, right);
    this.drawRamps(t, left, right);
    if (full) this.drawMarkers(t, left, right);
    this.drawFinish(t, left, right);
    this.drawCoins(scene, left, right);
    this.drawPowerUps(scene, left, right);
    if (scene.ghost?.pose) this.drawGhost(scene.ghost.def, scene.ghost.pose);
    this.drawDust(scene.dust);
    this.drawShadow(scene);
    this.drawCar(scene.car);
    if (scene.splat) this.drawSplat(scene.splat);
    else if (!scene.eggBroken) {
      this.withBody(scene.car.egg, () => drawEggShape(this.ctx, scene.armor));
      if (scene.glue > 0) this.drawGlueOnEgg(scene);
      if (scene.shield > 0) this.drawShield(scene);
    }
    this.drawParticles(scene.particles);
  }

  // ---------- world ----------

  private drawTerrain(terrain: Terrain, left: number, right: number, bottom: number, full: boolean): void {
    const { ctx } = this;
    const map = terrain.map;
    const i0 = terrain.vertexIndex(left);
    const i1 = terrain.vertexIndex(right) + 1;

    const surface = new Path2D();
    surface.moveTo(terrain.vertexX(i0), terrain.vertexHeight(i0));
    for (let i = i0 + 1; i <= i1; i++) surface.lineTo(terrain.vertexX(i), terrain.vertexHeight(i));

    const fill = new Path2D(surface);
    fill.lineTo(terrain.vertexX(i1), bottom);
    fill.lineTo(terrain.vertexX(i0), bottom);
    fill.closePath();

    ctx.fillStyle = map.ground;
    ctx.fill(fill);

    ctx.save();
    ctx.clip(fill);
    // Strata bands that follow the surface
    ctx.translate(0, -1.2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = map.bands[0];
    ctx.stroke(surface);
    ctx.translate(0, -1.8);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = map.bands[1];
    ctx.stroke(surface);
    ctx.translate(0, 3);
    // Ambient occlusion: darker just under the top layer, fading deeper down
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.translate(0, -0.45);
    ctx.stroke(surface);
    ctx.translate(0, 0.45);
    if (full) {
      // Fine grain texture
      for (let i = i0; i <= i1; i++) {
        const f = hash(i * 7.3);
        const g = hash(i * 3.1 + 2);
        const x = terrain.vertexX(i) + f * SEG_DRAW;
        const y = terrain.vertexHeight(i) - 0.35 - g * 3.2;
        ctx.fillStyle = f > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.1)";
        ctx.fillRect(x, y, 0.05 + g * 0.05, 0.05);
      }
    }
    ctx.restore();

    // Pebbles with a lit top edge
    for (let i = i0 - (i0 % 3); i <= i1; i += 3) {
      const f = hash(i);
      const x = terrain.vertexX(i) + f;
      const y = terrain.vertexHeight(i) - 0.7 - f * 2.5;
      const rx = 0.12 + f * 0.1;
      const ry = 0.08 + f * 0.05;
      ctx.fillStyle = map.pebble;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.2, y + ry * 0.35, rx * 0.6, ry * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Decorations standing on the surface (deterministic per vertex)
    for (let i = i0 - (i0 % 7) - 14; i <= i1 + 14; i += 7) {
      const f = hash(i * 3 + 1);
      if (f < 0.45 || terrain.vertexX(i) < 4) continue;
      const x = terrain.vertexX(i);
      if (terrain.nearFeature(x, -6)) continue; // keep ramps and bridges clear
      const y = terrain.height(x);
      // Keep decor off steep slopes so it doesn't float
      const slope = Math.abs(terrain.height(x + 0.6) - terrain.height(x - 0.6)) / 1.2;
      if (slope > 0.5) continue;
      drawDecor(ctx, map, x, y - 0.1, 0.8 + f * 0.6);
    }

    // Top surface
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (map.glow) {
      ctx.strokeStyle = map.glow;
      ctx.lineWidth = 0.9;
      ctx.stroke(surface);
    }
    ctx.lineWidth = 0.42;
    ctx.strokeStyle = map.top[0];
    ctx.save();
    ctx.translate(0, -0.06);
    ctx.stroke(surface);
    ctx.restore();
    ctx.lineWidth = 0.26;
    ctx.strokeStyle = map.top[1];
    ctx.stroke(surface);

    // Grass blades on grassy maps
    if (full && GRASSY.has(map.id)) {
      ctx.lineWidth = 0.035;
      for (let i = i0; i <= i1; i++) {
        const x0 = terrain.vertexX(i);
        const y0 = terrain.vertexHeight(i);
        for (let k = 0; k < 3; k++) {
          const f = hash(i * 5 + k);
          const x = x0 + (k / 3) * 0.5;
          const hgt = 0.12 + f * 0.16;
          ctx.strokeStyle = f > 0.5 ? map.top[1] : map.top[0];
          ctx.beginPath();
          ctx.moveTo(x, y0 + 0.08);
          ctx.lineTo(x + (f - 0.5) * 0.12, y0 + 0.08 + hgt);
          ctx.stroke();
        }
      }
    }
  }

  /** Wooden deck over each jump ramp, plus a warning sign before it. */
  private drawRamps(terrain: Terrain, left: number, right: number): void {
    const { ctx } = this;
    for (const f of terrain.features) {
      if (f.kind !== "ramp") continue;
      const lip = f.x;
      const start = lip - RAMP.length;
      const signX = lip - RAMP.length - 5;
      if (lip + 1 < left || signX - 1 > right) continue;
      const base = terrain.height(start - 1);

      ctx.fillStyle = "#5e3b1d";
      for (let x = start + 2; x <= lip; x += 2.4) {
        const top = terrain.height(x);
        ctx.fillRect(x - 0.08, base - 0.2, 0.16, top - base + 0.2);
      }
      const deck = new Path2D();
      deck.moveTo(start, terrain.height(start));
      for (let x = start + 0.25; x <= lip + 0.001; x += 0.25) deck.lineTo(x, terrain.height(x) + 0.02);
      ctx.lineCap = "butt";
      ctx.lineWidth = 0.3;
      ctx.strokeStyle = "#7a4e26";
      ctx.stroke(deck);
      ctx.lineWidth = 0.18;
      ctx.strokeStyle = "#c08a4e";
      ctx.stroke(deck);
      ctx.strokeStyle = "#5e3b1d";
      ctx.lineWidth = 0.04;
      for (let x = start + 0.6; x < lip; x += 0.6) {
        const y = terrain.height(x);
        ctx.beginPath();
        ctx.moveTo(x, y - 0.13);
        ctx.lineTo(x, y + 0.15);
        ctx.stroke();
      }
      ctx.fillStyle = "#e2483d";
      ctx.fillRect(lip - 0.12, terrain.height(lip) - 0.6, 0.24, 0.6);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(lip - 0.12, terrain.height(lip) - 0.4, 0.24, 0.15);

      drawSign(ctx, signX, terrain.height(signX), (c) => {
        c.strokeStyle = "#2b1d12";
        c.lineWidth = 0.07;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(-0.28, -0.18);
        c.quadraticCurveTo(0, 0.4, 0.26, -0.05);
        c.stroke();
        c.beginPath();
        c.moveTo(0.26, -0.05);
        c.lineTo(0.08, 0.0);
        c.moveTo(0.26, -0.05);
        c.lineTo(0.27, 0.13);
        c.stroke();
      });
    }
  }

  private drawBridgeSupports(terrain: Terrain, left: number, right: number): void {
    const { ctx } = this;
    for (const fork of terrain.forks) {
      if (fork.x > right || fork.x + FORK.length < left) continue;
      // Stone pillars behind the road, from the deck down into the valley
      for (const d of [FORK.slope + 1, FORK.gapStart - 1.5, FORK.gapEnd + 1.5, FORK.length - FORK.slope - 1]) {
        const x = fork.x + d;
        const top = terrain.deckHeight(fork, d);
        const floor = terrain.height(x) - 1;
        const g = ctx.createLinearGradient(x - 0.3, 0, x + 0.3, 0);
        g.addColorStop(0, "#6b5a4a");
        g.addColorStop(0.5, "#9a8670");
        g.addColorStop(1, "#5a4a3c");
        ctx.fillStyle = g;
        ctx.fillRect(x - 0.3, floor, 0.6, top - floor);
      }
    }
  }

  private drawBridges(terrain: Terrain, left: number, right: number): void {
    const { ctx } = this;
    for (const fork of terrain.forks) {
      const signX = fork.x - 9;
      if (fork.x + FORK.length < left || signX - 1 > right) continue;
      const faded = fork.choice === "valley";
      ctx.save();
      if (faded) ctx.globalAlpha = 0.75;
      for (const [a, b] of [
        [0, FORK.gapStart],
        [FORK.gapEnd, FORK.length],
      ]) {
        const deck = new Path2D();
        deck.moveTo(fork.x + a, terrain.deckHeight(fork, a));
        for (let d = a + 0.25; d <= b + 1e-6; d += 0.25) deck.lineTo(fork.x + d, terrain.deckHeight(fork, d));
        // Deck beam
        ctx.lineCap = "butt";
        ctx.lineWidth = 0.4;
        ctx.strokeStyle = "#5e3b1d";
        ctx.save();
        ctx.translate(0, -0.15);
        ctx.stroke(deck);
        ctx.restore();
        ctx.lineWidth = 0.18;
        ctx.strokeStyle = "#b07a44";
        ctx.stroke(deck);
        // Planks
        ctx.strokeStyle = "#5e3b1d";
        ctx.lineWidth = 0.035;
        for (let d = a + 0.5; d < b; d += 0.5) {
          const y = terrain.deckHeight(fork, d);
          ctx.beginPath();
          ctx.moveTo(fork.x + d, y - 0.3);
          ctx.lineTo(fork.x + d, y + 0.09);
          ctx.stroke();
        }
        // Rope railing
        ctx.strokeStyle = "#8a6a44";
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        for (let d = a; d <= b + 1e-6; d += 0.5) {
          const sag = Math.sin(((d - a) / 2.5) * Math.PI) * 0.12;
          const y = terrain.deckHeight(fork, d) + 0.9 - Math.abs(sag);
          if (d === a) ctx.moveTo(fork.x + d, y);
          else ctx.lineTo(fork.x + d, y);
        }
        ctx.stroke();
        ctx.fillStyle = "#5e3b1d";
        for (let d = a; d <= b + 1e-6; d += 2.5) ctx.fillRect(fork.x + d - 0.04, terrain.deckHeight(fork, d), 0.08, 0.95);
      }
      // Broken plank ends at the gap
      ctx.fillStyle = "#b07a44";
      const gy = terrain.deckHeight(fork, FORK.gapStart);
      ctx.beginPath();
      ctx.moveTo(fork.x + FORK.gapStart, gy + 0.08);
      ctx.lineTo(fork.x + FORK.gapStart + 0.35, gy - 0.05);
      ctx.lineTo(fork.x + FORK.gapStart, gy - 0.12);
      ctx.fill();
      ctx.restore();

      // Fork sign: up (glue, hold gas) / down (safe road)
      drawSign(ctx, signX, terrain.height(signX), (c) => {
        c.strokeStyle = "#2b1d12";
        c.lineWidth = 0.07;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(-0.25, 0);
        c.lineTo(0.05, 0);
        c.lineTo(0.25, 0.22);
        c.moveTo(0.05, 0);
        c.lineTo(0.25, -0.22);
        c.stroke();
        c.fillStyle = "#2f7ae5";
        c.beginPath();
        c.arc(0.27, 0.25, 0.06, 0, Math.PI * 2);
        c.fill();
      });
    }
  }

  private drawMarkers(terrain: Terrain, left: number, right: number): void {
    const { ctx } = this;
    const step = 50;
    for (let m = Math.max(step, Math.ceil(left / step) * step); m <= right; m += step) {
      if (terrain.finishX !== null && Math.abs(m - terrain.finishX) < 3) continue;
      const y = terrain.height(m);
      ctx.fillStyle = "#5a3d22";
      ctx.fillRect(m - 0.05, y, 0.1, 1.6);
      ctx.fillStyle = "#fffaf0";
      ctx.strokeStyle = "#5a3d22";
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.rect(m - 0.55, y + 1.3, 1.1, 0.55);
      ctx.fill();
      ctx.stroke();
      worldText(ctx, `${m}m`, m, y + 1.575, 0.36, "#5a3d22");
    }
  }

  /** Checkered start and finish banners for time trials. */
  private drawFinish(terrain: Terrain, left: number, right: number): void {
    if (terrain.finishX === null) return;
    for (const [x, label] of [
      [0, "START"],
      [terrain.finishX, "FINISH"],
    ] as [number, string][]) {
      if (x < left - 4 || x > right + 4) continue;
      const { ctx } = this;
      const y = terrain.height(x);
      // Poles
      ctx.fillStyle = "#d8d8d8";
      ctx.fillRect(x - 3.1, y, 0.14, 4.2);
      ctx.fillRect(x + 2.96, y, 0.14, 4.2);
      // Checkered banner
      const cols = 16;
      const cw = 6 / cols;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 ? "#111" : "#f4f4f4";
          ctx.fillRect(x - 3 + c * cw, y + 3.7 + r * 0.25, cw, 0.25);
        }
      }
      worldText(ctx, label, x, y + 3.45, 0.32, "#ffffff", "rgba(0,0,0,0.6)");
      // Checkered stripe on the ground
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = c % 2 ? "#111" : "#f4f4f4";
        ctx.fillRect(x - 0.3 + (c % 2) * 0.3, y - 0.05 - Math.floor(c / 2) * 0.25, 0.3, 0.25);
      }
    }
  }

  private drawPowerUps(scene: Scene, left: number, right: number): void {
    const { ctx } = this;
    for (const pu of scene.terrain.powerUps) {
      if (pu.x < left || pu.x > right) continue;
      const bob = pu.kind === "fuel" ? 0 : Math.sin(scene.time * 3 + pu.x) * 0.12;
      let y = pu.y + bob;
      let alpha = 1;
      let k = 1;
      if (pu.taken) {
        const dt = scene.time - pu.takenAt;
        if (dt > 0.45) continue;
        y += dt * 3;
        alpha = 1 - dt / 0.45;
        k = 1 + dt * 1.5;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      const halo = ctx.createRadialGradient(pu.x, y, 0, pu.x, y, 0.8 * k);
      const hc = pu.kind === "glue" ? "120,180,255" : pu.kind === "life" ? "255,120,150" : "255,220,120";
      halo.addColorStop(0, `rgba(${hc},0.45)`);
      halo.addColorStop(1, `rgba(${hc},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(pu.x, y, 0.8 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(pu.x, y);
      if (pu.kind !== "fuel") ctx.rotate(Math.sin(scene.time * 2 + pu.x) * 0.15);
      ctx.scale(k, k);
      if (pu.kind === "glue") drawGlueBottle(ctx);
      else if (pu.kind === "fuel") drawFuelCan(ctx);
      else drawLifeHeart(ctx, scene.time);
      ctx.restore();
    }
  }

  /** Drips of glue around the egg's base; blinks during the last 3 seconds. */
  private drawGlueOnEgg(scene: Scene): void {
    const { ctx } = this;
    if (scene.glue < 3 && Math.floor(scene.time * 6) % 2 === 0) return;
    this.withBody(scene.car.egg, () => {
      ctx.fillStyle = "rgba(240, 248, 255, 0.85)";
      ctx.strokeStyle = "rgba(150, 180, 210, 0.9)";
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.ellipse(0, -0.36, 0.36, 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (const [dx, len] of [
        [-0.2, 0.18],
        [0.05, 0.26],
        [0.22, 0.14],
      ]) {
        ctx.beginPath();
        ctx.moveTo(dx - 0.05, -0.32);
        ctx.lineTo(dx + 0.05, -0.32);
        ctx.lineTo(dx + 0.03, -0.32 + len);
        ctx.arc(dx, -0.32 + len, 0.03, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  /** Bubble around the egg right after a rescue. */
  private drawShield(scene: Scene): void {
    const { ctx } = this;
    const p = scene.car.egg.getPosition();
    const pulse = 0.62 + Math.sin(scene.time * 12) * 0.04;
    const fade = Math.min(1, scene.shield / 0.6);
    const g = ctx.createRadialGradient(p.x, p.y, pulse * 0.5, p.x, p.y, pulse);
    g.addColorStop(0, "rgba(120,200,255,0)");
    g.addColorStop(0.8, `rgba(120,200,255,${0.25 * fade})`);
    g.addColorStop(1, `rgba(200,240,255,${0.7 * fade})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCoins(scene: Scene, left: number, right: number): void {
    const { ctx } = this;
    for (const c of scene.terrain.coins) {
      if (c.x < left || c.x > right) continue;
      const big = c.value >= BIG_COIN_VALUE;
      let y = c.y + (big ? Math.sin(scene.time * 2.5 + c.x) * 0.1 : 0);
      let alpha = 1;
      if (c.taken) {
        const dt = scene.time - c.takenAt;
        if (dt > 0.5) continue;
        y += dt * 4;
        alpha = 1 - dt / 0.5;
      }
      const r = big ? 0.6 : 0.32;
      const spin = Math.abs(Math.cos(scene.time * (big ? 2 : 3) + c.x));
      ctx.save();
      ctx.globalAlpha = alpha;
      if (big) {
        // Glow and rotating glints
        const glow = ctx.createRadialGradient(c.x, y, r * 0.5, c.x, y, r * 2);
        glow.addColorStop(0, "rgba(255,220,90,0.55)");
        glow.addColorStop(1, "rgba(255,220,90,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(c.x, y, r * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,220,0.8)";
        ctx.lineWidth = 0.04;
        for (let k = 0; k < 4; k++) {
          const a = scene.time * 1.5 + (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(c.x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2);
          ctx.lineTo(c.x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7);
          ctx.stroke();
        }
      }
      ctx.translate(c.x, y);
      ctx.scale(Math.max(0.15, spin), 1);
      const g = ctx.createLinearGradient(-r, r, r, -r);
      g.addColorStop(0, "#b37f00");
      g.addColorStop(0.5, "#ffd84a");
      g.addColorStop(1, "#c79100");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f5c400";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      if (big) {
        // Embossed star
        ctx.fillStyle = "#fff0a0";
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 ? r * 0.25 : r * 0.55;
          if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = "#fff3a0";
        ctx.fillRect(-0.04, -0.14, 0.08, 0.28);
      }
      ctx.restore();
    }
  }

  private withBody(body: Body, fn: () => void): void {
    const { ctx } = this;
    const p = body.getPosition();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.getAngle());
    fn();
    ctx.restore();
  }

  /** Soft contact shadow on the ground beneath the car, fading as it gets airborne. */
  private drawShadow(scene: Scene): void {
    const { ctx } = this;
    const p = scene.car.chassis.getPosition();
    const ground = scene.terrain.height(p.x);
    const above = p.y - ground - rideHeight(scene.car.def);
    const a = Math.max(0, 0.32 - above * 0.06);
    if (a <= 0.01) return;
    const slope = Math.atan((scene.terrain.height(p.x + 1) - scene.terrain.height(p.x - 1)) / 2);
    ctx.save();
    ctx.translate(p.x, ground + 0.02);
    ctx.rotate(slope);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.9);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.scale(1, 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawCar(car: Car): void {
    const { ctx } = this;
    const def = car.def;

    // Suspension struts (drawn under the body)
    ctx.strokeStyle = "#4a4a4a";
    ctx.lineWidth = 0.12;
    for (const w of car.wheels) {
      const wp = w.getPosition();
      const top = car.chassis.getWorldPoint(new Vec2(car.chassis.getLocalPoint(wp).x, 0));
      ctx.beginPath();
      ctx.moveTo(wp.x, wp.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }

    this.withBody(car.chassis, () => {
      drawChassis(ctx, def);
      // Decorative extra wheels spin with the front wheel.
      for (const ew of def.extraWheels ?? []) {
        ctx.save();
        ctx.translate(ew.x, ew.y);
        ctx.rotate(car.wheels[1].getAngle() - car.chassis.getAngle());
        drawWheel(ctx, def, ew.r);
        ctx.restore();
      }
    });
    car.wheels.forEach((w, i) => this.withBody(w, () => drawWheel(ctx, def, def.wheels[i].r)));
  }

  /** Translucent replay of your best time-trial run. */
  private drawGhost(def: VehicleDef, pose: GhostPose): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    drawChassis(ctx, def);
    const spin = -pose.x / def.wheels[1].r;
    for (const wd of [...def.wheels, ...(def.extraWheels ?? [])] as WheelDef[]) {
      ctx.save();
      ctx.translate(wd.x, wd.y);
      ctx.rotate(spin);
      drawWheel(ctx, def, wd.r);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawDust(dust: Dust[]): void {
    const { ctx } = this;
    for (const d of dust) {
      const k = d.life / d.max;
      ctx.fillStyle = `rgba(200, 180, 150, ${0.35 * k})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size * (1.6 - k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSplat(s: Splat): void {
    const { ctx } = this;
    const k = Math.min(1, s.t * 6);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (i / n);
      const r = (0.55 + 0.18 * Math.sin(i * 2.7)) * k;
      const x = Math.cos(a) * r * 1.6;
      const y = Math.sin(a) * r * 0.45;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    const yolk = ctx.createRadialGradient(0, 0.12 * k, 0, 0.05, 0.1 * k, 0.26 * k + 0.001);
    yolk.addColorStop(0, "#ffcf3a");
    yolk.addColorStop(1, "#f29b00");
    ctx.fillStyle = yolk;
    ctx.beginPath();
    ctx.ellipse(0.05, 0.1 * k, 0.24 * k, 0.15 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.ellipse(-0.02, 0.15 * k, 0.07 * k, 0.04 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(ps: Particle[]): void {
    const { ctx } = this;
    for (const p of ps) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = "#b39a6b";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(-p.size, -p.size * 0.6);
      ctx.lineTo(p.size, -p.size * 0.3);
      ctx.lineTo(p.size * 0.2, p.size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

const SEG_DRAW = 0.5;
const GRASSY = new Set(["countryside", "autumn"]);

// ---------- small world-space helpers ----------

/** Text drawn upright in world space (which is y-up). */
function worldText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, outline?: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.font = `bold ${size}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = size * 0.18;
    ctx.strokeText(text, 0, 0.02);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0.02);
  ctx.restore();
}

/** Yellow diamond road sign on a post; `icon` draws inside it (centered, meters). */
function drawSign(ctx: CanvasRenderingContext2D, x: number, groundY: number, icon: (c: CanvasRenderingContext2D) => void): void {
  ctx.fillStyle = "#5a3d22";
  ctx.fillRect(x - 0.05, groundY, 0.1, 1.5);
  ctx.save();
  ctx.translate(x, groundY + 1.9);
  ctx.save();
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#f5c400";
  ctx.strokeStyle = "#2b1d12";
  ctx.lineWidth = 0.06;
  ctx.fillRect(-0.38, -0.38, 0.76, 0.76);
  ctx.strokeRect(-0.38, -0.38, 0.76, 0.76);
  ctx.restore();
  icon(ctx);
  ctx.restore();
}

// ---------- vehicle drawing (shared by the game and garage previews) ----------

function tracePoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function drawDriver(ctx: CanvasRenderingContext2D, def: VehicleDef, r: number): void {
  const d = def.driver;
  const g = ctx.createRadialGradient(d.x - r * 0.3, d.y + r * 0.3, 0, d.x, d.y, r);
  g.addColorStop(0, "#f8d6ae");
  g.addColorStop(1, "#d9a678");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
  ctx.fill();
  if (d.helmet) {
    ctx.fillStyle = d.helmet;
    ctx.beginPath();
    ctx.arc(d.x, d.y + 0.02, r * 1.15, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(d.x - r * 0.3, d.y + r * 0.7, r * 0.35, r * 0.15, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draws a vehicle body in its local space (meters, y up), with lighting. */
export function drawChassis(ctx: CanvasRenderingContext2D, def: VehicleDef): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const hasGlass = def.parts.some((p) => p.fill === GLASS);

  for (const part of def.parts) {
    tracePoly(ctx, part.pts);
    if (part.fill === GLASS) {
      // Tinted glass with a diagonal reflection
      const ys = part.pts.map((q) => q.y);
      const xs = part.pts.map((q) => q.x);
      const g = ctx.createLinearGradient(0, Math.max(...ys), 0, Math.min(...ys));
      g.addColorStop(0, "#d9f2fb");
      g.addColorStop(1, "#7fb8cf");
      ctx.fillStyle = g;
      ctx.fill();
      drawDriver(ctx, def, 0.12);
      ctx.save();
      tracePoly(ctx, part.pts);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      const x0 = Math.min(...xs);
      ctx.beginPath();
      ctx.moveTo(x0 + 0.15, Math.min(...ys));
      ctx.lineTo(x0 + 0.3, Math.min(...ys));
      ctx.lineTo(x0 + 0.55, Math.max(...ys));
      ctx.lineTo(x0 + 0.4, Math.max(...ys));
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#1e1e22";
      ctx.lineWidth = 0.05;
      tracePoly(ctx, part.pts);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = part.fill;
    ctx.fill();
    // Paint shading: highlight on top, darker toward the bottom.
    const ys = part.pts.map((q) => q.y);
    const top = Math.max(...ys);
    const bottom = Math.min(...ys);
    if (top - bottom > 0.1) {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, "rgba(255,255,255,0.32)");
      g.addColorStop(0.35, "rgba(255,255,255,0.04)");
      g.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = g;
      tracePoly(ctx, part.pts);
      ctx.fill();
    }
    if (part.outline ?? part.solid !== false) {
      ctx.strokeStyle = "rgba(20,14,10,0.85)";
      ctx.lineWidth = part.solid === false ? 0.04 : 0.05;
      tracePoly(ctx, part.pts);
      ctx.stroke();
    }
  }
  if (!hasGlass) drawDriver(ctx, def, 0.13);

  for (const l of def.lines ?? []) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width;
    ctx.beginPath();
    ctx.moveTo(l.pts[0].x, l.pts[0].y);
    for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i].x, l.pts[i].y);
    ctx.stroke();
  }

  // Headlight with glow, tail light
  const hl = def.headlight;
  const glow = ctx.createRadialGradient(hl.x, hl.y, 0, hl.x, hl.y, 0.35);
  glow.addColorStop(0, "rgba(255,250,200,0.55)");
  glow.addColorStop(1, "rgba(255,250,200,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hl.x, hl.y, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fffbe0";
  ctx.beginPath();
  ctx.arc(hl.x, hl.y, 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff5a2a";
  ctx.fillRect(def.taillight.x - 0.04, def.taillight.y - 0.08, 0.08, 0.16);
}

/** Draws a wheel centered at the origin in local space: tire, tread, alloy rim. */
export function drawWheel(ctx: CanvasRenderingContext2D, def: VehicleDef, r: number): void {
  // Tire with a soft sidewall gradient
  const tire = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
  tire.addColorStop(0, "#3a3a3a");
  tire.addColorStop(0.7, def.wheelColor);
  tire.addColorStop(1, "#0d0d0d");
  ctx.fillStyle = tire;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // Tread blocks
  ctx.fillStyle = "#2c2c2c";
  const treads = Math.round(r * 26);
  for (let k = 0; k < treads; k++) {
    ctx.save();
    ctx.rotate((k / treads) * Math.PI * 2);
    ctx.fillRect(r * 0.86, -0.028, r * 0.14, 0.056);
    ctx.restore();
  }
  // Rim: metallic gradient lit from the top-left
  const rim = ctx.createLinearGradient(-r * 0.5, r * 0.5, r * 0.5, -r * 0.5);
  rim.addColorStop(0, "#ffffff");
  rim.addColorStop(0.45, def.hubColor);
  rim.addColorStop(1, "#5a5a5a");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.22) * r * 0.18, Math.sin(a - 0.22) * r * 0.18);
    ctx.lineTo(Math.cos(a - 0.3) * r * 0.48, Math.sin(a - 0.3) * r * 0.48);
    ctx.lineTo(Math.cos(a + 0.3) * r * 0.48, Math.sin(a + 0.3) * r * 0.48);
    ctx.lineTo(Math.cos(a + 0.22) * r * 0.18, Math.sin(a + 0.22) * r * 0.18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  // Hub cap and lug nuts
  ctx.fillStyle = "#3b3b3b";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cfcfcf";
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.1, Math.sin(a) * r * 0.1, r * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A glossy, speckled egg. `armor` > 0 adds protective plating. */
export function drawEggShape(ctx: CanvasRenderingContext2D, armor = 0): void {
  // Body: warm cream with soft falloff toward the edges
  const g = ctx.createRadialGradient(-EGG_RX * 0.3, EGG_RY_TOP * 0.3, 0.02, 0, -0.05, EGG_RY_TOP * 1.05);
  g.addColorStop(0, "#fffdf8");
  g.addColorStop(0.45, "#f8ecd6");
  g.addColorStop(0.85, "#e6cfa6");
  g.addColorStop(1, "#c9ad80");
  ctx.fillStyle = g;
  tracePoly(ctx, EGG_SHAPE);
  ctx.fill();
  // Bounce light from below
  const b = ctx.createLinearGradient(0, -0.4, 0, -0.1);
  b.addColorStop(0, "rgba(255,220,170,0.35)");
  b.addColorStop(1, "rgba(255,220,170,0)");
  ctx.fillStyle = b;
  tracePoly(ctx, EGG_SHAPE);
  ctx.fill();
  // Speckles
  ctx.fillStyle = "rgba(150,105,60,0.32)";
  for (const [x, y, r] of SPECKLES) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Specular highlights
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.beginPath();
  ctx.ellipse(-0.12, 0.2, 0.07, 0.12, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(-0.03, 0.33, 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(140,105,60,0.55)";
  ctx.lineWidth = 0.025;
  tracePoly(ctx, EGG_SHAPE);
  ctx.stroke();

  if (armor > 0) {
    // Translucent hex plating with a steel rim
    ctx.save();
    tracePoly(ctx, EGG_SHAPE);
    ctx.clip();
    ctx.strokeStyle = "rgba(90,160,230,0.55)";
    ctx.lineWidth = 0.02;
    const s = 0.12;
    for (let row = -5; row <= 5; row++) {
      for (let col = -3; col <= 3; col++) {
        const cx = col * s * 1.5;
        const cy = row * s * 0.87 + (col % 2 ? s * 0.43 : 0);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const px = cx + Math.cos(a) * s * 0.5;
          const py = cy + Math.sin(a) * s * 0.5;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(70,130,200,0.9)";
    ctx.lineWidth = 0.035;
    tracePoly(ctx, EGG_SHAPE);
    ctx.stroke();
  }
}

const SPECKLES: [number, number, number][] = [
  [0.12, 0.1, 0.022],
  [-0.1, -0.15, 0.016],
  [0.05, -0.25, 0.02],
  [0.18, -0.08, 0.012],
  [-0.2, 0.05, 0.014],
  [0.0, 0.25, 0.012],
  [-0.05, -0.02, 0.01],
  [0.22, 0.2, 0.01],
  [-0.15, -0.3, 0.012],
  [0.1, -0.35, 0.01],
];

/** Renders a static side view of a vehicle (with its egg) to fill a canvas. */
export function drawVehiclePreview(canvas: HTMLCanvasElement, def: VehicleDef): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const ride = rideHeight(def);
  const s = Math.min(w / 4.3, h / (ride + 1.9));
  const groundPx = h - 8;
  ctx.setTransform(dpr * s, 0, 0, -dpr * s, (dpr * w) / 2, dpr * groundPx);

  const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 2);
  sh.addColorStop(0, "rgba(0,0,0,0.25)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.save();
  ctx.scale(1, 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.translate(0, ride);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 0.12;
  for (const wd of def.wheels) {
    ctx.beginPath();
    ctx.moveTo(wd.x, wd.y);
    ctx.lineTo(wd.x, 0);
    ctx.stroke();
  }
  drawChassis(ctx, def);
  ctx.save();
  ctx.translate(def.egg.x, def.egg.y);
  drawEggShape(ctx);
  ctx.restore();
  for (const wd of [...def.wheels, ...(def.extraWheels ?? [])]) {
    ctx.save();
    ctx.translate(wd.x, wd.y);
    drawWheel(ctx, def, wd.r);
    ctx.restore();
  }
}

// ---------- terrain themes (shared by the game and garage previews) ----------

function hash(i: number): number {
  const r = Math.sin(i * 12.9898) * 43758.5453;
  return r - Math.floor(r);
}

function mixColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${m(16)}, ${m(8)}, ${m(0)})`;
}

/** Paints the sky, sun/planet, stars, clouds, haze, sea and distant hills in screen space. */
function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, map: MapDef, time: number, camXpx: number, camYpx: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, map.sky[0]);
  g.addColorStop(0.7, map.sky[1]);
  g.addColorStop(1, map.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(1, h / 600);

  if (map.stars) {
    for (let i = 0; i < 120; i++) {
      const x = (((hash(i) * w * 3 - camXpx * 0.02) % w) + w) % w;
      const y = hash(i + 500) * h * 0.75;
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.65 * tw * hash(i + 99)})`;
      const sz = hash(i + 7) > 0.9 ? 2.5 : 1.5;
      ctx.fillRect(x, y, sz, sz);
    }
  }

  // Sun with a wide soft glow
  const sx = w * 0.82;
  const sy = h * 0.18;
  const r = map.sun.radius * Math.max(0.6, scale);
  const glow = ctx.createRadialGradient(sx, sy, r * 0.8, sx, sy, r * 4.5);
  glow.addColorStop(0, map.sun.glow);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(sx - r * 5, sy - r * 5, r * 10, r * 10);
  const disc = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 0, sx, sy, r);
  disc.addColorStop(0, "#ffffff");
  disc.addColorStop(0.6, map.sun.color);
  disc.addColorStop(1, map.sun.color);
  ctx.fillStyle = map.planet ? map.sun.color : disc;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  if (map.planet) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#5cb85c";
    ctx.beginPath();
    ctx.ellipse(sx - r * 0.3, sy - r * 0.2, r * 0.45, r * 0.3, 0.5, 0, Math.PI * 2);
    ctx.ellipse(sx + r * 0.4, sy + r * 0.35, r * 0.35, r * 0.22, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(sx + r * 0.1, sy - r * 0.55, r * 0.5, r * 0.12, 0.1, 0, Math.PI * 2);
    ctx.fill();
    // Night side
    const shade = ctx.createLinearGradient(sx - r, sy, sx + r, sy);
    shade.addColorStop(0.4, "rgba(0,0,20,0)");
    shade.addColorStop(1, "rgba(0,0,20,0.7)");
    ctx.fillStyle = shade;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    ctx.restore();
  }

  if (map.clouds) {
    const span = w + 400;
    for (let i = 0; i < 7; i++) {
      const depth = 0.03 + (i % 3) * 0.025;
      const base = i * 377 + time * (4 + (i % 3) * 3) - camXpx * depth;
      const x = (((base % span) + span) % span) - 200;
      const y = (40 + ((i * 97) % 180)) * Math.max(0.5, scale);
      const k = (0.6 + ((i * 31) % 10) / 14) * Math.max(0.6, scale);
      ctx.fillStyle = map.clouds;
      cloud(ctx, x, y, k);
      // Shaded underside
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(x - 4 * k, y + 10 * k, 64 * k, 12 * k);
    }
  }

  // Far mountains, then mid hills: each layer fades toward the horizon color (aerial perspective).
  const haze = map.sky[2];
  hillLayer(ctx, w, h, camXpx * 0.06, camYpx * 0.02, h * 0.56, 95 * scale, 0.0013, mixColor(map.hills[0], haze, 0.55), 0.4);
  hillLayer(ctx, w, h, camXpx * 0.15, camYpx * 0.045, h * 0.64, 70 * scale, 0.0021, mixColor(map.hills[0], haze, 0.2), 1.3);
  if (map.sea) {
    const top = h * 0.7;
    const sea = ctx.createLinearGradient(0, top, 0, h);
    sea.addColorStop(0, mixColor(map.sea, haze, 0.35));
    sea.addColorStop(1, map.sea);
    ctx.fillStyle = sea;
    ctx.fillRect(0, top, w, h - top);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const y = top + 6 + hash(i) * (h - top - 10);
      const x = ((((hash(i + 3) * w * 2 - camXpx * 0.25 + Math.sin(time + i) * 8) % w) + w) % w);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 14 + hash(i + 9) * 30, y);
      ctx.stroke();
    }
  }
  hillLayer(ctx, w, h, camXpx * 0.35, camYpx * 0.105, h * 0.76, 55 * scale, 0.0042, map.hills[1], 4.1);
  // Low haze band
  const hz = ctx.createLinearGradient(0, h * 0.55, 0, h * 0.85);
  hz.addColorStop(0, "rgba(255,255,255,0)");
  hz.addColorStop(1, map.stars ? "rgba(0,0,0,0)" : "rgba(255,255,255,0.12)");
  ctx.fillStyle = hz;
  ctx.fillRect(0, h * 0.55, w, h * 0.3);

  if (map.snow) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 80; i++) {
      const speed = 30 + hash(i) * 40;
      const x = (((hash(i + 7) * w * 2 + Math.sin(time + i) * 20 - camXpx * 0.3) % w) + w) % w;
      const y = (((hash(i + 13) * h + time * speed) % h) + h) % h;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + hash(i + 3) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (map.leaves) {
    const colors = ["#e0782a", "#c94f1f", "#f2b33d", "#a8662a"];
    for (let i = 0; i < 40; i++) {
      const speed = 25 + hash(i) * 30;
      const x = (((hash(i + 7) * w * 2 + Math.sin(time * 0.8 + i) * 40 - camXpx * 0.4 - time * 20) % w) + w) % w;
      const y = (((hash(i + 13) * h + time * speed) % h) + h) % h;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * (1 + hash(i)) + i);
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 22 * k, 0, Math.PI * 2);
  ctx.arc(x + 26 * k, y - 12 * k, 28 * k, 0, Math.PI * 2);
  ctx.arc(x + 56 * k, y, 22 * k, 0, Math.PI * 2);
  ctx.rect(x, y, 56 * k, 22 * k);
  ctx.fill();
}

function hillLayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  off: number,
  yOff: number,
  baseY: number,
  amp: number,
  freq: number,
  color: string,
  phase: number,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 10; x += 10) {
    const t = x + off;
    const y = baseY + yOff - amp * (Math.sin(t * freq + phase) * 0.6 + Math.sin(t * freq * 2.3 + phase * 2) * 0.4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

/** Draws one decoration standing at (x, y) in world space (meters, y up). */
function drawDecor(ctx: CanvasRenderingContext2D, map: MapDef, x: number, y: number, k: number): void {
  const [c1, c2] = map.decorColors;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  switch (map.decor) {
    case "tree":
    case "maple": {
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.moveTo(-0.12, 0);
      ctx.lineTo(0.12, 0);
      ctx.lineTo(0.07, 1.1);
      ctx.lineTo(-0.07, 1.1);
      ctx.fill();
      const blobs: [number, number, number][] = [
        [0, 1.35, 0.5],
        [-0.38, 1.08, 0.36],
        [0.38, 1.08, 0.36],
        [-0.15, 1.65, 0.32],
        [0.2, 1.6, 0.3],
      ];
      for (const [bx, by, br] of blobs) {
        const g = ctx.createRadialGradient(bx - br * 0.3, by + br * 0.35, 0, bx, by, br);
        g.addColorStop(0, mixColor(c2, "#ffffff", 0.25));
        g.addColorStop(1, mixColor(c2, "#000000", 0.25));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "palm": {
      ctx.strokeStyle = c1;
      ctx.lineWidth = 0.14;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(0.25, 1.1, 0.1, 2.1);
      ctx.stroke();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 0.09;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0.1, 2.1);
        ctx.quadraticCurveTo(0.1 + Math.cos(a) * 0.5, 2.1 + 0.35, 0.1 + Math.cos(a) * 0.85, 2.1 - 0.25 + Math.sin(a) * 0.15);
        ctx.stroke();
      }
      ctx.fillStyle = "#6b4423";
      ctx.beginPath();
      ctx.arc(0.05, 2.0, 0.07, 0, Math.PI * 2);
      ctx.arc(0.17, 2.02, 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "mesa": {
      const g = ctx.createLinearGradient(-0.6, 0, 0.6, 0);
      g.addColorStop(0, c2);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-0.6, 0);
      ctx.lineTo(-0.4, 1.0);
      ctx.lineTo(-0.5, 1.1);
      ctx.lineTo(0.45, 1.15);
      ctx.lineTo(0.35, 1.0);
      ctx.lineTo(0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.lineWidth = 0.04;
      for (const yy of [0.3, 0.6, 0.85]) {
        ctx.beginPath();
        ctx.moveTo(-0.55 + yy * 0.12, yy);
        ctx.lineTo(0.55 - yy * 0.2, yy);
        ctx.stroke();
      }
      break;
    }
    case "cactus":
      ctx.lineCap = "round";
      ctx.strokeStyle = c1;
      ctx.lineWidth = 0.26;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 1.4);
      ctx.moveTo(0, 0.6);
      ctx.lineTo(-0.35, 0.6);
      ctx.lineTo(-0.35, 1.0);
      ctx.moveTo(0, 0.8);
      ctx.lineTo(0.32, 0.8);
      ctx.lineTo(0.32, 1.15);
      ctx.stroke();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(-0.04, 0.1);
      ctx.lineTo(-0.04, 1.35);
      ctx.stroke();
      break;
    case "pine":
      ctx.fillStyle = c1;
      ctx.fillRect(-0.08, 0, 0.16, 0.4);
      for (let t = 0; t < 3; t++) {
        const by = 0.3 + t * 0.45;
        const hw = 0.6 - t * 0.15;
        const g = ctx.createLinearGradient(-hw, 0, hw, 0);
        g.addColorStop(0, mixColor(c2, "#ffffff", 0.15));
        g.addColorStop(1, mixColor(c2, "#000000", 0.3));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-hw, by);
        ctx.lineTo(hw, by);
        ctx.lineTo(0, by + 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(-hw * 0.35, by + 0.45);
        ctx.lineTo(hw * 0.35, by + 0.45);
        ctx.lineTo(0, by + 0.7);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case "rock":
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.moveTo(-0.5, 0);
      ctx.lineTo(-0.35, 0.35);
      ctx.lineTo(0.05, 0.5);
      ctx.lineTo(0.45, 0.3);
      ctx.lineTo(0.55, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.moveTo(-0.3, 0.3);
      ctx.lineTo(0.05, 0.45);
      ctx.lineTo(0.1, 0.25);
      ctx.closePath();
      ctx.fill();
      break;
    case "crystal":
      for (const [dx, hgt, lean] of [
        [-0.2, 0.9, -0.2],
        [0.05, 1.3, 0],
        [0.3, 0.7, 0.25],
      ]) {
        ctx.save();
        ctx.translate(dx, 0);
        ctx.rotate(lean);
        ctx.fillStyle = c1;
        ctx.beginPath();
        ctx.moveTo(-0.12, 0);
        ctx.lineTo(0.12, 0);
        ctx.lineTo(0.12, hgt * 0.8);
        ctx.lineTo(0, hgt);
        ctx.lineTo(-0.12, hgt * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = c2;
        ctx.fillRect(-0.03, 0.1, 0.05, hgt * 0.6);
        ctx.restore();
      }
      break;
  }
  ctx.restore();
}

/** Renders a small landscape preview of a map to fill a canvas. */
export function drawMapPreview(canvas: HTMLCanvasElement, map: MapDef): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintSky(ctx, w, h, map, 3, 0, 0);

  const s = 26;
  ctx.setTransform(dpr * s, 0, 0, -dpr * s, 0, dpr * h);
  const widthM = w / s;
  const sh = map.shape;
  const ground = (x: number) =>
    1.4 + Math.sin(x / (sh.waveA / 9)) * 0.45 * sh.ampA + Math.sin(x / (sh.waveB / 6) + 1) * 0.2 * sh.ampB + Math.sin(x / (sh.waveC / 3)) * 0.06 * sh.ampC;

  const surface = new Path2D();
  surface.moveTo(0, ground(0));
  for (let x = 0.1; x <= widthM + 0.1; x += 0.1) surface.lineTo(x, ground(x));
  const fill = new Path2D(surface);
  fill.lineTo(widthM + 0.1, -1);
  fill.lineTo(0, -1);
  fill.closePath();
  ctx.fillStyle = map.ground;
  ctx.fill(fill);
  ctx.save();
  ctx.clip(fill);
  ctx.translate(0, -0.6);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = map.bands[0];
  ctx.stroke(surface);
  ctx.restore();

  drawDecor(ctx, map, widthM * 0.22, ground(widthM * 0.22) - 0.05, 0.9);
  drawDecor(ctx, map, widthM * 0.78, ground(widthM * 0.78) - 0.05, 0.7);

  ctx.lineJoin = "round";
  if (map.glow) {
    ctx.strokeStyle = map.glow;
    ctx.lineWidth = 0.4;
    ctx.stroke(surface);
  }
  ctx.lineWidth = 0.22;
  ctx.strokeStyle = map.top[0];
  ctx.stroke(surface);
  ctx.lineWidth = 0.12;
  ctx.strokeStyle = map.top[1];
  ctx.stroke(surface);
}

// ---------- pickups ----------

/** A generic white glue bottle with an orange nozzle cap, centered at the origin (meters, y up). */
export function drawGlueBottle(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2b1d12";
  ctx.lineWidth = 0.04;

  ctx.fillStyle = "#ff8a1f";
  ctx.beginPath();
  ctx.moveTo(-0.05, 0.62);
  ctx.lineTo(0.05, 0.62);
  ctx.lineTo(0.12, 0.38);
  ctx.lineTo(-0.12, 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(-0.16, 0.3, 0.32, 0.1);
  ctx.strokeRect(-0.16, 0.3, 0.32, 0.1);

  const body = ctx.createLinearGradient(-0.28, 0, 0.28, 0);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.7, "#f0f0f0");
  body.addColorStop(1, "#c9c9c9");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-0.2, 0.3);
  ctx.lineTo(0.2, 0.3);
  ctx.quadraticCurveTo(0.28, 0.24, 0.28, 0.12);
  ctx.lineTo(0.28, -0.4);
  ctx.quadraticCurveTo(0.28, -0.48, 0.2, -0.48);
  ctx.lineTo(-0.2, -0.48);
  ctx.quadraticCurveTo(-0.28, -0.48, -0.28, -0.4);
  ctx.lineTo(-0.28, 0.12);
  ctx.quadraticCurveTo(-0.28, 0.24, -0.2, 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#2f7ae5";
  ctx.fillRect(-0.28, -0.3, 0.56, 0.36);
  ctx.strokeRect(-0.28, -0.3, 0.56, 0.36);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(0, 0.0);
  ctx.quadraticCurveTo(0.1, -0.12, 0.08, -0.17);
  ctx.arc(0, -0.17, 0.08, 0, Math.PI);
  ctx.quadraticCurveTo(-0.1, -0.12, 0, 0.0);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(-0.21, 0.08, 0.05, 0.16);
}

/** Red jerrycan. */
export function drawFuelCan(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2b1d12";
  ctx.lineWidth = 0.04;
  const g = ctx.createLinearGradient(-0.3, 0, 0.3, 0);
  g.addColorStop(0, "#ff5a4a");
  g.addColorStop(0.6, "#d8322a");
  g.addColorStop(1, "#9c1f19");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.3, -0.42);
  ctx.lineTo(0.3, -0.42);
  ctx.lineTo(0.3, 0.3);
  ctx.lineTo(0.12, 0.42);
  ctx.lineTo(-0.3, 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Handle
  ctx.fillStyle = "#9c1f19";
  ctx.beginPath();
  ctx.roundRect(-0.24, 0.24, 0.26, 0.1, 0.04);
  ctx.fill();
  // Spout
  ctx.fillStyle = "#e0b000";
  ctx.fillRect(0.14, 0.38, 0.1, 0.12);
  // Embossed X
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.3);
  ctx.lineTo(0.2, 0.15);
  ctx.moveTo(0.2, -0.3);
  ctx.lineTo(-0.2, 0.15);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(-0.26, -0.36, 0.06, 0.6);
}

/** Extra life: a glowing heart with a little egg. */
export function drawLifeHeart(ctx: CanvasRenderingContext2D, time: number): void {
  const beat = 1 + Math.max(0, Math.sin(time * 6)) * 0.08;
  ctx.save();
  ctx.scale(beat, beat);
  const g = ctx.createLinearGradient(0, 0.4, 0, -0.45);
  g.addColorStop(0, "#ff6b8a");
  g.addColorStop(1, "#d62850");
  ctx.fillStyle = g;
  ctx.strokeStyle = "#7a1028";
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(0, -0.42);
  ctx.bezierCurveTo(-0.55, 0, -0.38, 0.45, 0, 0.2);
  ctx.bezierCurveTo(0.38, 0.45, 0.55, 0, 0, -0.42);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff8ec";
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.1, 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(-0.17, 0.18, 0.06, 0.09, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------- screen overlays ----------

/** Round speedometer with an RPM ring, gear and fuel gauge, at the bottom center. */
function drawGauges(ctx: CanvasRenderingContext2D, w: number, h: number, g: Gauges): void {
  const r = Math.max(46, Math.min(78, Math.min(w, h) * 0.11));
  const cx = w / 2;
  const cy = h - r - 18;
  // Face
  const face = ctx.createRadialGradient(cx, cy - r * 0.4, r * 0.2, cx, cy, r);
  face.addColorStop(0, "rgba(40,44,52,0.92)");
  face.addColorStop(1, "rgba(14,15,19,0.92)");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const a0 = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  // RPM ring
  const rpmFrac = Math.min(1, g.rpm / 7000);
  ctx.lineCap = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, a0, a0 + span);
  ctx.stroke();
  ctx.strokeStyle = rpmFrac > 0.86 ? "#ff4a3a" : "#4fc3ff";
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, a0, a0 + span * rpmFrac);
  ctx.stroke();
  // Speed ticks
  const maxKmh = 140;
  for (let k = 0; k <= 14; k++) {
    const a = a0 + (span * k) / 14;
    const major = k % 2 === 0;
    ctx.strokeStyle = "#e6e9f0";
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * (major ? 0.68 : 0.73), cy + Math.sin(a) * r * (major ? 0.68 : 0.73));
    ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.stroke();
  }
  const na = a0 + (span * Math.min(maxKmh, g.kmh)) / maxKmh;
  ctx.strokeStyle = "#ff8a1f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(na) * r * 0.12, cy - Math.sin(na) * r * 0.12);
  ctx.lineTo(cx + Math.cos(na) * r * 0.76, cy + Math.sin(na) * r * 0.76);
  ctx.stroke();
  ctx.fillStyle = "#ff8a1f";
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(r * 0.36)}px Trebuchet MS, sans-serif`;
  ctx.fillText(String(Math.round(g.kmh)), cx, cy + r * 0.32);
  ctx.font = `${Math.round(r * 0.15)}px Trebuchet MS, sans-serif`;
  ctx.fillStyle = "#9aa0ad";
  ctx.fillText("km/h", cx, cy + r * 0.56);
  ctx.fillStyle = "#4fc3ff";
  ctx.font = `bold ${Math.round(r * 0.2)}px Trebuchet MS, sans-serif`;
  ctx.fillText(g.rpm > 0 ? `${g.gear + 1}` : "–", cx, cy - r * 0.36);

  // Fuel gauge beside the speedo
  const fw = r * 1.2;
  const fx = cx + r + 14;
  const fy = cy + r * 0.35;
  const low = g.fuel < 0.2;
  const blink = low && Math.floor(performance.now() / 300) % 2 === 0;
  ctx.fillStyle = "rgba(14,15,19,0.85)";
  ctx.beginPath();
  ctx.roundRect(fx, fy - 12, fw + 34, 24, 12);
  ctx.fill();
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("⛽", fx + 6, fy + 1);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(fx + 28, fy - 5, fw, 10);
  ctx.fillStyle = blink ? "#ffffff" : low ? "#ff4a3a" : g.fuel < 0.45 ? "#f5c400" : "#5cd65c";
  ctx.fillRect(fx + 28, fy - 5, fw * Math.max(0, g.fuel), 10);
}

/** Full-screen egg smash: shards fly at the camera, the egg splatters across the glass and drips. */
function drawSmash(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w * 0.5;
  const cy = h * 0.45;
  const m = Math.min(w, h);
  const impact = 0.12;

  // Shards flying toward the screen
  if (t < 0.4) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + hash(i) * 0.5;
      const d = t * (600 + hash(i + 3) * 900);
      const s = 8 + t * 140 * (0.5 + hash(i + 5));
      ctx.save();
      ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      ctx.rotate(t * 10 + i);
      ctx.fillStyle = i % 2 ? "#fbf3e2" : "#efe2c4";
      ctx.strokeStyle = "#b39a6b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-s, -s * 0.5);
      ctx.lineTo(s, -s * 0.3);
      ctx.lineTo(s * 0.2, s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  if (t < impact) return;
  const k = Math.min(1, (t - impact) * 7);
  const ease = 1 - Math.pow(1 - k, 3);

  // White flash on impact
  if (t < impact + 0.1) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - (t - impact) / 0.1)})`;
    ctx.fillRect(0, 0, w, h);
  }

  // Cracked glass radiating from the impact
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + hash(i + 40) * 0.4;
    const len = Math.max(w, h) * (0.35 + hash(i + 41) * 0.4) * ease;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let px = cx;
    let py = cy;
    for (let sgm = 1; sgm <= 5; sgm++) {
      const jitter = (hash(i * 9 + sgm) - 0.5) * 0.35;
      px = cx + Math.cos(a + jitter) * (len * sgm) / 5;
      py = cy + Math.sin(a + jitter) * (len * sgm) / 5;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  for (const rr of [0.18, 0.32]) {
    ctx.beginPath();
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const rad = m * rr * ease * (0.9 + hash(i + rr * 100) * 0.2);
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      else ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.stroke();
  }

  // Egg white splat (irregular blob) with droplets
  const R = m * 0.4 * ease;
  ctx.fillStyle = "rgba(255,253,245,0.93)";
  ctx.beginPath();
  const pts = 26;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const rad = R * (0.75 + 0.35 * hash(i + 7) + 0.12 * Math.sin(i * 3));
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad * 0.85;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.quadraticCurveTo(cx + Math.cos(a - 0.12) * rad * 1.08, cy + Math.sin(a - 0.12) * rad * 0.92, x, y);
  }
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = hash(i + 60) * Math.PI * 2;
    const d = R * (1.1 + hash(i + 61) * 0.6);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, m * 0.012 * (1 + hash(i + 62) * 2) * ease, 0, Math.PI * 2);
    ctx.fill();
  }
  // Drips running down
  const drip = Math.max(0, t - 0.45);
  for (let i = 0; i < 6; i++) {
    const x = cx + (hash(i + 80) - 0.5) * R * 1.3;
    const len = Math.min(h * 0.4, drip * (40 + hash(i + 81) * 70));
    const top = cy + R * 0.55;
    const dw = m * 0.012 + hash(i + 82) * m * 0.012;
    ctx.beginPath();
    ctx.moveTo(x - dw, top);
    ctx.lineTo(x + dw, top);
    ctx.lineTo(x + dw * 0.7, top + len);
    ctx.arc(x, top + len, dw * 0.8, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  }
  // Yolk with depth and shine
  const yr = R * 0.36;
  const yolk = ctx.createRadialGradient(cx - yr * 0.3, cy - yr * 0.3, yr * 0.1, cx, cy, yr);
  yolk.addColorStop(0, "#ffe27a");
  yolk.addColorStop(0.6, "#ffb300");
  yolk.addColorStop(1, "#e88a00");
  ctx.fillStyle = yolk;
  ctx.beginPath();
  ctx.ellipse(cx, cy, yr, yr * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(cx - yr * 0.35, cy - yr * 0.38, yr * 0.22, yr * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();
}
