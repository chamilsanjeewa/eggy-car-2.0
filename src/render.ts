import { Vec2, Body } from "planck";
import { Car, eggOutline, rideHeight, EGG_RX, EGG_RY_TOP } from "./car";
import { VehicleDef, WheelDef } from "./vehicles";
import { MapDef, viewMap } from "./maps";
import { InteriorStyle, DEFAULT_STYLE } from "./interior";
import { CockpitState, DashInfo, Attitude, drawGyro, drawNav, sideMirrorRects, drawSideMirrorFrame, drawDashToy, drawCabin, drawGlass, drawHood, drawDashboard, drawSteeringWheel, drawMirrorFrame, mirrorRect, Rect, cabinLight, litStyle, litColor, drawInstrumentGlow, drawRainGlass, drawGlassLight } from "./cockpit";
import { drawFirstPerson, bodyColor, drawHeadlightPool } from "./firstperson";
import { daylight } from "./daynight";
import { Terrain, RAMP, FORK, Fork, BIG_COIN_VALUE, SkyObstacle, stormPhase, STORM } from "./terrain";

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

/** A computer rival in Race mode. */
export interface RivalView {
  car: Car;
  name: string;
  eggBroken: boolean;
}

export interface Gauges {
  kmh: number;
  /** Show miles per hour instead of km/h. */
  mph: boolean;
  /** The engine's redline, for the rev ring. */
  redline: number;
  rpm: number;
  gear: number;
  /** 0..1, or -1 when fuel is switched off */
  fuel: number;
  /** Truck tilt vs the ground, for the gyro. */
  attitude: Attitude;
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
  /** Race mode rivals (empty otherwise). */
  rivals: RivalView[];
  /** Rain intensity 0..1 (0 = dry). */
  rain: number;
  /** Time of day 0..1 (0 = midnight, 0.5 = noon), or null where the terrain has a fixed time. */
  dayTime: number | null;
  /** Time-trial ghost of your best run. */
  ghost: { def: VehicleDef; pose: GhostPose | null } | null;
  /** Seconds since the egg smashed (full-screen splatter), or null. */
  smash: number | null;
  /** Screen shake in pixels. */
  shake: number;
  gauges: Gauges;
  dash: Omit<DashInfo, "terrain" | "carX">;
  /** Chosen car interior (driver's seat). */
  interior: InteriorStyle;
  /** Show the navigation minimap (outside the driver's seat, which has its own). */
  navMap: boolean;
}

const EGG_SHAPE = eggOutline(48);
export const KMH_TO_MPH = 0.621371;
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

    // Driver's seat: a first-person road view with the cabin around it.
    if (scene.cockpit) {
      const st = scene.cockpit;
      const chassis = scene.car.chassis;
      const d = scene.car.def.driver;
      const eye = chassis.getWorldPoint({ x: d.x + 0.05, y: d.y + 0.12 + st.bob });
      ctx.setTransform(this.dpr, 0, 0, this.dpr, shakeX * this.dpr, shakeY * this.dpr);
      drawFirstPerson(ctx, w, h, scene, { x: eye.x, y: eye.y, pitch: st.viewPitch - st.surge * 0.14 });
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawDayTint(ctx, w, h, scene);
      drawHeadlightPool(ctx, w, h, nightOf(scene));
      this.drawCabinView(scene, st, true);
      if (scene.smash !== null) drawSmash(ctx, w, h, scene.smash);
      return;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (cam.angle === 0) {
      paintSky(ctx, w, h, viewMap(scene.terrain.map, cam.x), scene.time, cam.x * cam.scale, cam.y * cam.scale);
    } else {
      // Rotated view: draw the sky oversized so the corners stay covered.
      const pad = Math.hypot(w, h) / 2 - Math.min(w, h) / 2 + 2;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(cam.angle);
      ctx.translate(-w / 2 - pad, -h / 2 - pad);
      paintSky(ctx, w + pad * 2, h + pad * 2, viewMap(scene.terrain.map, cam.x), scene.time, cam.x * cam.scale, cam.y * cam.scale);
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
      drawDayTint(this.ctx, w, h, scene);
    if (scene.rain > 0) drawRain(this.ctx, w, h, scene.time, scene.rain);
    this.vignette();
      drawGauges(ctx, w, h, scene.gauges);
      if (scene.navMap) {
        // Top-right corner, under the coin counter
        const nw = Math.max(170, Math.min(320, w * 0.3));
        const nh = Math.round(nw * 0.46);
        const narrow = w < 560;
        drawNav(ctx, w - nw - 16, narrow ? 140 : 64, nw, nh, {
          ...scene.dash,
          terrain: scene.terrain,
          carX: scene.car.chassis.getPosition().x,
        });
      }
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

  /**
   * Overlays for the 3D renderer: draws onto a transparent canvas above the WebGL view.
   * Gauges, navigation and smash effects; or, in the driver's seat, the whole cabin
   * (the 3D renderer fills the mirror itself).
   */
  drawOverlay(scene: Scene): void {
    const { ctx, width: w, height: h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (scene.rain > 0) drawRain(ctx, w, h, scene.time, scene.rain);
    if (scene.cockpit) {
      this.drawCabinView(scene, scene.cockpit, false);
    } else {
      this.vignette();
      drawGauges(ctx, w, h, scene.gauges);
      if (scene.navMap) {
        const nw = Math.max(170, Math.min(320, w * 0.3));
        const nh = Math.round(nw * 0.46);
        drawNav(ctx, w - nw - 16, w < 560 ? 140 : 64, nw, nh, { ...scene.dash, terrain: scene.terrain, carX: scene.car.chassis.getPosition().x });
      }
    }
    if (scene.smash !== null) drawSmash(ctx, w, h, scene.smash);
  }

  /** Everything inside the car over the outside view: glass (rain, wipers, glare), hood, cabin. */
  private drawCabinView(scene: Scene, st: CockpitState, drawMirrorImage: boolean): void {
    const { ctx, width: w, height: h } = this;
    const map = scene.terrain.map;
    const light = cabinLight(nightOf(scene), map.wet ?? 0);
    const style = scene.interior ?? DEFAULT_STYLE;
    drawGlass(ctx, w, h, st.speedKmh, scene.time);
    drawGlassLight(ctx, w, h, style.dash[1], light);
    if (scene.rain > 0) drawRainGlass(ctx, w, h, scene.time, scene.rain, st.speedKmh);
    drawHood(ctx, w, h, litColor(bodyColor(scene.car.def.parts), light));
    this.drawCockpit(scene, st, drawMirrorImage);
  }

  /** Inside-the-car overlay: cabin, live rear-view mirror showing the egg, dashboard and wheel. */
  private drawCockpit(scene: Scene, st: CockpitState, drawMirrorImage = true): void {
    const { ctx, width: w, height: h } = this;
    const map = scene.terrain.map;
    const light = cabinLight(nightOf(scene), map.wet ?? 0);
    const style = litStyle(scene.interior ?? DEFAULT_STYLE, light);
    drawCabin(ctx, w, h, style);
    const mirror = mirrorRect(w, h);
    if (drawMirrorImage) this.drawMirror(scene, mirror);
    drawMirrorFrame(ctx, mirror, st, style);
    // Door mirrors (the 3D renderer fills their glass itself)
    const sides = sideMirrorRects(w, h);
    for (const side of ["left", "right"] as const) {
      if (drawMirrorImage) this.drawMirror(scene, sides[side]);
      drawSideMirrorFrame(ctx, sides[side], side);
    }
    // Red pulse around the edges when the egg is about to fall out
    if (scene.dash.egg === "danger") {
      const a = 0.18 + 0.14 * Math.sin(performance.now() / 90);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, "rgba(255,40,30,0)");
      g.addColorStop(1, `rgba(255,40,30,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    drawDashboard(ctx, w, h, st, { ...scene.dash, terrain: scene.terrain, carX: scene.car.chassis.getPosition().x }, style);
    // Instruments are backlit: they glow in a dark cabin
    if (light.night) drawInstrumentGlow(ctx, w, h, (scene.interior ?? DEFAULT_STYLE).accent);
    drawDashToy(ctx, w, h, st, style);
    drawSteeringWheel(ctx, w, h, st, style);
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
    if (t.obstacles.length) this.drawSkyObstacles(t, scene.time, left, right);
    if (full) this.drawMarkers(t, left, right);
    this.drawFinish(t, left, right);
    this.drawCoins(scene, left, right);
    this.drawPowerUps(scene, left, right);
    if (scene.ghost?.pose) this.drawGhost(scene.ghost.def, scene.ghost.pose);
    for (const r of scene.rivals) {
      const x = r.car.chassis.getPosition().x;
      if (x < left - 6 || x > right + 6) continue;
      this.drawCar(r.car);
      if (!r.eggBroken) this.withBody(r.car.egg, () => drawEggShape(this.ctx));
      this.drawNameTag(r);
    }
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

  /** Balloons, floating islands and storm clouds (sky terrains). */
  private drawSkyObstacles(terrain: Terrain, time: number, left: number, right: number): void {
    const { ctx } = this;
    for (const o of terrain.obstacles) {
      if (o.x + o.size + 2 < left || o.x - o.size - 2 > right) continue;
      if (o.kind === "balloon") drawBalloon(ctx, o, time);
      else if (o.kind === "island") drawIsland(ctx, o);
      else drawStorm(ctx, o, time, terrain.height(o.x));
    }
  }

  private drawTerrain(terrain: Terrain, left: number, right: number, bottom: number, full: boolean): void {
    const { ctx } = this;
    const map = viewMap(terrain.map, (left + right) / 2);
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
    // Conveyor belt: rib marks along the top that move forward at the belt speed
    if (map.conveyor) {
      ctx.save();
      ctx.lineWidth = 0.22;
      ctx.strokeStyle = "#5a5d63";
      ctx.setLineDash([0.12, 0.28]);
      ctx.lineDashOffset = -((performance.now() / 1000) * map.conveyor) % 0.4;
      ctx.stroke(surface);
      ctx.restore();
    }

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

      // Steel truss under the deck: legs with diagonal cross-bracing
      const legs: number[] = [];
      for (let x = start + 1.4; x <= lip + 0.001; x += 1.4) legs.push(Math.min(x, lip - 0.08));
      ctx.lineCap = "butt";
      legs.forEach((x, i) => {
        const top = terrain.height(x) - 0.1;
        ctx.fillStyle = "#7d838c";
        ctx.fillRect(x - 0.06, base - 0.1, 0.12, top - base + 0.1);
        const prev = legs[i - 1];
        if (prev !== undefined) {
          ctx.strokeStyle = "#6a7079";
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(x, base);
          ctx.lineTo(prev, terrain.height(prev) - 0.1);
          ctx.stroke();
        }
      });
      // End frame at the lip
      ctx.fillStyle = "#5b616a";
      ctx.fillRect(lip - 0.05, base - 0.1, 0.1, terrain.height(lip) - base + 0.1);
      // Thick steel deck with a bright top edge and tread marks
      const deck = new Path2D();
      deck.moveTo(start, terrain.height(start));
      for (let x = start + 0.25; x <= lip + 0.001; x += 0.25) deck.lineTo(x, terrain.height(x) + 0.02);
      ctx.lineWidth = 0.32;
      ctx.strokeStyle = "#4a4f57";
      ctx.stroke(deck);
      ctx.lineWidth = 0.2;
      ctx.strokeStyle = "#a3aab3";
      ctx.stroke(deck);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = "#dfe3e8";
      ctx.save();
      ctx.translate(0, 0.07);
      ctx.stroke(deck);
      ctx.restore();
      ctx.fillStyle = "rgba(40,44,50,0.55)";
      for (let x = start + 0.3; x < lip; x += 0.35) ctx.fillRect(x, terrain.height(x) - 0.03, 0.12, 0.04);
      // Yellow/black hazard stripe on the lip
      const ly = terrain.height(lip);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? "#1c1c1f" : "#f5c400";
        ctx.fillRect(lip - 0.12, ly - 0.15 * (k + 1), 0.24, 0.15);
      }

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
      if (pu.kind === "glue") drawGlueBottle(ctx, scene.time);
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

    // Rocket flame out of the back (drawn behind the body)
    if (def.rocket && car.rocketOn > 0.02) {
      const rk = def.rocket;
      this.withBody(car.chassis, () => {
        const len = (0.6 + car.rocketOn * 1.6) * (0.85 + Math.random() * 0.3);
        const g = ctx.createLinearGradient(rk.x, 0, rk.x - len, 0);
        g.addColorStop(0, "rgba(220, 240, 255, 0.95)");
        g.addColorStop(0.25, "rgba(255, 200, 80, 0.9)");
        g.addColorStop(0.7, "rgba(255, 110, 30, 0.6)");
        g.addColorStop(1, "rgba(255, 80, 20, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(rk.x, rk.y + 0.14);
        ctx.quadraticCurveTo(rk.x - len * 0.5, rk.y + 0.2, rk.x - len, rk.y);
        ctx.quadraticCurveTo(rk.x - len * 0.5, rk.y - 0.2, rk.x, rk.y - 0.14);
        ctx.closePath();
        ctx.fill();
      });
    }

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

  /** Rival's name floating above their car. */
  private drawNameTag(r: RivalView): void {
    const { ctx } = this;
    const p = r.car.chassis.getPosition();
    ctx.save();
    ctx.translate(p.x, p.y + 2.1);
    ctx.scale(0.022, -0.022);
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = r.eggBroken ? `💥 ${r.name}` : r.name;
    const w = ctx.measureText(label).width + 16;
    ctx.fillStyle = "rgba(20, 24, 32, 0.6)";
    ctx.beginPath();
    ctx.roundRect(-w / 2, -13, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, 0, 1);
    ctx.restore();
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
const GRASSY = new Set(["countryside", "autumn", "jungle", "swamp", "savanna", "sakura"]);

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

export function hash(i: number): number {
  const r = Math.sin(i * 12.9898) * 43758.5453;
  return r - Math.floor(r);
}

/** Parses "#rrggbb" or "rgb(r, g, b)" into [r, g, b]. */
function rgbOf(c: string): [number, number, number] {
  if (c.startsWith("#")) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/\d+(\.\d+)?/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
}

/** Blends color a toward b by t (0..1). Accepts hex or rgb() colors. */
export function mixColor(a: string, b: string, t: number): string {
  const ca = rgbOf(a);
  const cb = rgbOf(b);
  const m = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

/** Paints the sky, sun/planet, stars, clouds, haze, sea and distant hills in screen space. */
/**
 * The sky and distant scenery. With `backdropOnly` (3D, where a shader sky dome draws the
 * gradient, sun, clouds and stars) only the far layers are painted, on a transparent canvas.
 */
export function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, map: MapDef, time: number, camXpx: number, camYpx: number, backdropOnly = false): void {
  if (backdropOnly) {
    ctx.clearRect(0, 0, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, map.sky[0]);
    g.addColorStop(0.7, map.sky[1]);
    g.addColorStop(1, map.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const scale = Math.min(1, h / 600);

  if (map.stars && !backdropOnly) {
    for (let i = 0; i < 120; i++) {
      const x = (((hash(i) * w * 3 - camXpx * 0.02) % w) + w) % w;
      const y = hash(i + 500) * h * 0.75;
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.65 * tw * hash(i + 99)})`;
      const sz = hash(i + 7) > 0.9 ? 2.5 : 1.5;
      ctx.fillRect(x, y, sz, sz);
    }
  }

  // Sun with a wide soft glow (in 3D the sky dome draws the sun; a planet is still painted here)
  if (!backdropOnly || map.planet) paintSun(ctx, w, h, map, scale);
  if (map.clouds && !backdropOnly) {
    const span = w + 400;
    for (let i = 0; i < 7; i++) {
      const depth = 0.03 + (i % 3) * 0.025;
      const base = i * 377 + time * (4 + (i % 3) * 3) - camXpx * depth;
      const x = (((base % span) + span) % span) - 200;
      const y = (40 + ((i * 97) % 180)) * Math.max(0.5, scale);
      const k = (0.6 + ((i * 31) % 10) / 14) * Math.max(0.6, scale);
      cloud(ctx, x, y, k, map.clouds, i);
    }
  }
  paintBackdrop(ctx, w, h, map, time, camXpx, camYpx, scale);
}

function paintSun(ctx: CanvasRenderingContext2D, w: number, h: number, map: MapDef, scale: number): void {
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
}

/** Far mountains, sea, skyline, near hills, haze and snow: the distant scenery layers. */
function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, map: MapDef, time: number, camXpx: number, camYpx: number, scale: number): void {
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
  if (map.skyline) drawSkyline(ctx, w, h, camXpx * 0.25, map.skyline, time);
  if (map.decor === "robot") drawWalkingRobots(ctx, w, h, camXpx * 0.3, scale);
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
  if (map.dust) {
    // Dust storm: streaks blowing sideways
    ctx.fillStyle = map.dust;
    for (let i = 0; i < 90; i++) {
      const speed = 60 + hash(i) * 120;
      const x = (((hash(i + 7) * w * 2 - time * speed - camXpx * 0.5) % w) + w) % w;
      const y = (((hash(i + 13) * h + Math.sin(time * 0.7 + i) * 20) % h) + h) % h;
      ctx.fillRect(x, y, 3 + hash(i + 3) * 6, 1.5);
    }
  }
  if (map.bubbles) {
    ctx.strokeStyle = "rgba(220, 245, 255, 0.55)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 50; i++) {
      const speed = 25 + hash(i) * 45;
      const x = (((hash(i + 7) * w * 2 + Math.sin(time * 2 + i) * 6 - camXpx * 0.3) % w) + w) % w;
      const y = h - ((((hash(i + 13) * h + time * speed) % h) + h) % h);
      ctx.beginPath();
      ctx.arc(x, y, 2 + hash(i + 3) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Light rays from the surface
    ctx.fillStyle = "rgba(220, 245, 255, 0.05)";
    for (let i = 0; i < 5; i++) {
      const x = (((i * 260 + Math.sin(time * 0.3 + i) * 40 - camXpx * 0.05) % (w + 300)) + w + 300) % (w + 300) - 150;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 70, 0);
      ctx.lineTo(x + 170, h);
      ctx.lineTo(x + 40, h);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (map.mist) {
    for (let i = 0; i < 4; i++) {
      const y = h * (0.62 + i * 0.09);
      const off = (((time * (8 + i * 5) - camXpx * (0.2 + i * 0.1)) % (w * 2)) + w * 2) % (w * 2);
      const g = ctx.createLinearGradient(0, y - 30, 0, y + 30);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(240,248,240,0.16)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-off, y - 30, w * 3, 60);
    }
  }
  if (map.leaves) {
    const colors = map.leafColors ?? ["#e0782a", "#c94f1f", "#f2b33d", "#a8662a"];
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

/**
 * A soft, fluffy cumulus: overlapping puffs, each lit from above (a bright top fading into a
 * slightly shaded underside), with a flat-ish base like real fair-weather clouds.
 */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, color: string, seed: number): void {
  const [r, g, b, a] = rgbaOf(color);
  const puffs = 6;
  for (let i = 0; i < puffs; i++) {
    const t = i / (puffs - 1);
    const px = x + (t * 70 - 6) * k;
    const lift = Math.sin(t * Math.PI) * (16 + hash(seed * 7 + i) * 10);
    const pr = (14 + Math.sin(t * Math.PI) * 14 + hash(seed * 13 + i) * 6) * k;
    const py = y - lift * k + pr * 0.35;
    const grad = ctx.createRadialGradient(px - pr * 0.25, py - pr * 0.45, pr * 0.1, px, py, pr);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 20)},${Math.min(255, g + 20)},${Math.min(255, b + 22)},${a})`);
    grad.addColorStop(0.65, `rgba(${r},${g},${b},${a * 0.95})`);
    grad.addColorStop(1, `rgba(${Math.round(r * 0.82)},${Math.round(g * 0.84)},${Math.round(b * 0.9)},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** "rgba(…)" / "rgb(…)" / "#rrggbb" → [r, g, b, alpha]. */
function rgbaOf(c: string): [number, number, number, number] {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  const hex = c.replace("#", "");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
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
export function drawDecor(ctx: CanvasRenderingContext2D, map: MapDef, x: number, y: number, k: number): void {
  const [c1, c2] = map.decorColors;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  switch (map.decor) {
    case "robot": {
      // Robotic arm, side-on: base, upper arm, forearm and gripper, swinging as it works
      const t = performance.now() / 1000 + x * 0.37;
      const [paint, dark] = map.decorColors;
      const sh = -0.3 + Math.sin(t) * 0.35;
      const el = 1.2 + Math.sin(t * 1.3 + 1) * 0.4;
      ctx.fillStyle = dark;
      ctx.fillRect(-0.4, 0, 0.8, 0.2);
      ctx.fillStyle = paint;
      ctx.fillRect(-0.25, 0.2, 0.5, 0.4);
      ctx.save();
      ctx.translate(0, 0.65);
      ctx.rotate(sh);
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(0, 0, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = paint;
      ctx.fillRect(-0.11, 0, 0.22, 1.2);
      ctx.translate(0, 1.2);
      ctx.rotate(-el);
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(0, 0, 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = paint;
      ctx.fillRect(-0.08, 0, 0.16, 1.0);
      ctx.translate(0, 1.0);
      ctx.fillStyle = "#c9ced6";
      ctx.fillRect(-0.12, 0, 0.24, 0.16);
      const grip = 0.04 + Math.max(0, Math.sin(t * 2.1)) * 0.06;
      ctx.fillStyle = dark;
      ctx.fillRect(-grip - 0.04, 0.16, 0.04, 0.2);
      ctx.fillRect(grip, 0.16, 0.04, 0.2);
      ctx.restore();
      break;
    }
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
    case "jungle": {
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.moveTo(-0.14, 0);
      ctx.lineTo(0.14, 0);
      ctx.lineTo(0.08, 2.0);
      ctx.lineTo(-0.08, 2.0);
      ctx.fill();
      const blobs: [number, number, number][] = [
        [0, 2.2, 0.55],
        [-0.6, 2.0, 0.45],
        [0.6, 2.0, 0.45],
        [-0.25, 2.55, 0.4],
        [0.3, 2.5, 0.4],
      ];
      for (const [bx, by, br] of blobs) {
        const g = ctx.createRadialGradient(bx - br * 0.3, by + br * 0.35, 0, bx, by, br);
        g.addColorStop(0, mixColor(c2, "#ffffff", 0.2));
        g.addColorStop(1, mixColor(c2, "#000000", 0.35));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(bx, by, br * 1.2, br * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Hanging vines
      ctx.strokeStyle = mixColor(c2, "#000000", 0.2);
      ctx.lineWidth = 0.04;
      for (const vx of [-0.7, -0.3, 0.45, 0.8]) {
        ctx.beginPath();
        ctx.moveTo(vx, 1.9);
        ctx.quadraticCurveTo(vx + 0.1, 1.4, vx - 0.05, 0.9 + Math.abs(vx) * 0.3);
        ctx.stroke();
      }
      break;
    }
    case "lamp": {
      ctx.fillStyle = c1;
      ctx.fillRect(-0.05, 0, 0.1, 2.6);
      ctx.fillRect(-0.05, 2.5, 0.6, 0.07);
      const glow = ctx.createRadialGradient(0.55, 2.4, 0, 0.55, 2.4, 1.1);
      glow.addColorStop(0, "rgba(255,233,160,0.55)");
      glow.addColorStop(1, "rgba(255,233,160,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0.55, 2.4, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.ellipse(0.55, 2.43, 0.16, 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "reed": {
      ctx.lineCap = "round";
      for (const [dx, hgt, lean] of [
        [-0.25, 1.1, -0.15],
        [-0.08, 1.4, -0.05],
        [0.08, 1.25, 0.08],
        [0.25, 0.95, 0.18],
      ]) {
        const tx = dx + lean;
        ctx.strokeStyle = c1;
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        ctx.moveTo(dx, 0);
        ctx.quadraticCurveTo(dx, hgt * 0.6, tx, hgt);
        ctx.stroke();
        ctx.strokeStyle = c2;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(tx - lean * 0.1, hgt - 0.28);
        ctx.lineTo(tx, hgt - 0.04);
        ctx.stroke();
      }
      break;
    }
    case "lollipop": {
      ctx.fillStyle = "#fff8ee";
      ctx.fillRect(-0.05, 0, 0.1, 1.5);
      const r = 0.55;
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(0, 1.9, r, 0, Math.PI * 2);
      ctx.fill();
      // Swirl
      ctx.strokeStyle = c1;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.2) {
        const rr = (a / (Math.PI * 6)) * r * 0.9;
        const px = Math.cos(a) * rr;
        const py = 1.9 + Math.sin(a) * rr;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.ellipse(-0.2, 2.12, 0.14, 0.08, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "spire": {
      const g = ctx.createLinearGradient(-0.4, 0, 0.4, 0);
      g.addColorStop(0, c2);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-0.45, 0);
      ctx.lineTo(-0.25, 0.9);
      ctx.lineTo(-0.32, 1.1);
      ctx.lineTo(-0.12, 2.0);
      ctx.lineTo(0.05, 2.2);
      ctx.lineTo(0.15, 1.5);
      ctx.lineTo(0.3, 1.2);
      ctx.lineTo(0.45, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 0.04;
      for (const yy of [0.4, 0.95, 1.5]) {
        ctx.beginPath();
        ctx.moveTo(-0.4 + yy * 0.18, yy);
        ctx.lineTo(0.38 - yy * 0.14, yy);
        ctx.stroke();
      }
      break;
    }
    case "acacia": {
      ctx.strokeStyle = c1;
      ctx.lineCap = "round";
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0.05, 1.1);
      ctx.lineTo(-0.5, 1.75);
      ctx.moveTo(0.05, 1.1);
      ctx.lineTo(0.55, 1.8);
      ctx.stroke();
      const g = ctx.createLinearGradient(0, 2.1, 0, 1.65);
      g.addColorStop(0, mixColor(c2, "#ffffff", 0.15));
      g.addColorStop(1, mixColor(c2, "#000000", 0.3));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 1.85, 1.2, 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "sakura": {
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.moveTo(-0.12, 0);
      ctx.lineTo(0.12, 0);
      ctx.quadraticCurveTo(0.05, 0.7, 0.18, 1.2);
      ctx.lineTo(0.02, 1.2);
      ctx.quadraticCurveTo(-0.05, 0.7, -0.12, 0);
      ctx.fill();
      for (const [bx, by, br] of [
        [0, 1.45, 0.55],
        [-0.45, 1.25, 0.4],
        [0.5, 1.3, 0.42],
        [-0.15, 1.8, 0.38],
        [0.3, 1.75, 0.36],
      ] as [number, number, number][]) {
        const g = ctx.createRadialGradient(bx - br * 0.3, by + br * 0.3, 0, bx, by, br);
        g.addColorStop(0, mixColor(c2, "#ffffff", 0.45));
        g.addColorStop(1, mixColor(c2, "#c0507a", 0.3));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "deadtree": {
      ctx.strokeStyle = c1;
      ctx.lineCap = "round";
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(0.1, 0.8, -0.05, 1.6);
      ctx.stroke();
      ctx.lineWidth = 0.07;
      for (const [x0, y0, x1, y1, x2, y2] of [
        [0.0, 1.0, 0.45, 1.3, 0.75, 1.25],
        [0.02, 1.25, -0.4, 1.6, -0.7, 1.55],
        [-0.04, 1.5, 0.2, 1.95, 0.45, 2.05],
        [-0.05, 1.6, -0.3, 2.0, -0.25, 2.2],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x1, y1, x2, y2);
        ctx.stroke();
      }
      // A little gravestone at the foot of the tree
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.moveTo(0.45, 0);
      ctx.lineTo(0.45, 0.35);
      ctx.arc(0.62, 0.35, 0.17, Math.PI, 0);
      ctx.lineTo(0.79, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(0.62, 0.2);
      ctx.lineTo(0.62, 0.42);
      ctx.moveTo(0.54, 0.34);
      ctx.lineTo(0.7, 0.34);
      ctx.stroke();
      break;
    }
    case "coral": {
      ctx.lineCap = "round";
      // Branching coral
      ctx.strokeStyle = c1;
      ctx.lineWidth = 0.13;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 0.6);
      ctx.lineTo(-0.35, 1.05);
      ctx.moveTo(0, 0.6);
      ctx.lineTo(0.3, 1.15);
      ctx.moveTo(-0.15, 0.82);
      ctx.lineTo(-0.1, 1.25);
      ctx.moveTo(0.15, 0.85);
      ctx.lineTo(0.45, 0.95);
      ctx.stroke();
      // Fan coral and seaweed
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.ellipse(0.6, 0.32, 0.3, 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2f8a5a";
      ctx.lineWidth = 0.06;
      for (const sx of [-0.55, -0.45]) {
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.bezierCurveTo(sx - 0.2, 0.5, sx + 0.2, 0.9, sx - 0.05, 1.4);
        ctx.stroke();
      }
      break;
    }
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
/**
 * Super-glue bottle (1 unit ≈ 1 m, y up): a glossy curvy white bottle with an electric-blue label
 * (lightning bolt + "GLUE"), a clear window showing the amber glue, a red cap with a ribbed collar
 * and long nozzle, a shiny drip, and twinkling sparkles around it.
 */
export function drawGlueBottle(ctx: CanvasRenderingContext2D, time = 0): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const ink = "#1b2233";
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = ink;

  // Nozzle (long and pointed) and ribbed red cap collar
  const cap = ctx.createLinearGradient(-0.14, 0, 0.14, 0);
  cap.addColorStop(0, "#ff6a5a");
  cap.addColorStop(0.45, "#e2241b");
  cap.addColorStop(1, "#8f120c");
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.moveTo(-0.025, 0.78);
  ctx.lineTo(0.025, 0.78);
  ctx.lineTo(0.08, 0.48);
  ctx.lineTo(-0.08, 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-0.15, 0.32, 0.3, 0.17, 0.04);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 0.018;
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.moveTo(k * 0.05, 0.34);
    ctx.lineTo(k * 0.05, 0.47);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(-0.12, 0.44, 0.24, 0.025);

  // Bottle: curvy shoulders, glossy white
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.035;
  const body = new Path2D();
  body.moveTo(-0.14, 0.32);
  body.bezierCurveTo(-0.3, 0.28, -0.32, 0.12, -0.31, -0.02);
  body.lineTo(-0.3, -0.42);
  body.quadraticCurveTo(-0.3, -0.52, -0.2, -0.52);
  body.lineTo(0.2, -0.52);
  body.quadraticCurveTo(0.3, -0.52, 0.3, -0.42);
  body.lineTo(0.31, -0.02);
  body.bezierCurveTo(0.32, 0.12, 0.3, 0.28, 0.14, 0.32);
  body.closePath();
  const white = ctx.createLinearGradient(-0.32, 0, 0.32, 0);
  white.addColorStop(0, "#ffffff");
  white.addColorStop(0.55, "#eef2f8");
  white.addColorStop(1, "#b9c2d0");
  ctx.fillStyle = white;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // Clear window with the amber glue inside (sloshing gently)
  const level = 0.12 + Math.sin(time * 3) * 0.015;
  ctx.fillStyle = "rgba(190, 215, 240, 0.55)";
  ctx.fillRect(-0.32, 0.08, 0.64, 0.16);
  const glue = ctx.createLinearGradient(0, -0.1, 0, level);
  glue.addColorStop(0, "#ff9d00");
  glue.addColorStop(1, "#ffd25a");
  ctx.fillStyle = glue;
  ctx.fillRect(-0.32, 0.08, 0.64, level - 0.08 + 0.01);
  // Electric-blue label
  const label = ctx.createLinearGradient(0, -0.4, 0, 0.06);
  label.addColorStop(0, "#1546b8");
  label.addColorStop(0.5, "#2f7ae5");
  label.addColorStop(1, "#5fb0ff");
  ctx.fillStyle = label;
  ctx.fillRect(-0.32, -0.42, 0.64, 0.48);
  // Yellow lightning bolt across the label
  ctx.fillStyle = "#ffd60a";
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(0.06, 0.04);
  ctx.lineTo(-0.14, -0.15);
  ctx.lineTo(-0.02, -0.15);
  ctx.lineTo(-0.08, -0.38);
  ctx.lineTo(0.14, -0.13);
  ctx.lineTo(0.02, -0.13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // "GLUE" lettering (drawn upright)
  ctx.save();
  ctx.scale(1, -1);
  ctx.font = "900 0.13px Fredoka, 'Arial Rounded MT Bold', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = ink;
  ctx.strokeText("GLUE", 0, 0.33);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("GLUE", 0, 0.33);
  ctx.restore();
  // Gloss streak down the left side
  const gloss = ctx.createLinearGradient(-0.26, 0, -0.14, 0);
  gloss.addColorStop(0, "rgba(255,255,255,0)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0.85)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(-0.26, -0.46, 0.12, 0.72);
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.035;
  ctx.stroke(body);

  // A glossy drip of glue running down from the nozzle tip over the cap
  const drip = ctx.createLinearGradient(0, 0.8, 0, 0.3);
  drip.addColorStop(0, "#ffd25a");
  drip.addColorStop(1, "#ff9d00");
  ctx.fillStyle = drip;
  ctx.beginPath();
  ctx.moveTo(0.0, 0.79);
  ctx.quadraticCurveTo(0.09, 0.62, 0.07, 0.42);
  ctx.arc(0.07, 0.38, 0.045, Math.PI / 2, Math.PI * 2.5);
  ctx.quadraticCurveTo(0.05, 0.6, -0.01, 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(0.06, 0.39, 0.012, 0, Math.PI * 2);
  ctx.fill();

  // Twinkling sparkles
  for (let k = 0; k < 4; k++) {
    const a = time * 1.6 + k * 1.57;
    const tw = 0.5 + 0.5 * Math.sin(time * 5 + k * 2.1);
    const sx = Math.cos(a) * 0.48;
    const sy = 0.05 + Math.sin(a * 1.3) * 0.42;
    const r = 0.035 + tw * 0.045;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + tw * 0.65})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy + r);
    ctx.lineTo(sx + r * 0.25, sy + r * 0.25);
    ctx.lineTo(sx + r, sy);
    ctx.lineTo(sx + r * 0.25, sy - r * 0.25);
    ctx.lineTo(sx, sy - r);
    ctx.lineTo(sx - r * 0.25, sy - r * 0.25);
    ctx.lineTo(sx - r, sy);
    ctx.lineTo(sx - r * 0.25, sy + r * 0.25);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
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
  const rpmFrac = Math.min(1, g.rpm / (g.redline * 1.05));
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
  // Speed ticks: a tick every 10 units, 0–140 km/h or 0–90 mph
  const speed = g.mph ? g.kmh * KMH_TO_MPH : g.kmh;
  const maxSpeed = g.mph ? 90 : 140;
  const ticks = maxSpeed / 10;
  for (let k = 0; k <= ticks; k++) {
    const a = a0 + (span * k) / ticks;
    const major = k % 2 === 0;
    ctx.strokeStyle = "#e6e9f0";
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * (major ? 0.68 : 0.73), cy + Math.sin(a) * r * (major ? 0.68 : 0.73));
    ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.stroke();
  }
  const na = a0 + (span * Math.min(maxSpeed, speed)) / maxSpeed;
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
  ctx.fillText(String(Math.round(speed)), cx, cy + r * 0.32);
  ctx.font = `${Math.round(r * 0.15)}px Trebuchet MS, sans-serif`;
  ctx.fillStyle = "#9aa0ad";
  ctx.fillText(g.mph ? "mph" : "km/h", cx, cy + r * 0.56);
  ctx.fillStyle = "#4fc3ff";
  ctx.font = `bold ${Math.round(r * 0.2)}px Trebuchet MS, sans-serif`;
  ctx.fillText(g.rpm > 0 ? `${g.gear + 1}` : "–", cx, cy - r * 0.36);

  // Gyro to the left of the speedo
  const gr = r * 0.62;
  drawGyro(ctx, cx - r - 22 - gr, cy - r * 0.1, gr, g.attitude);

  // Fuel gauge beside the speedo (hidden when fuel is switched off)
  if (g.fuel < 0) return;
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

/** City skyline silhouettes with a few lit windows (screen space, parallax-scrolled). */
function drawSkyline(ctx: CanvasRenderingContext2D, w: number, h: number, off: number, color: string, time: number): void {
  const base = h * 0.74;
  const bw = 46;
  const start = Math.floor(off / bw) - 1;
  for (let i = start; i < start + w / bw + 3; i++) {
    const x = i * bw - off;
    const bh = 60 + hash(i * 1.7) * 170;
    const width = bw * (0.7 + hash(i * 2.3) * 0.3);
    ctx.fillStyle = color;
    ctx.fillRect(x, base - bh, width, bh + 2);
    // Antenna on some towers
    if (hash(i * 5.1) > 0.75) ctx.fillRect(x + width / 2 - 1, base - bh - 18, 2, 18);
    // Windows
    for (let wy = base - bh + 8; wy < base - 6; wy += 11) {
      for (let wx = x + 5; wx < x + width - 6; wx += 9) {
        const lit = hash(wx * 0.37 + wy * 1.13 + i) > 0.62;
        if (!lit) continue;
        const flicker = hash(Math.floor(time * 0.2) + wx + wy) > 0.97 ? 0.3 : 1;
        ctx.fillStyle = `rgba(255, 220, 140, ${0.75 * flicker})`;
        ctx.fillRect(wx, wy, 4, 5);
      }
    }
  }
}

/**
 * Falling rain over the view: a cool grey wash and slanted streaks, all in one path (cheap).
 * Streak positions come from a hash of their index, so nothing is stored between frames.
 */
export function drawRain(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, k: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(28, 36, 50, ${0.14 * k})`;
  ctx.fillRect(0, 0, w, h);
  const n = Math.round(90 + 150 * k);
  ctx.strokeStyle = "rgba(205, 218, 235, 0.38)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const speed = 900 + hash(i * 3.1) * 500;
    const len = 14 + hash(i * 7.7) * 18;
    const y = ((hash(i * 1.3) * (h + 60) + time * speed) % (h + 60)) - 30;
    const x = ((hash(i * 5.9) * (w + 120) - time * speed * 0.18) % (w + 120) + (w + 120)) % (w + 120) - 60;
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.18, y + len);
  }
  ctx.stroke();
  ctx.restore();
}

/** How dark it is outside: 1 on night terrains, following the clock where there's a day/night cycle. */
export function nightOf(scene: Scene): number {
  if (viewMap(scene.terrain.map, scene.car.chassis.getPosition().x).stars) return 1;
  return scene.dayTime === null ? 0 : daylight(scene.dayTime).night;
}

/** Classic 2D: a warm wash at sunset and a deep blue one at night over the world. */
function drawDayTint(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  if (scene.dayTime === null) return;
  const d = daylight(scene.dayTime);
  const golden = d.dusk * 0.85 * (1 - d.night);
  if (golden > 0.02) {
    ctx.fillStyle = `rgba(255, 130, 60, ${0.16 * golden})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (d.night > 0.02) {
    ctx.fillStyle = `rgba(6, 10, 32, ${0.62 * d.night})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Distance sign artwork: a road sign with a reflective white border and bold lettering.
 * Every 50 m a green sign; every 250 m a bigger blue milestone sign with an egg badge.
 */
export function paintDistanceSign(g: CanvasRenderingContext2D, w: number, h: number, meters: number): void {
  const milestone = meters % 250 === 0;
  const r = h * 0.16;
  const face = milestone ? "#1d5fb8" : "#1f7a3f";
  g.clearRect(0, 0, w, h);
  // Panel with a soft vertical sheen (reflective sheeting)
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, shade(face, 1.18));
  grad.addColorStop(0.5, face);
  grad.addColorStop(1, shade(face, 0.82));
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(0, 0, w, h, r);
  g.fill();
  // White border, inset
  const b = h * 0.07;
  g.strokeStyle = "#ffffff";
  g.lineWidth = h * 0.05;
  g.beginPath();
  g.roundRect(b, b, w - b * 2, h - b * 2, r * 0.7);
  g.stroke();
  // Egg badge on milestones
  let textX = w / 2;
  if (milestone) {
    const ex = w * 0.17;
    const ey = h * 0.52;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(ex, ey, h * 0.17, h * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = face;
    g.beginPath();
    g.ellipse(ex - h * 0.05, ey - h * 0.07, h * 0.04, h * 0.06, -0.4, 0, Math.PI * 2);
    g.fill();
    textX = w * 0.6;
  }
  // Lettering
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const label = meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 2)} km` : `${meters} m`;
  let size = h * 0.48;
  g.font = `700 ${size}px Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
  const maxW = (milestone ? w * 0.66 : w * 0.82);
  while (g.measureText(label).width > maxW && size > 8) {
    size *= 0.92;
    g.font = `700 ${size}px Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", sans-serif`;
  }
  g.fillText(label, textX, h * 0.54);
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Background silhouettes of factory robots walking across the hall (2D views). */
function drawWalkingRobots(ctx: CanvasRenderingContext2D, w: number, h: number, off: number, scale: number): void {
  const t = performance.now() / 1000;
  const span = w + 200;
  for (let i = 0; i < 6; i++) {
    const dir = hash(i * 9.1) > 0.5 ? 1 : -1;
    const speed = 18 + hash(i * 5.7) * 22;
    const x = ((((hash(i * 7.1) * span + dir * t * speed - off) % span) + span) % span) - 100;
    const k = (26 + hash(i * 3.3) * 18) * Math.max(0.6, scale);
    const ground = h * (0.7 + hash(i * 1.7) * 0.06);
    const phase = t * 4 + i * 2;
    const swing = Math.sin(phase) * 0.5;
    const bob = Math.abs(Math.sin(phase)) * k * 0.04;
    ctx.save();
    ctx.translate(x, ground - bob);
    ctx.scale(dir, 1);
    ctx.fillStyle = "rgba(40, 42, 48, 0.85)";
    // Legs
    for (const s of [swing, -swing]) {
      ctx.save();
      ctx.translate(0, -k * 1.0);
      ctx.rotate(s);
      ctx.fillRect(-k * 0.08, 0, k * 0.16, k * 1.0);
      ctx.restore();
    }
    // Torso, head, antenna
    ctx.fillRect(-k * 0.3, -k * 1.8, k * 0.6, k * 0.82);
    ctx.fillRect(-k * 0.2, -k * 2.18, k * 0.4, k * 0.34);
    ctx.fillRect(-k * 0.015, -k * 2.45, k * 0.03, k * 0.28);
    // Arm (one visible, swinging opposite the near leg)
    ctx.save();
    ctx.translate(0, -k * 1.7);
    ctx.rotate(-swing * 0.8);
    ctx.fillRect(-k * 0.06, 0, k * 0.12, k * 0.65);
    ctx.restore();
    // Glowing visor and antenna tip
    ctx.fillStyle = "rgba(90, 210, 255, 0.95)";
    ctx.fillRect(k * 0.08, -k * 2.1, k * 0.14, k * 0.07);
    ctx.fillStyle = "rgba(255, 80, 60, 0.95)";
    ctx.beginPath();
    ctx.arc(0, -k * 2.47, k * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---------- sky obstacles ----------

const BALLOON_COLORS: [string, string][] = [
  ["#e94b3c", "#ffd23f"],
  ["#3c8de9", "#ffffff"],
  ["#8e4be9", "#ffb13f"],
  ["#2fbf71", "#fff3b0"],
  ["#ff6fae", "#7fe0ff"],
];

/** A hot-air balloon: striped envelope, ropes and a wicker basket, swaying gently. */
function drawBalloon(ctx: CanvasRenderingContext2D, o: SkyObstacle, time: number): void {
  const r = o.size;
  const [c1, c2] = BALLOON_COLORS[Math.floor(o.seed * BALLOON_COLORS.length) % BALLOON_COLORS.length];
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(Math.sin(time * 0.8 + o.seed * 9) * 0.03);
  const basketY = -r - 1.3;
  // Ropes
  ctx.strokeStyle = "#5a4630";
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  for (const s of [-1, -0.35, 0.35, 1]) {
    ctx.moveTo(s * r * 0.45, -r * 0.88);
    ctx.lineTo(s * 0.4, basketY + 0.4);
  }
  ctx.stroke();
  // Basket
  ctx.fillStyle = "#a8743f";
  ctx.fillRect(-0.45, basketY - 0.4, 0.9, 0.8);
  ctx.strokeStyle = "#6e4721";
  ctx.lineWidth = 0.05;
  for (let y = basketY - 0.25; y < basketY + 0.4; y += 0.22) {
    ctx.beginPath();
    ctx.moveTo(-0.45, y);
    ctx.lineTo(0.45, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#6e4721";
  ctx.fillRect(-0.5, basketY + 0.32, 1, 0.12);
  // Burner flame flickers
  const fl = 0.18 + 0.1 * Math.sin(time * 23 + o.seed * 40);
  ctx.fillStyle = "rgba(255,170,40,0.9)";
  ctx.beginPath();
  ctx.ellipse(0, basketY + 0.75, 0.1, fl, 0, 0, Math.PI * 2);
  ctx.fill();
  // Envelope: teardrop with vertical gores
  const env = () => {
    ctx.beginPath();
    ctx.moveTo(-r * 0.32, -r * 0.92);
    ctx.bezierCurveTo(-r * 1.25, -r * 0.2, -r * 1.15, r * 1.05, 0, r * 1.02);
    ctx.bezierCurveTo(r * 1.15, r * 1.05, r * 1.25, -r * 0.2, r * 0.32, -r * 0.92);
    ctx.closePath();
  };
  env();
  ctx.fillStyle = c1;
  ctx.fill();
  ctx.save();
  env();
  ctx.clip();
  ctx.fillStyle = c2;
  for (const k of [-0.62, 0, 0.62]) {
    ctx.beginPath();
    ctx.ellipse(k * r, 0, r * 0.14, r * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Round shading
  const g = ctx.createRadialGradient(-r * 0.35, r * 0.4, r * 0.1, 0, 0, r * 1.2);
  g.addColorStop(0, "rgba(255,255,255,0.35)");
  g.addColorStop(0.6, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = g;
  ctx.fillRect(-r * 1.3, -r * 1.1, r * 2.6, r * 2.3);
  ctx.restore();
  env();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 0.06;
  ctx.stroke();
  ctx.restore();
}

/** A floating rock island: grassy top, layered rock underneath, a little tree and hanging vines. */
function drawIsland(ctx: CanvasRenderingContext2D, o: SkyObstacle): void {
  const pts = Terrain.islandOutline(o);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, o.y, 0, o.y - o.size * 1.2);
  g.addColorStop(0, "#9b7653");
  g.addColorStop(0.5, "#7a5a3e");
  g.addColorStop(1, "#5a4030");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(40,25,15,0.5)";
  ctx.lineWidth = 0.06;
  ctx.stroke();
  // Rock strata
  ctx.clip();
  ctx.strokeStyle = "rgba(60,40,25,0.35)";
  ctx.lineWidth = 0.08;
  for (let k = 1; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(o.x - o.size, o.y - k * o.size * 0.25);
    ctx.lineTo(o.x + o.size, o.y - k * o.size * 0.25 + 0.15);
    ctx.stroke();
  }
  ctx.restore();
  // Grass cap and vines
  ctx.fillStyle = "#5cbf45";
  ctx.fillRect(o.x - o.size, o.y - 0.28, o.size * 2, 0.32);
  ctx.fillStyle = "#7dd65a";
  ctx.fillRect(o.x - o.size, o.y - 0.06, o.size * 2, 0.12);
  ctx.strokeStyle = "#3f8f34";
  ctx.lineWidth = 0.06;
  for (let k = 0; k < 4; k++) {
    const vx = o.x - o.size * 0.7 + k * o.size * 0.45;
    ctx.beginPath();
    ctx.moveTo(vx, o.y - 0.25);
    ctx.quadraticCurveTo(vx + 0.2, o.y - 0.8, vx - 0.05, o.y - 1.2 - ((k * 37 + o.seed * 10) % 1) * 0.8);
    ctx.stroke();
  }
  // A little tree
  const tx = o.x + (o.seed - 0.5) * o.size;
  ctx.fillStyle = "#6b4423";
  ctx.fillRect(tx - 0.1, o.y, 0.2, 1.1);
  ctx.fillStyle = "#4caf3f";
  ctx.beginPath();
  ctx.arc(tx, o.y + 1.4, 0.6, 0, Math.PI * 2);
  ctx.arc(tx - 0.4, o.y + 1.1, 0.4, 0, Math.PI * 2);
  ctx.arc(tx + 0.42, o.y + 1.15, 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** A jagged lightning bolt from (x, y0) down to (x, y1), wiggling on each frame. */
function boltPath(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, time: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y0);
  const n = 9;
  for (let i = 1; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    const j = Math.sin(i * 12.9898 + Math.floor(time * 20) * 78.233) * 43758.5453;
    ctx.lineTo(x + ((j - Math.floor(j)) - 0.5) * 1.6, y);
  }
  ctx.lineTo(x, y1);
}

/** A dark storm cloud. It flickers before striking the road below with lightning. */
function drawStorm(ctx: CanvasRenderingContext2D, o: SkyObstacle, time: number, groundY: number): void {
  const phase = stormPhase(o, time);
  const flick = phase === "warn" && Math.sin(time * 40) > 0.3 ? 1 : 0;
  // Danger zone on the road
  if (phase !== "idle") {
    ctx.fillStyle = phase === "strike" ? "rgba(255,240,140,0.55)" : `rgba(255,220,90,${0.12 + flick * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(o.x, groundY + 0.05, STORM.reach, 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (phase === "strike") {
    ctx.save();
    ctx.lineJoin = "round";
    boltPath(ctx, o.x, o.y - 1.2, groundY, time);
    ctx.strokeStyle = "rgba(160,210,255,0.5)";
    ctx.lineWidth = 0.55;
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.16;
    ctx.stroke();
    ctx.restore();
  }
  // Cloud puffs
  const w = o.size;
  const base = phase === "strike" ? "#9aa3c4" : flick ? "#7d86a8" : "#4b5068";
  const puffs: [number, number, number][] = [
    [-0.75, -0.2, 0.42], [-0.35, 0.2, 0.55], [0.15, 0.3, 0.6], [0.6, 0, 0.45], [0.9, -0.3, 0.32], [-1, -0.35, 0.3], [0, -0.35, 0.5],
  ];
  ctx.fillStyle = "#353a50";
  ctx.beginPath();
  for (const [px, py, pr] of puffs) ctx.arc(o.x + px * w, o.y + py * w * 0.5 - 0.25, pr * w * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = base;
  ctx.beginPath();
  for (const [px, py, pr] of puffs) ctx.arc(o.x + px * w, o.y + py * w * 0.5, pr * w * 0.5, 0, Math.PI * 2);
  ctx.fill();
}
