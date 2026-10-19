import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Scene as GameScene } from "./render";
import { paintSky, mixColor, hash, paintDistanceSign } from "./render";
import { RAMP, FORK, BIG_COIN_VALUE, Fork, Terrain, SkyObstacle, stormPhase, STORM } from "./terrain";
import { VehicleDef } from "./vehicles";
import { MapDef, viewMap } from "./maps";
import { EGG_RX, EGG_RY_TOP, EGG_RY_BOTTOM } from "./car";
import { mirrorRect, sideMirrorRects, Rect } from "./cockpit";
import { engineFor } from "./engineSound";
import { PostFX, gradeFor, Grade } from "./postfx";
import { daylight } from "./daynight";

/**
 * 3D renderer (Three.js). Physics stays 2D: world x/y map straight to 3D x/y, and z is the
 * lateral axis across the road. The road runs through a landscape that rises into hills
 * behind it; the edge nearest the camera is a cut-away "diorama slice" showing the soil
 * layers, so the side-on chase camera always has a clear view of the car and egg.
 */

const CHUNK = 40; // meters of terrain per mesh
const STEP = 0.5; // terrain sample spacing along x
const ROAD = 2.6; // half width of the road
const NEAR_EDGE = 4.2; // cut-away edge toward the camera
const BODY_DEPTH = 1.7; // vehicle body width (z)
const AHEAD = 200;
/** Tire-track strips kept on screen at once. */
const TRACK_MAX = 1600;
/** Exhaust smoke puffs alive at once. */
const SMOKE_MAX = 260;
/** How deep tracks press into each terrain (0 = none, 1 = dark ruts). */
const TRACK_DEPTH: Record<string, number> = {
  desert: 0.55, beach: 0.5, reef: 0.45, snow: 0.6, countryside: 0.4, autumn: 0.4, savanna: 0.42, jungle: 0.45,
  swamp: 0.55, sakura: 0.35, haunted: 0.4, candy: 0.3, mars: 0.45, moon: 0.5, canyon: 0.3, volcano: 0.25, city: 0.06,
  glacier: 0.3, outback: 0.45, neon: 0.05, saltflats: 0.28, highlands: 0.42, factory: 0, sky: 0.15,
};
const BEHIND = 50;

/** Lateral columns of the terrain surface, from the near cut edge to the far hills. */
const BASE_COLS = [NEAR_EDGE, 3.4, 2.8, ROAD, -ROAD, -2.8, -3.4, -6, -10, -16, -26, -40, -60];
/** Behind-the-car views see both sides of the road: land continues toward the viewer too, with no cut-away. */
const COLS_SURROUND = [95, 62, 40, 26, 16, 10, 6, ...BASE_COLS, -95];
/** Depth rows of the cut-away face (meters below the surface) and their color index. */
const FACE_ROWS: [number, number][] = [
  [0, 0],
  [0.35, 0],
  [0.36, 1],
  [1.2, 1],
  [1.21, 2],
  [3.0, 2],
  [3.01, 3],
  [16, 3],
];

interface CameraPreset {
  offset: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const PRESETS: Record<string, CameraPreset> = {
  // Behind the car (offsets are in the car's frame: x back/forward along the road, z sideways)
  chase: { offset: new THREE.Vector3(-7.4, 3.1, 0.0), look: new THREE.Vector3(7, -0.9, 0), fov: 62 },
  drone: { offset: new THREE.Vector3(-12, 9.5, 6.5), look: new THREE.Vector3(12, 0, -1.5), fov: 55 },
  follow: { offset: new THREE.Vector3(-5.5, 3.2, 10.5), look: new THREE.Vector3(3, 0.6, 0), fov: 50 },
  // A low three-quarter view from behind and to the side, close to the action
  close: { offset: new THREE.Vector3(-4.2, 1.6, 4.6), look: new THREE.Vector3(2.2, 0.45, -0.4), fov: 54 },
  // High crane shot, angled down over the road ahead
  wide: { offset: new THREE.Vector3(-11, 10, 19), look: new THREE.Vector3(8, -0.5, -2), fov: 48 },
};

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The view being drawn: the scene, camera mode and screen rectangle (CSS px). */
interface View3D {
  scene: GameScene;
  view: string;
  rect: { x: number; y: number; w: number; h: number };
}

interface CarVisual {
  body: THREE.Group;
  wheels: THREE.Group[];
  extraWheels: THREE.Group[];
  head: THREE.Object3D | null;
  egg: THREE.Group;
  eggArmor: THREE.Mesh;
  eggGlue: THREE.Mesh;
  eggShield: THREE.Mesh;
  splat: THREE.Group | null;
  /** Tail-light materials (glow brighter under braking). */
  tails: THREE.MeshStandardMaterial[];
  /** Headlight beam on night terrains (player only). */
  beam: THREE.SpotLight | null;
  smokeTimer: number;
  /** Rocket flames (rocket cars only). */
  flames: THREE.Object3D[];
  /** Propellers (planes): spin with the engine. */
  spinners: THREE.Object3D[];
}

interface Smoke {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  dark: boolean;
}

interface CameraState {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  init: boolean;
  camera: THREE.PerspectiveCamera;
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private mirrorCam = new THREE.PerspectiveCamera(55, 2.4, 0.05, 120);
  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
  private skyCanvas = document.createElement("canvas");
  private skyTexture: THREE.CanvasTexture;
  /** Sky dome (gradient, sun, clouds, stars) drawn first, then the painted far scenery over it. */
  private skyScene = new THREE.Scene();
  private skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private backdropScene = new THREE.Scene();
  private backdropCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private skyTimer = 0;

  // Per-run state, rebuilt when the terrain changes
  private terrain: Terrain | null = null;
  private map: MapDef | null = null;
  private chunks = new Map<number, THREE.Group>();
  private cars = new Map<object, CarVisual>();
  private ghostGroup: THREE.Group | null = null;
  private ghostDef: VehicleDef | null = null;
  private items = new Map<object, THREE.Object3D>();
  private bridges = new Map<Fork, THREE.Group>();
  private featureProps = new Map<number, THREE.Group>();
  private dynamic = new THREE.Group();
  /** Tire tracks pressed into the ground (a ring buffer of flat strips). */
  private tracks: THREE.InstancedMesh;
  private trackNext = 0;
  private trackLast = new Map<object, { x: number; y: number }>();
  private smoke: Smoke[] = [];
  private frameDt = 0;
  /** Reused effect objects (dust, smoke, shell shards), so nothing is created per frame. */
  private spritePool: THREE.Sprite[] = [];
  private meshPool: THREE.Mesh[] = [];
  private spritesUsed = 0;
  private meshesUsed = 0;
  /** Bloom, color grade, vignette and grain on the finished frame. */
  private postfx: PostFX;
  /** The terrain's daytime look, which the day/night cycle blends from. */
  private dayBase: {
    sun: number;
    sunColor: THREE.Color;
    hemi: number;
    hemiColor: THREE.Color;
    env: number;
    grade: Grade;
    top: THREE.Vector3;
    mid: THREE.Vector3;
    horizon: THREE.Vector3;
    sunCol: THREE.Vector3;
    glow: THREE.Vector3;
    cloud: THREE.Vector3;
    sunSize: number;
    stars: number;
  } | null = null;
  private daylightOn = false;
  /** How dark it is right now (0 day .. 1 night), for headlights. */
  private nightLevel = 0;
  private walkers: Walker[] = [];
  /** Smoothed pitch of the camera rig (follows the slope). */
  private camPitch = 0;
  /** How far the side cameras have swung round toward the back of the car (radians). */
  private camSwing = 0;
  /** Extra camera height while the car is in the air. */
  private camLift = 0;
  /** Extra camera height to stay clear of the ground and see over hills. */
  private camGroundLift = 0;
  /** The world is built all around the road (set on the first frame). */
  private surround = false;
  /** Side-on camera: the near side is low open fields, so it never blocks the view. */
  private sideView = false;
  /** Soft contact shadows under each car (shared texture, one plane per car). */
  private blobShadows = new Map<object, THREE.Mesh>();
  /** Automatic resolution: scales the pixel count down when frames get slow, back up when there's room. */
  private resScale = 1;
  private frameAvg = 16;
  private resTimer = 0;
  private cam: CameraState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false, camera: new THREE.PerspectiveCamera(50, 1, 0.1, 600) };
  private last = performance.now();
  private width = 1;
  private height = 1;
  private glowTex = glowTexture();
  /** "high" = reflections, grass, big shadows, full resolution; "fast" for slower devices. */
  private quality: "high" | "fast" = "high";
  private envMap: THREE.Texture | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    // Filmic tone mapping and image-based lighting: paint, chrome and glass reflect their surroundings.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
    SHARED_MATS.add(POST_MAT);
    GLOW_TEX_REF.tex = this.glowTex;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.skyCanvas.width = 768;
    this.skyCanvas.height = 384;
    this.skyTexture = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = null;
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMaterial());
    this.skyDome.frustumCulled = false;
    this.skyScene.add(this.skyDome);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: this.skyTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    backdrop.frustumCulled = false;
    this.backdropScene.add(backdrop);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.dynamic);
    const trackGeo = new THREE.PlaneGeometry(1, 1);
    trackGeo.rotateX(-Math.PI / 2);
    this.tracks = new THREE.InstancedMesh(
      trackGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      TRACK_MAX,
    );
    this.tracks.count = 0;
    this.tracks.frustumCulled = false;
    this.tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.tracks);
    this.postfx = new PostFX(this.renderer);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** The 3D camera as an audio listener: position, forward and up (world meters). */
  listenerPose(): { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number } | null {
    const c = this.cam.camera;
    if (!this.cam.init && c.position.lengthSq() === 0) return null;
    const f = new THREE.Vector3();
    c.getWorldDirection(f);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    return { x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z, ux: u.x, uy: u.y, uz: u.z };
  }

  /** False if WebGL couldn't start. */
  static supported(): boolean {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  /** Switches detail level at runtime (terrain is rebuilt to add or drop the grass). */
  setQuality(q: "high" | "fast"): void {
    if (q === this.quality) return;
    this.quality = q;
    // Reflections stay on in Fast too: cars look flat without them, and the cost is small.
    this.scene.environment = this.envMap;
    if (this.map) {
      const night = !!this.map.stars;
      this.hemi.intensity = (night ? (q === "fast" ? 1.0 : 0.7) : 1.0) * (1 - 0.25 * (this.map.wet ?? 0));
    }
    const size = q === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    for (const g of this.chunks.values()) disposeTree(g, this.scene);
    this.chunks.clear();
    this.resize();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === "high" ? 1.75 : 1) * this.resScale);
    this.renderer.setSize(this.width, this.height, false);
    this.postfx?.resize(this.quality === "fast");
  }

  render(scene: GameScene, view: string): void {
    const now = performance.now();
    const raw = now - this.last;
    const dt = Math.min(0.05, raw / 1000);
    this.last = now;
    this.adaptResolution(raw);
    if (scene.terrain !== this.terrain) this.resetWorld(scene.terrain);
    // A new run (or vehicle) means a new car: drop the old one's meshes.
    for (const [car, vis] of this.cars) {
      if (car !== scene.car && !scene.rivals.some((r) => r.car === car)) {
        this.disposeCar(vis);
        this.cars.delete(car);
        const blob = this.blobShadows.get(car);
        if (blob) {
          this.scene.remove(blob);
          (blob.material as THREE.Material).dispose();
        }
        this.blobShadows.delete(car);
      }
    }
    // Land is built on both sides of the road in every view. In the side-on views the camera floats
    // over the near side, so there it's open fields sloping gently away (nothing to block the view);
    // switching between side and behind views rebuilds the landscape.
    const sideView = view === "follow" || view === "close" || view === "wide";
    if (sideView !== this.sideView || !this.surround) {
      this.surround = true;
      this.sideView = sideView;
      for (const g of this.chunks.values()) disposeTree(g, this.scene);
      this.chunks.clear();
      this.applyFog();
    }
    const v: View3D = { scene, view, rect: { x: 0, y: 0, w: this.width, h: this.height } };
    const cp = scene.car.chassis.getPosition();
    this.updateTerrain(cp.x);
    this.updateSky(scene, cp.x, dt);
    this.updateDaylight(scene);
    this.updateJourney(cp.x);
    this.updateItems(scene, cp.x);
    this.updateGhost(scene);
    this.beginEffects();
    this.frameDt = dt;
    this.updateCar(scene);
    for (const r of scene.rivals) this.updateRival(r, cp.x);
    this.updateSmoke(dt);
    this.updateTracks(scene.car, scene.car.braking);
    for (const r of scene.rivals) if (Math.abs(r.car.chassis.getPosition().x - cp.x) < 80) this.updateTracks(r.car, r.car.braking);
    this.updateEffects(scene);
    if (this.map?.conveyor) this.animateFactory(scene.time);
    this.updateWalkers(cp.x, dt);
    this.endEffects();

    // Sun and shadows follow the car
    this.sun.position.set(cp.x + 10, cp.y + 22, 14);
    this.sun.target.position.set(cp.x + 2, cp.y, 0);

    const cockpit = view === "driver";
    const own = this.cars.get(scene.car);
    if (own?.head) own.head.visible = !cockpit;
    this.updateCamera(this.cam, v, dt);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.clear();
    this.drawSky(this.cam.camera, scene.time);
    this.renderer.render(this.scene, this.cam.camera);
    this.postfx.apply(scene.time);
    if (cockpit) this.renderMirror(v);
  }

  /** Rear-view mirror: a real camera looking back at the bed and egg, drawn into the mirror's glass. */
  /** Rear-view mirror plus the two door mirrors, each a real camera looking back. */
  private renderMirror(v: View3D): void {
    const chassis = v.scene.car.chassis;
    const a = chassis.getAngle();
    const d = v.scene.car.def.driver;
    const eye = chassis.getWorldPoint({ x: d.x, y: d.y + 0.25 });
    const back = (dist: number, drop: number) => ({ x: eye.x - Math.cos(a) * dist, y: eye.y - Math.sin(a) * dist - drop });
    // Center mirror: straight back over the bed and egg
    const c = back(6, 1.6);
    this.renderInto(mirrorRect(v.rect.w, v.rect.h), 55, eye.x, eye.y, 0.25, c.x, c.y, 0);
    // Door mirrors: from each side of the cab, angled slightly outward (+z is the driver's right)
    const sides = sideMirrorRects(v.rect.w, v.rect.h);
    const mount = chassis.getWorldPoint({ x: d.x + 0.25, y: d.y - 0.05 });
    const b = back(10, 0.9);
    this.renderInto(sides.left, 40, mount.x, mount.y, -1.05, b.x, b.y, -2.6);
    this.renderInto(sides.right, 40, mount.x, mount.y, 1.05, b.x, b.y, 2.6);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
  }

  private renderInto(r: Rect, fov: number, x: number, y: number, z: number, lx: number, ly: number, lz: number): void {
    const cam = this.mirrorCam;
    cam.fov = fov;
    cam.position.set(x, y, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(lx, ly, lz);
    cam.aspect = r.w / r.h;
    cam.updateProjectionMatrix();
    const vy = this.height - r.y - r.h;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(r.x, vy, r.w, r.h);
    this.renderer.setViewport(r.x, vy, r.w, r.h);
    this.renderer.clear();
    this.drawSky(cam, this.skyDome.material.uniforms.uTime.value);
    this.renderer.render(this.scene, cam);
  }

  /** The sky dome around the camera, then the painted distant scenery (no depth: the world draws over both). */
  private drawSky(cam: THREE.PerspectiveCamera, time: number): void {
    this.skyDome.position.copy(cam.position);
    this.skyDome.material.uniforms.uTime.value = time;
    this.renderer.render(this.skyScene, cam);
    this.renderer.render(this.backdropScene, this.backdropCam);
  }

  // ---------- camera ----------

  private updateCamera(state: CameraState, v: View3D, dt: number): void {
    const chassis = v.scene.car.chassis;
    const cp = chassis.getPosition();
    const vel = chassis.getLinearVelocity();
    const speed = Math.hypot(vel.x, vel.y);
    const cam = state.camera;
    cam.aspect = v.rect.w / v.rect.h;

    if (v.view === "driver") {
      // The head steadies itself: the view pitch follows the car, softened and smoothed.
      // G-forces: braking throws the head forward and nods the view down; accelerating presses it back.
      const surge = v.scene.cockpit?.surge ?? 0;
      const a = (v.scene.cockpit?.viewPitch ?? chassis.getAngle()) - surge * 0.14;
      const d = v.scene.car.def.driver;
      const bob = v.scene.cockpit?.bob ?? 0;
      const eye = chassis.getWorldPoint({ x: d.x + 0.05 + surge * 0.25, y: d.y + 0.12 + bob });
      // A touch wider at speed for a sense of rushing forward
      cam.fov = 70 + Math.min(speed, 30) * 0.3;
      cam.near = 0.05;
      cam.position.set(eye.x, eye.y, 0.3);
      cam.up.set(-Math.sin(a), Math.cos(a), 0);
      cam.lookAt(eye.x + Math.cos(a) * 10, eye.y + Math.sin(a) * 10, 0.3);
      cam.updateProjectionMatrix();
      state.init = false;
      return;
    }

    const p = PRESETS[v.view] ?? PRESETS.follow;
    const pull = 1 + Math.min(speed, 25) * 0.014;
    let target: THREE.Vector3;
    let look: THREE.Vector3;
    if (v.view === "chase" || v.view === "drone") {
      // Behind the car: the rig tilts with the hill (half the car's pitch, smoothed) so the camera
      // stays behind and above it on climbs and drops, and pulls back as speed builds.
      this.camPitch += (chassis.getAngle() * 0.5 - this.camPitch) * Math.min(1, dt * 3);
      const c = Math.cos(this.camPitch);
      const sn = Math.sin(this.camPitch);
      const rot = (o: THREE.Vector3, k: number) => new THREE.Vector3(cp.x + (o.x * c - o.y * sn) * k, cp.y + (o.x * sn + o.y * c) * k, o.z * k);
      target = rot(p.offset, pull);
      look = rot(p.look, 1).add(new THREE.Vector3(Math.min(vel.x * 0.25, 4), 0, 0));
    } else {
      // Side views, made cinematic: the camera swings round toward the back of the car as speed
      // builds (a dynamic three-quarter view at speed), tilts gently with the hills, rises when the
      // car is airborne to keep it in frame, and looks further ahead the faster you go.
      const forward = Math.max(0, vel.x);
      const swingWant = Math.min(1, forward / 24) * (v.view === "wide" ? 0.25 : 0.42);
      this.camSwing += (swingWant - this.camSwing) * Math.min(1, dt * 1.2);
      this.camPitch += (chassis.getAngle() * 0.3 - this.camPitch) * Math.min(1, dt * 2.5);
      const airborne = !v.scene.car.onGround;
      this.camLift += ((airborne ? 1.2 : 0) - this.camLift) * Math.min(1, dt * (airborne ? 1.5 : 3));
      const cs = Math.cos(this.camSwing);
      const ss = Math.sin(this.camSwing);
      const cpi = Math.cos(this.camPitch);
      const spi = Math.sin(this.camPitch);
      // Swing round the vertical axis (side → behind), then tilt with the slope
      const ox = p.offset.x * cs - p.offset.z * ss;
      const oz = p.offset.x * ss + p.offset.z * cs;
      const oy = p.offset.y;
      target = new THREE.Vector3(
        cp.x + (ox * cpi - oy * spi) * pull + Math.min(vel.x * 0.25, 4),
        cp.y + (ox * spi + oy * cpi) * pull + this.camLift,
        oz * pull,
      );
      look = new THREE.Vector3(cp.x + p.look.x + Math.min(vel.x * 0.3, 5), cp.y + p.look.y + this.camLift * 0.4 + p.look.x * spi, p.look.z);
    }
    if (!state.init) {
      state.pos.copy(target);
      state.look.copy(look);
      state.init = true;
    }
    state.pos.lerp(target, 1 - Math.exp(-dt * 4));
    state.look.lerp(look, 1 - Math.exp(-dt * 6));
    const groundLift = this.keepCameraAboveGround(state, cp.x, cp.y, dt);
    // A touch wider at speed, for a sense of pace
    cam.fov = p.fov + Math.min(speed, 30) * 0.22;
    cam.near = 0.1;
    cam.position.copy(state.pos);
    cam.position.y += groundLift;
    cam.up.set(0, 1, 0);
    cam.lookAt(state.look);
    cam.updateProjectionMatrix();
  }

  /**
   * Keeps an outside camera out of the ground: never below the land at its own spot, and raised
   * so no hill blocks the line of sight to the car. The extra height eases in and out smoothly.
   */
  private keepCameraAboveGround(state: CameraState, carX: number, carY: number, dt: number): number {
    if (!this.terrain || !this.map) return 0;
    const p = state.pos;
    const CLEAR = 1.2; // meters above the ground at the camera
    const SIGHT = 0.6; // meters of clearance over hills between camera and car
    let need = 0;
    // 1) The camera's own spot
    need = Math.max(need, this.height3d(p.x, p.z) + CLEAR - p.y);
    // 2) Line of sight to the car: sample along the way; where the ground pokes above the line,
    //    lift the camera enough (scaled by how far along the line that point is) to see over it.
    const target = new THREE.Vector3(carX, carY + 0.6, 0);
    const steps = 10;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = p.x + (target.x - p.x) * t;
      const z = p.z + (target.z - p.z) * t;
      const lineY = p.y + (target.y - p.y) * t;
      const ground = this.height3d(x, z) + SIGHT;
      if (ground > lineY) need = Math.max(need, (ground - lineY) / (1 - t));
    }
    need = Math.min(need, 25);
    // Rise quickly (so the camera never sinks into a hill), settle back slowly
    const rate = need > this.camGroundLift ? 12 : 1.5;
    this.camGroundLift += (need - this.camGroundLift) * Math.min(1, dt * rate);
    if (need > this.camGroundLift) this.camGroundLift = need; // never let it be inside the ground, even for a frame
    return Math.max(0, this.camGroundLift);
  }

  // ---------- world lifecycle ----------

  private resetWorld(terrain: Terrain): void {
    for (const g of this.chunks.values()) disposeTree(g, this.scene);
    this.chunks.clear();
    for (const o of this.items.values()) disposeTree(o, this.scene);
    this.items.clear();
    for (const g of this.bridges.values()) disposeTree(g, this.scene);
    this.bridges.clear();
    for (const g of this.featureProps.values()) disposeTree(g, this.scene);
    this.featureProps.clear();
    for (const vis of this.cars.values()) this.disposeCar(vis);
    this.cars.clear();
    for (const w of this.walkers) disposeTree(w.root, this.scene);
    this.walkers = [];
    for (const b of this.blobShadows.values()) {
      this.scene.remove(b);
      (b.material as THREE.Material).dispose();
    }
    this.blobShadows.clear();
    this.dynamic.clear();
    this.spritePool = [];
    this.meshPool = [];
    this.tracks.count = 0;
    this.trackNext = 0;
    this.smoke = [];
    this.trackLast.clear();
    this.terrain = terrain;
    this.cam.init = false;

    const map = terrain.map;
    if (map !== this.map) {
      this.map = map;
      const night = !!map.stars;
      this.hemi.color.set(map.sky[1]);
      this.hemi.groundColor.set(map.ground);
      const wet = map.wet ?? 0;
      // Night needs more fill light when reflections are off (3D Fast), or cars turn black.
      this.hemi.intensity = (night ? (this.quality === "fast" ? 1.0 : 0.7) : 1.0) * (1 - 0.25 * wet);
      this.sun.color.set(night ? "#b8c4ff" : wet ? "#dfe4ec" : "#fff6e6");
      // Rain: an overcast sky, so soft light and faint shadows
      this.sun.intensity = (night ? 0.9 : 3.0) * (1 - 0.6 * wet);
      this.scene.environmentIntensity = night ? 0.2 : 0.45;
      // Exponential haze: distant hills fade into the horizon color like real air (thicker in rain).
      this.applyFog();
      setSkyUniforms(this.skyDome.material, map);
      this.postfx.setGrade(gradeFor(map));
      this.skyTimer = 0;
      // Remember the daytime look; the day/night cycle blends away from it.
      const u = this.skyDome.material.uniforms;
      this.dayBase = {
        sun: this.sun.intensity,
        sunColor: this.sun.color.clone(),
        hemi: this.hemi.intensity,
        hemiColor: this.hemi.color.clone(),
        env: this.scene.environmentIntensity,
        grade: gradeFor(map),
        top: (u.uTop.value as THREE.Vector3).clone(),
        mid: (u.uMid.value as THREE.Vector3).clone(),
        horizon: (u.uHorizon.value as THREE.Vector3).clone(),
        sunCol: (u.uSunColor.value as THREE.Vector3).clone(),
        glow: (u.uGlow.value as THREE.Vector3).clone(),
        cloud: (u.uCloud.value as THREE.Vector3).clone(),
        sunSize: u.uSunSize.value as number,
        stars: u.uStars.value as number,
      };
    }
  }

  /**
   * Day/night cycle: moves the sun (or moon), and blends sky, light, haze, distant scenery and the
   * color grade between the terrain's daytime look, a golden sunset and a deep blue night.
   */
  private updateDaylight(scene: GameScene): void {
    const b = this.dayBase;
    const u = this.skyDome.material.uniforms;
    const backdrop = (this.backdropScene.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    if (!b || scene.dayTime === null || !this.map) {
      this.nightLevel = this.map?.stars ? 1 : 0;
      if (this.daylightOn && b) {
        // Back to the terrain's fixed look
        Object.assign(this.sun, { intensity: b.sun });
        this.sun.color.copy(b.sunColor);
        this.hemi.intensity = b.hemi;
        this.hemi.color.copy(b.hemiColor);
        this.scene.environmentIntensity = b.env;
        u.uTop.value = b.top.clone();
        u.uMid.value = b.mid.clone();
        u.uHorizon.value = b.horizon.clone();
        u.uSunColor.value = b.sunCol.clone();
        u.uGlow.value = b.glow.clone();
        u.uCloud.value = b.cloud.clone();
        u.uSunSize.value = b.sunSize;
        u.uStars.value = b.stars;
        u.uShowSun.value = this.map?.planet ? 0 : 1;
        (u.uSunDir.value as THREE.Vector3).set(0.6, 0.11, -0.79).normalize();
        backdrop.color.set(0xffffff);
        this.postfx.setGrade(b.grade);
        this.applyFog();
        this.daylightOn = false;
      }
      return;
    }
    this.daylightOn = true;
    const d = daylight(scene.dayTime);
    this.nightLevel = d.night;
    const mix3 = (a: THREE.Vector3, c: THREE.Vector3, t: number) => a.clone().lerp(c, t);
    const golden = d.dusk * 0.85 * (1 - d.night);
    // Sky: day → golden sunset → night
    u.uTop.value = mix3(mix3(b.top, SUNSET.top, golden), NIGHT.top, d.night);
    u.uMid.value = mix3(mix3(b.mid, SUNSET.mid, golden), NIGHT.mid, d.night);
    u.uHorizon.value = mix3(mix3(b.horizon, SUNSET.horizon, golden), NIGHT.horizon, d.night);
    u.uCloud.value = mix3(mix3(b.cloud, SUNSET.cloud, golden * 0.8), NIGHT.cloud, d.night);
    u.uStars.value = Math.max(b.stars, d.night);
    const dir = u.uSunDir.value as THREE.Vector3;
    if (d.night < 0.6) {
      // The sun, sinking toward the horizon in front of you as evening comes
      dir.set(0.6, d.elev * 0.55 + 0.02, -0.79).normalize();
      u.uSunColor.value = mix3(b.sunCol, SUNSET.sun, golden);
      u.uGlow.value = mix3(b.glow, SUNSET.glow, golden).multiplyScalar(1 - d.night);
      u.uSunSize.value = b.sunSize;
    } else {
      // The moon: small, pale and cool, risen on the left
      dir.set(0.35, 0.32, -0.88).normalize();
      u.uSunColor.value = MOON.color.clone();
      u.uGlow.value = MOON.glow.clone().multiplyScalar(d.night);
      u.uSunSize.value = Math.cos(0.022);
    }
    u.uShowSun.value = this.map.planet ? 0 : 1;
    // Light: warm low sun, then soft blue moonlight
    const sunUp = Math.max(0, 1 - d.night);
    this.sun.intensity = b.sun * (0.12 + 0.88 * d.day) * sunUp + 0.45 * d.night;
    this.sun.color.copy(b.sunColor).lerp(SUNSET.light, golden).lerp(MOON.light, d.night);
    const fill = this.quality === "fast" ? 0.6 : 0.45;
    this.hemi.intensity = b.hemi * (0.35 + 0.65 * d.day) * (1 - d.night) + fill * d.night;
    this.hemi.color.copy(b.hemiColor).lerp(NIGHT.hemi, d.night);
    this.scene.environmentIntensity = b.env * (0.3 + 0.7 * d.day);
    // Haze takes the horizon color; distant painted scenery darkens and warms with the sky
    const hz = u.uHorizon.value as THREE.Vector3;
    (this.scene.fog as THREE.FogExp2 | null)?.color.setRGB(hz.x, hz.y, hz.z, THREE.SRGBColorSpace);
    backdrop.color.setRGB(1, 1, 1).lerp(new THREE.Color(1, 0.82, 0.68), golden * 0.5).lerp(new THREE.Color(0.16, 0.19, 0.3), d.night * 0.9);
    // Grade: stronger glow and richer color at night
    const g = b.grade;
    const n = d.night;
    this.postfx.setGrade({
      contrast: g.contrast,
      saturation: g.saturation + (1.15 - g.saturation) * n,
      tint: [g.tint[0] + (0.94 - g.tint[0]) * n + 0.04 * golden, g.tint[1] + (0.98 - g.tint[1]) * n, g.tint[2] + (1.1 - g.tint[2]) * n - 0.04 * golden],
      bloom: g.bloom + (0.95 - g.bloom) * n,
      threshold: g.threshold + (0.55 - g.threshold) * n,
    });
  }

  /**
   * Journey terrains (Space Launch): the sky, haze, light and color grade follow the stage you're
   * in, so climbing out of the atmosphere darkens the sky, brings out the stars and cools the light.
   */
  private updateJourney(x: number): void {
    const base = this.map;
    if (!base?.stages) return;
    const m = viewMap(base, x);
    const key = `${m.sky.join()}${m.stars}${m.planet}`;
    if (key !== this.journeyKey) {
      this.journeyKey = key;
      setSkyUniforms(this.skyDome.material, m);
      this.postfx.setGrade(gradeFor(m));
      (this.scene.fog as THREE.FogExp2 | null)?.color.set(m.sky[2]);
      this.hemi.color.set(m.sky[1]);
      this.hemi.groundColor.set(m.ground);
      this.skyTimer = 0;
    }
    // 0 on the ground .. 1 in space
    const space = Math.min(1, Math.max(0, (x - 1000) / 900));
    this.nightLevel = space;
    this.sun.intensity = 3.0 - 1.3 * space;
    this.sun.color.set("#fff6e6").lerp(new THREE.Color("#cfe0ff"), space);
    this.hemi.intensity = 1.0 - (this.quality === "fast" ? 0.15 : 0.35) * space;
    this.scene.environmentIntensity = 0.45 - 0.2 * space;
  }
  private journeyKey = "";

  private updateSky(scene: GameScene, x: number, dt: number): void {
    this.skyTimer -= dt;
    if (this.skyTimer > 0) return;
    this.skyTimer = 0.2;
    const c = this.skyCanvas.getContext("2d")!;
    paintSky(c, this.skyCanvas.width, this.skyCanvas.height, viewMap(scene.terrain.map, x), scene.time, x * 6, 0, true);
    this.skyTexture.needsUpdate = true;
  }

  /** Distance haze; thicker in the behind views so the far end of the world melts into the horizon. */
  private applyFog(): void {
    const map = this.map;
    if (!map) return;
    const wet = map.wet ?? 0;
    const base = (map.bubbles ? 0.011 : 0.0068) * (1 + 1.6 * wet) * (this.surround && !this.sideView ? 1.45 : 1);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(map.sky[2]), base);
  }

  // ---------- terrain ----------

  /** Height of the 3D landscape: the road profile, rising into hills behind the road. */
  private height3d(x: number, z: number): number {
    const t = this.terrain!;
    const h = t.height(x);
    if (z > 3.4) {
      // Near side: in the side-on views, open fields sloping gently away from the road (the camera
      // is up there); in the other views, fields rolling up into low hills like the far side.
      const d = z - 3.4;
      if (this.map!.indoor) return h - Math.min(0.6, d * 0.04);
      if (this.map!.skyline) return h - Math.min(1.5, d * 0.05);
      if (this.sideView) return h - Math.min(3, d * 0.06) + Math.sin(x * 0.07 + d * 0.15) * 0.25 * smooth(d / 10);
      const amp = this.map!.shape.ampA;
      const rise = d * 0.05 + smooth(d / 18) * amp * (1.0 + 1.3 * Math.sin(x * 0.037 + d * 0.07 + 2.1) + 0.8 * Math.sin(x * 0.09 - d * 0.06));
      return h + Math.max(-0.4, rise);
    }
    if (z >= -3.4) return h;
    const d = -z - 3.4;
    // City streets stay flat behind the road so the skyline in the background shows.
    if (this.map!.skyline) return h - Math.min(1.5, d * 0.05);
    // Factory floor: flat concrete, rising into the far walls of the hall
    if (this.map!.indoor) return h - Math.min(0.6, d * 0.04) + smooth((d - 30) / 15) * 12;
    const amp = this.map!.shape.ampA;
    const rise = d * 0.1 + smooth(d / 14) * amp * (1.4 + 1.6 * Math.sin(x * 0.045 + d * 0.09) + 0.9 * Math.sin(x * 0.11 - d * 0.05));
    return h + Math.max(0, rise);
  }

  private updateTerrain(x: number): void {
    const first = Math.floor((x - BEHIND) / CHUNK);
    const last = Math.floor((x + AHEAD) / CHUNK);
    for (let i = first; i <= last; i++) if (!this.chunks.has(i)) this.buildChunk(i);
    for (const [i, g] of this.chunks) {
      if (i < first - 1 || i > last + 1) {
        disposeTree(g, this.scene);
        this.chunks.delete(i);
      }
    }
  }

  private buildChunk(i: number): void {
    const t = this.terrain!;
    const x0 = i * CHUNK;
    // Journey terrains look different along the road: each stretch takes the look at its middle
    const map = viewMap(this.map!, x0 + CHUNK / 2);
    const n = Math.round(CHUNK / STEP) + 1;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const roadA = new THREE.Color(mixColor(map.ground, "#ffffff", 0.2));
    const verge = new THREE.Color(map.top[1]);
    const grass = new THREE.Color(map.top[0]);
    const far = new THREE.Color(mixColor(map.top[0], map.hills[0], 0.6));
    const wood = new THREE.Color("#7c828b");
    const inRamp = (x: number) => t.features.some((f) => f.kind === "ramp" && x > f.x - RAMP.length && x <= f.x);

    // Top surface
    const COLS = this.surround ? COLS_SURROUND : BASE_COLS;
    for (let a = 0; a < n; a++) {
      const x = x0 + a * STEP;
      const ramp = inRamp(x);
      for (let b = 0; b < COLS.length; b++) {
        const z = COLS[b];
        pos.push(x, this.height3d(x, z), z);
        if (Math.abs(z) <= ROAD) c.copy(ramp ? wood : roadA);
        else if (Math.abs(z) <= 3.4) c.copy(verge);
        else c.copy(grass).lerp(far, Math.min(1, (Math.abs(z) - 3.4) / 40));
        const jitter = 0.9 + hash(a * 31 + b * 7 + i * 1000) * 0.18;
        col.push(c.r * jitter, c.g * jitter, c.b * jitter);
      }
    }
    const cols = COLS.length;
    for (let a = 0; a < n - 1; a++) {
      for (let b = 0; b < cols - 1; b++) {
        const p = a * cols + b;
        idx.push(p, p + cols, p + 1, p + 1, p + cols, p + cols + 1);
      }
    }

    // Cut-away face toward the camera, showing the soil layers (side views only)
    const faceColors = [new THREE.Color(map.top[0]), new THREE.Color(map.ground), new THREE.Color(map.bands[0]), new THREE.Color(map.bands[1])];
    const base = pos.length / 3;
    for (let a = 0; a < (this.surround ? 0 : n); a++) {
      const x = x0 + a * STEP;
      const top = t.height(x);
      for (const [depth, ci] of FACE_ROWS) {
        pos.push(x, top - depth, NEAR_EDGE);
        const fc = faceColors[ci];
        const shade = 1 - Math.min(0.35, depth / 40);
        col.push(fc.r * shade, fc.g * shade, fc.b * shade);
      }
    }
    const rows = FACE_ROWS.length;
    for (let a = 0; a < (this.surround ? 0 : n - 1); a++) {
      for (let r = 0; r < rows - 1; r++) {
        const p = base + a * rows + r;
        idx.push(p, p + 1, p + rows, p + 1, p + rows + 1, p + rows);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    // UVs for the ground detail texture: top surface in x/z, cut face in x/y
    const uv: number[] = [];
    for (let k = 0; k < pos.length; k += 3) {
      const onFace = k / 3 >= base;
      uv.push(pos[k] / 3, (onFace ? pos[k + 1] : pos[k + 2]) / 3);
    }
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, groundMaterial());
    mesh.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh);
    group.add(this.buildRoad(x0, n, inRamp, map));
    if (this.quality === "high") {
      const tufts = this.buildTufts(i, x0);
      if (tufts) group.add(tufts);
    }

    const arms: THREE.Group[] = [];
    // Scenery on the hills behind the road
    for (let x = Math.ceil(x0 / 3.5) * 3.5; x < x0 + CHUNK; x += 3.5) {
      if (x < 4) continue;
      const k = Math.round(x * 2);
      for (let row = 0; row < (this.surround && !this.sideView ? 4 : 2); row++) {
        const r = hash(k * 3 + row * 17);
        if (r < 0.45) continue;
        const side = row < 2 ? -1 : 1;
        const z = side * ((row % 2 === 0 ? 4.8 + hash(k + 5 + row) * 5 : 11 + hash(k + 9 + row) * 26));
        if (row === 0 && t.nearFeature(x, -6)) continue;
        if (map.decor === "robot" && row % 2 === 0) {
          // Robotic arms right beside the belt, facing it; added after merging so they can move
          const arm = makeRobotArm(map, k);
          const zz = side * (ROAD + 1.7);
          arm.position.set(x + hash(k + 2) * 1.5, this.height3d(x, zz), zz);
          arm.rotation.y = side < 0 ? 0 : Math.PI;
          (arm.userData.arm as RobotArmParts).beltDir = side < 0 ? 1 : -1;
          arms.push(arm);
          continue;
        }
        const prop = makeDecor(map, 0.8 + hash(k + row) * 0.7);
        prop.position.set(x + hash(k + 2) * 1.5, this.height3d(x, z) - 0.05, z);
        prop.rotation.y = hash(k + 4) * Math.PI * 2;
        group.add(prop);
      }
    }
    // Distance boards every 50 m and reflector posts every 10 m
    for (let x = Math.ceil(x0 / 10) * 10; x < x0 + CHUNK; x += 10) {
      if (x <= 0) continue;
      const y = t.height(x);
      const post = new THREE.Mesh(POST_GEO, POST_MAT);
      post.position.set(x, y + 0.5, ROAD + 0.4);
      group.add(post);
      if (x % 50 === 0 && (t.finishX === null || Math.abs(x - t.finishX) > 3)) {
        const sign = distanceSign(x);
        sign.position.set(x, y, -ROAD - 0.9);
        // Angled toward oncoming traffic, so it reads from the driver's seat and from the side
        sign.rotation.y = -0.7;
        group.add(sign);
      }
    }
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== mesh) o.castShadow = true;
    });
    // One draw call per look for the whole stretch (trees, rocks, posts…), instead of one each.
    if (map.conveyor) this.addFactoryProps(group, x0, n);
    mergeByLook(group, new Set());
    for (const arm of arms) group.add(arm);
    this.scene.add(group);
    this.chunks.set(i, group);
  }

  /** Road surface strip with a gravel/rut texture, laid just above the terrain. */
  private buildRoad(x0: number, n: number, inRamp: (x: number) => boolean, look: MapDef = this.map!): THREE.Mesh {
    const t = this.terrain!;
    const across = 6;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let a = 0; a < n; a++) {
      const x = x0 + a * STEP;
      // Ramp decks are wood (from the terrain colors), so sink the road out of sight there.
      const y = t.height(x) + (inRamp(x) ? -0.2 : 0.012);
      for (let b = 0; b <= across; b++) {
        const z = -ROAD + (b / across) * ROAD * 2;
        pos.push(x, y, z);
        uv.push(x / 8, b / across);
      }
    }
    for (let a = 0; a < n - 1; a++) {
      for (let b = 0; b < across; b++) {
        const p = a * (across + 1) + b;
        idx.push(p, p + across + 1, p + 1, p + 1, p + across + 1, p + across + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, roadMaterial(look));
    road.receiveShadow = true;
    return road;
  }

  /** Grass tufts along the verges (or pebbles on rocky/sandy maps), as one instanced mesh. */
  private buildTufts(i: number, x0: number): THREE.InstancedMesh | null {
    const map = viewMap(this.map!, x0 + CHUNK / 2);
    const grassy = GRASSY_3D.has(map.id);
    const count = grassy ? 420 : 140;
    const geo = grassy ? tuftGeometry() : shared(cached("pebble", () => new THREE.DodecahedronGeometry(0.09, 0)));
    const mat = grassy ? tuftMaterial() : decorMat(map.pebble, {});
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const base = new THREE.Color(grassy ? map.top[1] : map.pebble);
    const dark = new THREE.Color(grassy ? map.top[0] : map.bands[0]);
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const h1 = hash(i * 7919 + k * 13.1);
      const h2 = hash(i * 104729 + k * 7.7);
      const h3 = hash(i * 31337 + k * 3.3);
      const x = x0 + h1 * CHUNK;
      // Mostly near the road, thinning out up the far slope
      const z = h3 < 0.3 ? ROAD + 0.25 + h2 * (NEAR_EDGE - ROAD - 0.35) : -(ROAD + 0.25 + Math.pow(h2, 1.6) * 14);
      p.set(x, this.height3d(x, z) - 0.02, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h1 * 40);
      const size = grassy ? 0.7 + h2 * 0.9 : 0.5 + h2 * 1.4;
      s.set(size, size * (grassy ? 0.8 + h3 * 0.6 : 0.6), size);
      m.compose(p, q, s);
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, c.copy(base).lerp(dark, h3 * 0.7));
    }
    inst.receiveShadow = true;
    return inst;
  }

  // ---------- items, features, bridges ----------

  private updateItems(scene: GameScene, x: number): void {
    const t = scene.terrain;
    const lo = x - BEHIND;
    const hi = x + AHEAD;
    const live = new Set<object>();

    for (const coin of t.coins) {
      if (coin.x < lo || coin.x > hi) continue;
      const fade = coin.taken ? scene.time - coin.takenAt : 0;
      if (coin.taken && fade > 0.5) continue;
      live.add(coin);
      let o = this.items.get(coin);
      if (!o) {
        o = makeCoin(coin.value >= BIG_COIN_VALUE, this.glowTex);
        this.items.set(coin, o);
        this.scene.add(o);
      }
      o.position.set(coin.x, coin.y + fade * 4, 0);
      o.rotation.y = scene.time * (coin.value > 1 ? 2 : 3) + coin.x;
      o.scale.setScalar(coin.taken ? 1 + fade : 1);
    }
    for (const pu of t.powerUps) {
      if (pu.x < lo || pu.x > hi) continue;
      const fade = pu.taken ? scene.time - pu.takenAt : 0;
      if (pu.taken && fade > 0.45) continue;
      live.add(pu);
      let o = this.items.get(pu);
      if (!o) {
        o = makePickup(pu.kind, this.glowTex);
        this.items.set(pu, o);
        this.scene.add(o);
      }
      const bob = pu.kind === "fuel" ? 0 : Math.sin(scene.time * 3 + pu.x) * 0.12;
      o.position.set(pu.x, pu.y + bob + fade * 3, 0);
      o.rotation.y = pu.kind === "fuel" ? 0.4 : scene.time * 1.5;
      if (o.children.length > 1) {
        // Glue bottle sparkles: orbit and twinkle
        for (const c of o.children[1].children) {
          if (c.name !== "sparkle") continue;
          const k = c.userData.k as number;
          const ang = scene.time * 1.8 + k * 1.57;
          const tw = 0.5 + 0.5 * Math.sin(scene.time * 5 + k * 2.1);
          c.position.set(Math.cos(ang) * 0.5, 0.05 + Math.sin(ang * 1.3) * 0.45, Math.sin(ang) * 0.5);
          c.scale.setScalar(0.12 + tw * 0.18);
        }
      }
      o.scale.setScalar(1 + fade * 1.5);
    }
    // Sky obstacles: balloons, floating islands, storm clouds (visible from further off: planes fly high)
    for (const ob of t.obstacles) {
      if (ob.x < lo - 20 || ob.x > hi + 60) continue;
      live.add(ob);
      let o = this.items.get(ob);
      if (!o) {
        o = ob.kind === "balloon" ? makeBalloon(ob) : ob.kind === "island" ? makeIsland(ob) : makeStorm(ob, t.height(ob.x));
        o.position.set(ob.x, ob.y, 0);
        this.items.set(ob, o);
        this.scene.add(o);
      }
      if (ob.kind === "balloon") {
        o.rotation.z = Math.sin(scene.time * 0.8 + ob.seed * 9) * 0.03;
        o.rotation.y = scene.time * 0.1 + ob.seed * 6;
        const flame = o.getObjectByName("flame");
        if (flame) flame.scale.y = 0.8 + 0.5 * Math.abs(Math.sin(scene.time * 23 + ob.seed * 40));
      } else if (ob.kind === "storm") updateStorm(o, ob, scene.time, t.height(ob.x));
    }
    for (const [key, o] of this.items) {
      if (!live.has(key)) {
        disposeTree(o, this.scene);
        this.items.delete(key);
      }
    }

    // Ramps (lip stripes + sign) and canyon bridges
    for (const f of t.features) {
      const near = f.x > lo - 20 && f.x < hi + 20;
      if (f.kind === "ramp") {
        const have = this.featureProps.get(f.x);
        if (near && !have) {
          const g = makeRampProps(t, f.x);
          this.featureProps.set(f.x, g);
          this.scene.add(g);
        } else if (!near && have) {
          disposeTree(have, this.scene);
          this.featureProps.delete(f.x);
        }
      }
    }
    for (const fork of t.forks) {
      const near = fork.x + FORK.length > lo && fork.x < hi;
      const have = this.bridges.get(fork);
      if (near && !have) {
        const g = makeBridge(t, fork);
        this.bridges.set(fork, g);
        this.scene.add(g);
      } else if (!near && have) {
        disposeTree(have, this.scene);
        this.bridges.delete(fork);
      }
    }
    // Start and finish banners
    if (t.finishX !== null) {
      for (const fx of [0, t.finishX]) {
        const near = fx > lo && fx < hi;
        const have = this.featureProps.get(-1 - fx);
        if (near && !have) {
          const g = makeFinish(t, fx, fx === 0 ? "START" : "FINISH");
          this.featureProps.set(-1 - fx, g);
          this.scene.add(g);
        } else if (!near && have) {
          disposeTree(have, this.scene);
          this.featureProps.delete(-1 - fx);
        }
      }
    }
  }

  // ---------- vehicles & eggs ----------

  private buildCarVisual(car: GameScene["car"]): CarVisual {
    const def = car.def;
    const built = buildVehicle(def, false);
    const wheels = def.wheels.map((w) => buildWheelPair(def, w.r, false));
    const egg = buildEgg();
    const eggArmor = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x4f9bff, wireframe: true, transparent: true, opacity: 0.55 }),
    );
    eggArmor.scale.set(EGG_RX * 1.08, (EGG_RY_TOP + EGG_RY_BOTTOM) * 0.54, EGG_RX * 1.08);
    const eggGlue = new THREE.Mesh(
      new THREE.TorusGeometry(EGG_RX * 0.95, 0.06, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xf2f8ff, roughness: 0.2, transparent: true, opacity: 0.85 }),
    );
    eggGlue.rotation.x = Math.PI / 2;
    eggGlue.position.y = -EGG_RY_BOTTOM * 0.85;
    const eggShield = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    egg.add(eggArmor, eggGlue, eggShield);
    this.scene.add(built.body, ...wheels, egg);
    return { body: built.body, wheels, extraWheels: built.extraWheels, head: built.head, egg, eggArmor, eggGlue, eggShield, splat: null, tails: built.tails, beam: null, smokeTimer: 0, flames: built.flames, spinners: built.spinners };
  }

  private disposeCar(vis: CarVisual): void {
    disposeTree(vis.body, this.scene);
    for (const w of vis.wheels) disposeTree(w, this.scene);
    disposeTree(vis.egg, this.scene);
    if (vis.splat) disposeTree(vis.splat, this.scene);
  }

  private updateCar(scene: GameScene): void {
    const car = scene.car;
    let vis = this.cars.get(car);
    if (!vis) {
      vis = this.buildCarVisual(car);
      this.cars.set(car, vis);
    }
    const p = car.chassis.getPosition();
    vis.body.position.set(p.x, p.y, 0);
    vis.body.rotation.z = car.chassis.getAngle();
    car.wheels.forEach((w, i) => {
      const wp = w.getPosition();
      vis!.wheels[i].position.set(wp.x, wp.y, 0);
      vis!.wheels[i].rotation.z = w.getAngle();
    });
    for (const ew of vis.extraWheels) ew.rotation.z = car.wheels[1].getAngle() - car.chassis.getAngle();
    this.updateLights(vis, car, true);
    this.updateBlob(car, true);

    const showEgg = !scene.eggBroken && !scene.splat;
    vis.egg.visible = showEgg;
    if (showEgg) {
      const ep = car.egg.getPosition();
      vis.egg.position.set(ep.x, ep.y, 0);
      vis.egg.rotation.z = car.egg.getAngle();
      vis.eggArmor.visible = scene.armor > 0;
      vis.eggGlue.visible = scene.glue > 0 && (scene.glue > 3 || Math.floor(scene.time * 6) % 2 === 1);
      vis.eggShield.visible = scene.shield > 0;
      (vis.eggShield.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.1 * Math.sin(scene.time * 12);
    }
    if (scene.splat) {
      if (!vis.splat) {
        vis.splat = makeSplat();
        this.scene.add(vis.splat);
      }
      const k = Math.min(1, scene.splat.t * 6);
      vis.splat.position.set(scene.splat.x, scene.splat.y + 0.03, 0);
      vis.splat.rotation.set(0, 0, scene.splat.angle);
      vis.splat.scale.set(Math.max(0.01, k), 1, Math.max(0.01, k));
    }
  }

  /**
   * A soft dark patch on the ground right under the car (ambient occlusion, like a real car has):
   * it anchors the car to the road and fades as the car leaves the ground.
   */
  private updateBlob(car: GameScene["car"], visible: boolean): void {
    let blob = this.blobShadows.get(car);
    if (!blob) {
      const xs = car.def.parts.flatMap((p) => p.pts.map((q) => q.x));
      const len = Math.max(...xs) - Math.min(...xs);
      blob = new THREE.Mesh(BLOB_GEO, blobMaterial());
      blob.scale.set(len * 1.15, 1, BODY_DEPTH * 1.5);
      blob.renderOrder = 1;
      this.scene.add(blob);
      this.blobShadows.set(car, blob);
    }
    const t = this.terrain;
    const p = car.chassis.getPosition();
    if (!visible || !t) {
      blob.visible = false;
      return;
    }
    const ground = t.height(p.x);
    const lift = p.y - ground - 0.6;
    const k = Math.max(0, 1 - Math.max(0, lift) / 2.5);
    blob.visible = k > 0.02;
    blob.position.set(p.x, ground + 0.035, 0);
    blob.rotation.set(0, 0, Math.atan2(t.height(p.x + 1) - t.height(p.x - 1), 2));
    (blob.material as THREE.MeshBasicMaterial).opacity = 0.55 * k;
  }

  /** Belt rollers along both edges of the conveyor road, and steel gantries with lamps overhead. */
  private addFactoryProps(group: THREE.Group, x0: number, n: number): void {
    const t = this.terrain!;
    const steel = std("#8d939c", 0.4, 0.85);
    const yellow = std("#f2b705", 0.5, 0.2);
    const dark = std("#2b2d33", 0.6, 0.5);
    for (let a = 0; a < n; a += 3) {
      const x = x0 + a * STEP;
      const y = t.height(x);
      for (const z of [-ROAD - 0.12, ROAD + 0.12]) {
        const roller = new THREE.Mesh(cylGeo(0.13, 0.13, 0.22, 12), steel);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(x, y - 0.02, z);
        group.add(roller);
      }
    }
    // Side frames of the belt (yellow guard rails)
    for (const z of [-ROAD - 0.28, ROAD + 0.28]) {
      for (let a = 0; a < n - 1; a += 4) {
        const xa = x0 + a * STEP;
        const xb = Math.min(x0 + CHUNK, xa + 4 * STEP);
        const ya = t.height(xa) + 0.12;
        const yb = t.height(xb) + 0.12;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(xb - xa, yb - ya) + 0.02, 0.12, 0.1), yellow);
        rail.position.set((xa + xb) / 2, (ya + yb) / 2, z);
        rail.rotation.z = Math.atan2(yb - ya, xb - xa);
        group.add(rail);
      }
    }
    // Gantries every 20 m: two columns, a beam across, and a hanging lamp
    for (let x = Math.ceil(x0 / 20) * 20; x < x0 + CHUNK; x += 20) {
      const y = t.height(x);
      const h = 6.5;
      for (const z of [-ROAD - 2.2, ROAD + 2.2]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.3), dark);
        col.position.set(x, y + h / 2 - 0.4, z);
        col.castShadow = true;
        group.add(col);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, ROAD * 2 + 4.8), yellow);
      beam.position.set(x, y + h - 0.4, 0);
      beam.castShadow = true;
      group.add(beam);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe2a8, emissiveIntensity: 2.2 }));
      lamp.position.set(x, y + h - 0.75, 0);
      group.add(lamp);
    }
  }

  /**
   * Walking robots on the factory floor: a few strolling back and forth on each side of the belt,
   * kept near the camera (one that wanders too far reappears on the other side, out of view).
   */
  private updateWalkers(carX: number, dt: number): void {
    const want = this.map?.decor === "robot" ? 9 : 0;
    while (this.walkers.length > want) {
      const w = this.walkers.pop()!;
      disposeTree(w.root, this.scene);
    }
    if (!want || !this.terrain) return;
    while (this.walkers.length < want) {
      const i = this.walkers.length;
      const root = makeWalker(i);
      const side = i % 3 === 0 ? 1 : -1; // more of them on the far side, where you see them most
      const w: Walker = {
        root,
        parts: root.userData.walker as WalkerParts,
        x: carX - 40 + hash(i * 7.1) * 120,
        z: side * (7 + hash(i * 3.3) * 18),
        speed: (0.9 + hash(i * 5.7) * 0.9) * (hash(i * 9.1) > 0.5 ? 1 : -1),
        phase: hash(i * 2.3) * 10,
      };
      this.walkers.push(w);
      this.scene.add(root);
    }
    for (const w of this.walkers) {
      w.x += w.speed * dt;
      // Keep them around the camera: wrap a robot that's far behind to far ahead and vice versa
      if (w.x < carX - 60) w.x += 160;
      else if (w.x > carX + 100) w.x -= 160;
      w.phase += Math.abs(w.speed) * dt * 3.2;
      const y = this.height3d(w.x, w.z);
      const bob = Math.abs(Math.sin(w.phase)) * 0.06;
      w.root.position.set(w.x, y + bob, w.z);
      w.root.rotation.y = w.speed > 0 ? 0 : Math.PI;
      const swing = Math.sin(w.phase) * 0.55;
      w.parts.legL.rotation.z = swing;
      w.parts.legR.rotation.z = -swing;
      w.parts.armL.rotation.z = -swing * 0.8;
      w.parts.armR.rotation.z = swing * 0.8;
      w.parts.head.rotation.y = Math.sin(w.phase * 0.23) * 0.5;
    }
  }

  /** Robotic arms swing and dip; the belt surface scrolls forward. */
  private animateFactory(time: number): void {
    const mat = roadMats.get(this.map!.id);
    if (mat?.map) {
      // Belt texture repeats every 8 m along the road (u = x / 8): scroll at the belt speed
      mat.map.offset.x = -((time * (this.map!.conveyor ?? 0)) / 8) % 1;
      if (mat.bumpMap) mat.bumpMap.offset.x = mat.map.offset.x;
    }
    for (const g of this.chunks.values()) {
      for (const c of g.children) {
        const arm = c.userData.arm as RobotArmParts | undefined;
        if (arm) animateArm(c as THREE.Group, arm, time);
      }
    }
  }

  /** Brake lights, night headlight beam, and exhaust smoke under throttle. */
  private updateLights(vis: CarVisual, car: GameScene["car"], player: boolean): void {
    for (const m of vis.tails) m.emissiveIntensity = car.braking ? 6 : 1.2;
    // Propeller: idles slowly, a blur at full throttle
    for (const sp of vis.spinners) sp.rotation.x += this.frameDt * (8 + car.load * 50);
    // Rocket flames: length follows thrust, with a fast flicker
    for (const f of vis.flames) {
      const k = car.rocketOn;
      f.visible = k > 0.02;
      if (f.visible) {
        const flick = 0.85 + Math.random() * 0.3;
        f.scale.set(0.4 + k * 1.4 * flick, 0.7 + k * 0.4, 0.7 + k * 0.4);
      }
    }
    // Headlights on at night maps, in the city, and from dusk in the day/night cycle
    const night = !!this.map && (!!this.map.stars || !!this.map.skyline || !!this.map.indoor || this.nightLevel > 0.35);
    if (player && night && !vis.beam) {
      const def = car.def;
      const beam = new THREE.SpotLight(0xfff1cc, 60, 34, 0.55, 0.65, 1.4);
      beam.position.set(def.headlight.x + 0.05, def.headlight.y, 0);
      beam.target.position.set(def.headlight.x + 10, def.headlight.y - 1.6, 0);
      vis.body.add(beam, beam.target);
      vis.beam = beam;
    }
    if (vis.beam) vis.beam.visible = night;
    // Exhaust: puffs under load, thicker and darker for diesels; none for electric drives
    const engine = engineFor(car.def.id);
    if (engine.electric || car.load < 0.2) return;
    vis.smokeTimer -= this.frameDt * car.load * (engine.clatter > 0 ? 34 : 18);
    while (vis.smokeTimer < 0 && this.smoke.length < SMOKE_MAX) {
      vis.smokeTimer += 1;
      const p = car.chassis.getWorldPoint({ x: car.def.taillight.x - 0.04, y: car.def.taillight.y - 0.2 });
      const v = car.chassis.getLinearVelocity();
      this.smoke.push({
        x: p.x,
        y: p.y,
        z: BODY_DEPTH * 0.3,
        vx: v.x * 0.35 - 1.2,
        vy: 0.35 + Math.random() * 0.3,
        life: 0,
        max: 0.9 + Math.random() * 0.6,
        size: 0.18,
        dark: engine.clatter > 0,
      });
    }
  }

  private updateSmoke(dt: number): void {
    this.smoke = this.smoke.filter((s) => (s.life += dt) < s.max);
    for (const s of this.smoke) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - dt * 1.5;
      s.size += dt * 0.9;
      const k = 1 - s.life / s.max;
      const sprite = this.sprite(smokeMaterial(0.32 * k, s.dark));
      sprite.position.set(s.x, s.y, s.z);
      sprite.scale.setScalar(s.size * 2);
    }
  }

  /** A Race mode rival: same car meshes as yours, plain egg (no glue, armor or shield). */
  private updateRival(r: GameScene["rivals"][number], camX: number): void {
    const car = r.car;
    let vis = this.cars.get(car);
    if (!vis) {
      vis = this.buildCarVisual(car);
      vis.eggArmor.visible = vis.eggGlue.visible = vis.eggShield.visible = false;
      this.cars.set(car, vis);
    }
    const p = car.chassis.getPosition();
    // Far-off rivals are hidden (cheaper, and they'd be specks anyway).
    const near = Math.abs(p.x - camX) < 140;
    vis.body.visible = near;
    for (const w of vis.wheels) w.visible = near;
    vis.egg.visible = near && !r.eggBroken;
    if (!near) {
      this.updateBlob(car, false);
      return;
    }
    // Rivals drive a lane further back so they don't clip through your car.
    const z = -0.9;
    vis.body.position.set(p.x, p.y, z);
    vis.body.rotation.z = car.chassis.getAngle();
    car.wheels.forEach((w, i) => {
      const wp = w.getPosition();
      vis!.wheels[i].position.set(wp.x, wp.y, z);
      vis!.wheels[i].rotation.z = w.getAngle();
    });
    for (const ew of vis.extraWheels) ew.rotation.z = car.wheels[1].getAngle() - car.chassis.getAngle();
    this.updateLights(vis, car, false);
    this.updateBlob(car, near);
    if (!r.eggBroken) {
      const ep = car.egg.getPosition();
      vis.egg.position.set(ep.x, ep.y, z);
      vis.egg.rotation.z = car.egg.getAngle();
    }
  }

  /** Lays tire-track strips behind each wheel that's on the ground. */
  private updateTracks(car: GameScene["car"], braking: boolean): void {
    const t = this.terrain;
    if (!t) return;
    const depth = TRACK_DEPTH[t.map.id] ?? 0.4;
    const strength = braking ? Math.max(depth, 0.85) : depth;
    if (strength < 0.05) return;
    const color = new THREE.Color(t.map.ground).lerp(new THREE.Color(braking ? 0x0a0a0a : 0x2a1d12), strength);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    car.wheels.forEach((w, i) => {
      const key = w;
      const r = car.def.wheels[i].r;
      const p = w.getPosition();
      const grounded = car.wheelContacts[i] > 0;
      const last = this.trackLast.get(key);
      if (!grounded) {
        this.trackLast.delete(key);
        return;
      }
      const x = p.x;
      const y = t.height(x) + 0.025;
      if (!last) {
        this.trackLast.set(key, { x, y });
        return;
      }
      const len = Math.hypot(x - last.x, y - last.y);
      if (len < 0.35) return;
      if (len > 3) {
        this.trackLast.set(key, { x, y });
        return;
      }
      const width = Math.min(0.42, r * 0.85) * 0.9;
      const zOff = BODY_DEPTH / 2 + width / 2 - 0.05;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(y - last.y, x - last.x));
      for (const z of [zOff, -zOff]) {
        m.compose(new THREE.Vector3((x + last.x) / 2, (y + last.y) / 2, z), q, new THREE.Vector3(len + 0.04, 1, width));
        this.tracks.setMatrixAt(this.trackNext, m);
        this.tracks.setColorAt(this.trackNext, color);
        this.trackNext = (this.trackNext + 1) % TRACK_MAX;
        this.tracks.count = Math.min(TRACK_MAX, this.tracks.count + 1);
      }
      this.tracks.instanceMatrix.needsUpdate = true;
      if (this.tracks.instanceColor) this.tracks.instanceColor.needsUpdate = true;
      this.trackLast.set(key, { x, y });
    });
  }

  private updateGhost(scene: GameScene): void {
    const g = scene.ghost;
    if (!g?.pose) {
      if (this.ghostGroup) this.ghostGroup.visible = false;
      return;
    }
    if (g.def !== this.ghostDef) {
      if (this.ghostGroup) disposeTree(this.ghostGroup, this.scene);
      const built = buildVehicle(g.def, true);
      this.ghostGroup = built.body;
      for (const w of g.def.wheels) {
        const pair = buildWheelPair(g.def, w.r, true);
        pair.position.set(w.x, w.y, 0);
        pair.name = "ghostWheel";
        this.ghostGroup.add(pair);
      }
      this.ghostDef = g.def;
      this.scene.add(this.ghostGroup);
    }
    const gg = this.ghostGroup!;
    gg.visible = true;
    gg.position.set(g.pose.x, g.pose.y, -0.2);
    gg.rotation.z = g.pose.a;
    const spin = -g.pose.x / g.def.wheels[1].r;
    for (const c of gg.children) if (c.name === "ghostWheel") c.rotation.z = spin;
  }

  // ---------- effects ----------

  private beginEffects(): void {
    this.spritesUsed = 0;
    this.meshesUsed = 0;
  }

  /** Hides pooled effect objects that weren't needed this frame. */
  private endEffects(): void {
    for (let i = this.spritesUsed; i < this.spritePool.length; i++) this.spritePool[i].visible = false;
    for (let i = this.meshesUsed; i < this.meshPool.length; i++) this.meshPool[i].visible = false;
  }

  private sprite(mat: THREE.SpriteMaterial): THREE.Sprite {
    let s = this.spritePool[this.spritesUsed];
    if (!s) {
      s = new THREE.Sprite(mat);
      this.spritePool.push(s);
      this.dynamic.add(s);
    }
    this.spritesUsed++;
    s.material = mat;
    s.visible = true;
    return s;
  }

  private shard(mat: THREE.Material): THREE.Mesh {
    let m = this.meshPool[this.meshesUsed];
    if (!m) {
      m = new THREE.Mesh(SHARD_GEO, mat);
      this.meshPool.push(m);
      this.dynamic.add(m);
    }
    this.meshesUsed++;
    m.material = mat;
    m.visible = true;
    return m;
  }

  /**
   * Keeps the frame rate steady: if frames average over ~22 ms (below ~45 fps) the 3D view drops
   * its resolution a step; with plenty of headroom it steps back up. Checked every 1.5 s.
   */
  private adaptResolution(frameMs: number): void {
    if (frameMs <= 0 || frameMs > 250) return; // tab switches and hitches don't count
    this.frameAvg += (frameMs - this.frameAvg) * 0.05;
    this.resTimer += frameMs;
    if (this.resTimer < 1500) return;
    this.resTimer = 0;
    let next = this.resScale;
    if (this.frameAvg > 22 && next > 0.55) next = Math.max(0.55, next - 0.1);
    else if (this.frameAvg < 14 && next < 1) next = Math.min(1, next + 0.05);
    if (next !== this.resScale) {
      this.resScale = next;
      this.resize();
    }
  }

  private updateEffects(scene: GameScene): void {
    for (const p of scene.particles) {
      const m = this.shard(shardMaterial(p.color));
      m.position.set(p.x, p.y, (hash(p.size * 1000) - 0.5) * 1.2);
      m.rotation.set(p.rot, p.rot * 0.7, p.rot * 1.3);
      m.scale.setScalar(p.size * 2.2);
    }
    for (const d of scene.dust) {
      const k = d.life / d.max;
      const s = this.sprite(dustMaterial(0.35 * k));
      s.position.set(d.x, d.y, 0.6);
      s.scale.setScalar(d.size * (3.5 - k * 1.5));
    }
  }
}

// ---------- shared geometry & materials ----------

const POST_GEO = new THREE.BoxGeometry(0.1, 1, 0.1);
const POST_MAT = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
const SHARD_GEO = new THREE.TetrahedronGeometry(0.5);
const shardMats = new Map<string, THREE.Material>();
function shardMaterial(color: string): THREE.Material {
  let m = shardMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    shardMats.set(color, m);
    SHARED_MATS.add(m);
  }
  return m;
}
const dustMats: THREE.SpriteMaterial[] = [];
const smokeMats: Record<string, THREE.SpriteMaterial> = {};
function smokeMaterial(alpha: number, dark: boolean): THREE.SpriteMaterial {
  const i = Math.max(0, Math.min(10, Math.round(alpha * 30)));
  const key = `${dark ? "d" : "l"}${i}`;
  if (!smokeMats[key]) {
    smokeMats[key] = new THREE.SpriteMaterial({ map: GLOW_TEX_REF.tex, color: dark ? 0x4a4a4c : 0xb9bcc2, transparent: true, opacity: i / 30, depthWrite: false });
    SHARED_MATS.add(smokeMats[key]);
  }
  return smokeMats[key];
}

function dustMaterial(alpha: number): THREE.SpriteMaterial {
  const i = Math.max(0, Math.min(9, Math.round(alpha * 25)));
  if (!dustMats[i]) {
    dustMats[i] = new THREE.SpriteMaterial({ map: GLOW_TEX_REF.tex, color: 0xc8b496, transparent: true, opacity: i / 25, depthWrite: false });
    SHARED_MATS.add(dustMats[i]);
  }
  return dustMats[i];
}

/** Removes an object and frees its GPU geometry/materials (except shared, cached ones). */
export function disposeTree(o: THREE.Object3D, parent: THREE.Object3D): void {
  parent.remove(o);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && m.geometry !== POST_GEO && m.geometry !== SHARD_GEO && !SHARED_GEOS.has(m.geometry)) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (SHARED_MATS.has(mat)) continue;
      const tex = (mat as THREE.MeshStandardMaterial).map;
      if (tex && tex !== GLOW_TEX_REF.tex) tex.dispose();
      mat.dispose();
    }
  });
}

const SHARED_MATS = new Set<THREE.Material>();
/** The shared glow texture, which must never be disposed. */
const GLOW_TEX_REF: { tex: THREE.Texture | null } = { tex: null };

const SHARED_GEOS = new Set<THREE.BufferGeometry>();
function shared<T extends THREE.BufferGeometry>(g: T): T {
  SHARED_GEOS.add(g);
  return g;
}

function std(color: string | number, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color as string), roughness, metalness, ...extra });
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,0.9)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textBoard(text: string): THREE.Group {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fffaf0";
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = "#5a3d22";
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 58);
  g.fillStyle = "#5a3d22";
  g.font = "bold 34px Trebuchet MS, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshLambertMaterial({ map: tex }));
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), new THREE.MeshLambertMaterial({ color: 0x5a3d22 }));
  post.position.y = -0.8;
  group.add(board, post);
  return group;
}

/**
 * A real road sign: a metal panel with thickness (printed face, grey back), on two galvanized
 * posts. Milestones (every 250 m) are bigger.
 */
function distanceSign(meters: number): THREE.Group {
  const milestone = meters % 250 === 0;
  const w = milestone ? 2.2 : 1.5;
  const h = milestone ? 1.0 : 0.72;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = Math.round(512 * (h / w));
  paintDistanceSign(c.getContext("2d")!, c.width, c.height, meters);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 });
  const group = new THREE.Group();
  const top = milestone ? 2.6 : 2.15;
  // Printed face (transparent corners show the rounded panel), and the panel's grey back
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
  front.position.set(0, top - h / 2, 0.026);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.97, h * 0.95, 0.04), metal);
  back.position.set(0, top - h / 2, 0);
  back.castShadow = true;
  group.add(front, back);
  for (const px of [-w * 0.32, w * 0.32]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, top - 0.05, 8), metal);
    post.position.set(px, (top - 0.05) / 2, -0.05);
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

// ---------- the egg ----------

export function buildEgg(): THREE.Group {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 24; k++) {
    const a = -Math.PI / 2 + (k / 24) * Math.PI;
    const r = Math.max(0.0001, EGG_RX * Math.cos(a));
    const y = (a > 0 ? EGG_RY_TOP : EGG_RY_BOTTOM) * Math.sin(a);
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 40);
  // Speckled shell texture
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f8ecd6";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(150,105,60,${0.15 + hash(i) * 0.3})`;
    g.beginPath();
    g.arc(hash(i + 1) * 256, hash(i + 2) * 256, 0.8 + hash(i + 3) * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 }));
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// ---------- vehicles ----------

const GLASS = "#bfe8f7";

export function buildVehicle(def: VehicleDef, ghost: boolean): { body: THREE.Group; extraWheels: THREE.Group[]; head: THREE.Object3D | null; tails: THREE.MeshStandardMaterial[]; flames: THREE.Object3D[]; spinners: THREE.Object3D[] } {
  const body = new THREE.Group();
  const mat = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) =>
    ghost
      ? new THREE.MeshStandardMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.5 })
      : new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(color),
          roughness: 0.38,
          metalness: 0.2,
          clearcoat: 1,
          clearcoatRoughness: 0.07,
          ...opts,
        });

  // Planes have a slim fuselage; everything else is car-width
  const bodyW = def.plane ? 0.95 : BODY_DEPTH;
  for (const part of def.parts) {
    if (part.only2d) continue;
    const shape = new THREE.Shape(part.pts.map((p) => new THREE.Vector2(p.x, p.y)));
    const glass = part.fill === GLASS;
    const depth = glass ? bodyW + 0.02 : part.solid === false ? bodyW + 0.04 : bodyW;
    // Rounded edges: a small bevel instead of razor-sharp extrusions
    const bevel = glass ? 0.012 : 0.06;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: glass ? 0.01 : 0.035,
      bevelSegments: glass ? 2 : 4,
    });
    geo.translate(0, 0, -(depth - bevel * 2) / 2);
    const m = new THREE.Mesh(
      geo,
      glass
        ? new THREE.MeshPhysicalMaterial({ color: 0x24394a, transparent: true, opacity: ghost ? 0.15 : 0.62, roughness: 0.03, metalness: 0.5, clearcoat: 1 })
        : mat(part.fill),
    );
    m.castShadow = !ghost;
    m.receiveShadow = !ghost;
    body.add(m);
  }
  // Line work (cages, ladders, antennas) as thin bars on both sides
  for (const l of def.lines ?? []) {
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1];
      const b = l.pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) continue;
      for (const z of [BODY_DEPTH / 2 - 0.05, -BODY_DEPTH / 2 + 0.05]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(len + l.width, l.width, l.width), mat(l.color, { metalness: 0.4 }));
        bar.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, z);
        bar.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
        bar.castShadow = !ghost;
        body.add(bar);
      }
    }
  }
  // Driver
  const d = def.driver;
  const head = new THREE.Group();
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), mat("#e8b98c"));
  head.add(face);
  if (d.helmet) {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(d.helmet));
    helmet.position.y = 0.02;
    head.add(helmet);
  }
  head.position.set(d.x, d.y, BODY_DEPTH * 0.22);
  body.add(head);
  if (!ghost && !def.plane) addBodyDetails(body, def, mat);
  // Plane: wings, tail, propeller (the propeller spins, so it's kept out of the merge)
  const spinners: THREE.Object3D[] = [];
  if (def.plane) spinners.push(...addPlaneParts(body, def, mat, ghost));
  // Lights
  const tails: THREE.MeshStandardMaterial[] = [];
  if (!ghost) {
    for (const z of [BODY_DEPTH / 2 - 0.25, -BODY_DEPTH / 2 + 0.25]) {
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfffbe0, emissive: 0xfff2b0, emissiveIntensity: 1.5 }));
      hl.position.set(def.headlight.x + 0.03, def.headlight.y, z);
      const tailMat = new THREE.MeshStandardMaterial({ color: 0xff3a1a, emissive: 0xff2a10, emissiveIntensity: 1.2 });
      tails.push(tailMat);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.18), tailMat);
      tl.position.set(def.taillight.x - 0.02, def.taillight.y, z);
      body.add(hl, tl);
    }
  }
  // Decorative extra axles (spin with the front wheel)
  const extraWheels: THREE.Group[] = [];
  for (const ew of def.extraWheels ?? []) {
    const pair = buildWheelPair(def, ew.r, ghost);
    pair.position.set(ew.x, ew.y, 0);
    body.add(pair);
    extraWheels.push(pair);
  }
  // Rocket engines: two nozzles at the back, each with a flame that grows with thrust
  const flames: THREE.Object3D[] = [];
  if (def.rocket && !ghost) {
    const rk = def.rocket;
    const metal = std("#5b616a", 0.35, 0.9);
    for (const z of rk.zs ?? [BODY_DEPTH * 0.22, -BODY_DEPTH * 0.22]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.36, 16, 1, true), metal);
      nozzle.rotation.z = Math.PI / 2;
      nozzle.position.set(rk.x - 0.1, rk.y, z);
      body.add(nozzle);
      const flame = new THREE.Group();
      flame.position.set(rk.x - 0.28, rk.y, z);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1.0, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      outer.rotation.z = Math.PI / 2;
      outer.position.x = -0.5;
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      core.rotation.z = Math.PI / 2;
      core.position.x = -0.3;
      flame.add(outer, core);
      flame.visible = false;
      body.add(flame);
      flames.push(flame);
    }
  }
  if (!ghost) mergeByLook(body, new Set<THREE.Object3D>([head, ...extraWheels, ...flames, ...spinners]));
  return { body, extraWheels, head, tails, flames, spinners };
}

/** A key for "looks the same": meshes with equal keys can share one draw call. */
function lookKey(m: THREE.Material): string {
  const k = m as THREE.MeshPhysicalMaterial;
  return [
    m.type,
    k.color?.getHexString(),
    k.emissive?.getHexString(),
    k.emissiveIntensity,
    k.roughness,
    k.metalness,
    k.clearcoat,
    m.transparent,
    m.opacity,
    k.map?.uuid,
  ].join("|");
}

/**
 * Merges a group's direct child meshes that look the same into one mesh each (fewer draw calls:
 * a car goes from ~100 to ~12). Objects in `keep` (moving parts) are left alone.
 */
function mergeByLook(group: THREE.Group, keep: Set<THREE.Object3D>): void {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean; meshes: THREE.Mesh[] }>();
  const visit = (o: THREE.Object3D) => {
    if (keep.has(o)) return;
    if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) {
      const m = o as THREE.Mesh;
      if (Array.isArray(m.material)) return;
      const key = lookKey(m.material);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: m.material, geos: [], shadow: false, meshes: [] }));
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
      g.clearGroups();
      b.geos.push(g);
      b.shadow ||= m.castShadow;
      b.meshes.push(m);
      return;
    }
    for (const c of [...o.children]) visit(c);
  };
  for (const c of [...group.children]) visit(c);
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) {
      for (const g of b.geos) g.dispose();
      continue;
    }
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    for (const m of b.meshes) {
      m.parent?.remove(m);
      if (!SHARED_GEOS.has(m.geometry) && m.geometry !== POST_GEO && m.geometry !== SHARD_GEO) m.geometry.dispose();
      if (m.material !== b.mat && !SHARED_MATS.has(m.material as THREE.Material)) (m.material as THREE.Material).dispose();
    }
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Drop groups left empty by the merge
  for (const c of [...group.children]) if ((c as THREE.Group).isGroup && c.children.length === 0 && !keep.has(c)) group.remove(c);
}

/**
 * Real-car details on the extruded body: bumpers, number plates, a grille, side mirrors,
 * door seams and handles. Positions come from the vehicle's own outline.
 */
function addBodyDetails(body: THREE.Group, def: VehicleDef, mat: (color: string, opts?: THREE.MeshStandardMaterialParameters) => THREE.Material): void {
  const solid = def.parts.filter((p) => p.fill !== GLASS && p.solid !== false);
  const pts = solid.flatMap((p) => p.pts);
  if (pts.length === 0) return;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const side = BODY_DEPTH / 2;
  const trim = std("#1b1c20", 0.65, 0.05);
  const chrome = std("#d9dde3", 0.15, 1);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    body.add(mesh);
    return mesh;
  };
  // Bumpers front and back, with number plates
  const plateMat = std("#f4f1e6", 0.5, 0);
  for (const [x, dir] of [
    [maxX, 1],
    [minX, -1],
  ] as const) {
    add(new THREE.BoxGeometry(0.16, 0.17, BODY_DEPTH + 0.1), trim, x + dir * 0.03, minY + 0.1, 0);
    add(new THREE.BoxGeometry(0.02, 0.13, 0.42), plateMat, x + dir * 0.115, minY + 0.12, 0);
  }
  // Grille between the headlights
  const gx = Math.min(def.headlight.x, maxX) + 0.02;
  add(new THREE.BoxGeometry(0.03, 0.17, BODY_DEPTH * 0.46), trim, gx, def.headlight.y - 0.04, 0);
  for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.035, 0.018, BODY_DEPTH * 0.44), chrome, gx + 0.005, def.headlight.y - 0.1 + k * 0.06, 0);
  // Wheel arches: dark flared fenders over each wheel (at its resting height)
  for (const wd of def.plane ? [] : [...def.wheels, ...(def.extraWheels ?? [])]) {
    for (const z of [side + 0.035, -side - 0.035]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(wd.r * 1.12, Math.max(0.045, wd.r * 0.11), 6, 18, Math.PI), trim);
      arch.position.set(wd.x, wd.y, z);
      arch.scale.z = 0.6;
      arch.castShadow = true;
      body.add(arch);
    }
  }
  // Side molding: a thin chrome line along the body
  const moldY = minY + 0.13;
  for (const z of [side + 0.004, -side - 0.004]) add(new THREE.BoxGeometry(maxX - minX - 0.1, 0.022, 0.012), chrome, (minX + maxX) / 2, moldY, z);
  // Headlight bezels: a chrome ring around each lamp
  for (const z of [side - 0.25, -side + 0.25]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), chrome);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(def.headlight.x + 0.035, def.headlight.y, z);
    body.add(ring);
  }
  // Cab details from the window outline: mirrors, door seams and handles
  const glass = def.parts.find((p) => p.fill === GLASS);
  if (glass) {
    const gxs = glass.pts.map((p) => p.x);
    const gys = glass.pts.map((p) => p.y);
    const g0 = Math.min(...gxs);
    const g1 = Math.max(...gxs);
    const gy = Math.min(...gys);
    for (const z of [side + 0.002, -side - 0.002]) {
      const out = Math.sign(z);
      // Side mirror on a short arm
      add(new THREE.BoxGeometry(0.05, 0.04, 0.1), trim, g1 - 0.04, gy + 0.03, z + out * 0.05);
      add(new THREE.BoxGeometry(0.1, 0.09, 0.07), mat(bodyFill(def)), g1 - 0.03, gy + 0.07, z + out * 0.11);
      // Door seams (front and back of the door) and a handle
      const seamH = Math.max(0.1, gy - minY - 0.12);
      for (const x of [g0 - 0.03, g1 + 0.02]) add(new THREE.BoxGeometry(0.012, seamH, 0.006), trim, x, minY + 0.08 + seamH / 2, z);
      add(new THREE.BoxGeometry(0.12, 0.025, 0.02), chrome, g0 + 0.12, gy - 0.1, z + out * 0.006);
      // Black rubber frame around the side window
      const pts = glass.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.02) continue;
        const seal = add(new THREE.BoxGeometry(len + 0.03, 0.035, 0.012), trim, (a.x + b.x) / 2, (a.y + b.y) / 2, z + out * 0.012);
        seal.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      }
    }
  }
}

/** The main paint color of a vehicle (its largest solid part). */
function bodyFill(def: VehicleDef): string {
  let best = def.parts[0];
  let bestArea = -1;
  for (const p of def.parts) {
    if (p.fill === GLASS) continue;
    const xs = p.pts.map((q) => q.x);
    const ys = p.pts.map((q) => q.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return best.fill;
}

/** A tire + rim on each side of the car, rotating together (axis along z). */
export function buildWheelPair(def: VehicleDef, r: number, ghost: boolean): THREE.Group {
  const g = buildWheelPairParts(def, r, ghost);
  if (!ghost) mergeByLook(g, new Set());
  return g;
}

function buildWheelPairParts(def: VehicleDef, r: number, ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  const tireMat = ghost
    ? new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.3, depthWrite: false })
    : std(def.wheelColor, 0.9, 0);
  const rimMat = ghost
    ? new THREE.MeshStandardMaterial({ color: new THREE.Color(def.hubColor), transparent: true, opacity: 0.3, depthWrite: false })
    : std(def.hubColor, 0.18, 1.0);
  const width = Math.min(0.42, r * 0.85);
  for (const z of [BODY_DEPTH / 2 + width / 2 - 0.05, -BODY_DEPTH / 2 - width / 2 + 0.05]) {
    const tire = new THREE.Mesh(tireGeometry(r, width), tireMat);
    tire.rotation.x = Math.PI / 2;
    tire.position.z = z;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.56, r * 0.56, width + 0.02, 20), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.z = z;
    // Spokes so the rotation is visible
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(r * 0.95, r * 0.12, width + 0.04), tireMat);
      spoke.rotation.z = (k / 5) * Math.PI;
      spoke.position.z = z;
      g.add(spoke);
    }
    tire.castShadow = !ghost;
    g.add(tire, rim);
    if (!ghost) {
      // Center cap and lug nuts on the outer face
      const face = z + Math.sign(z) * (width / 2 + 0.012);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.18, 0.03, 16), rimMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = face;
      g.add(cap);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const nut = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.045, r * 0.045, 0.03, 6), std("#8d939c", 0.3, 1));
        nut.rotation.x = Math.PI / 2;
        nut.position.set(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, face);
        g.add(nut);
      }
    }
  }
  return g;
}

// ---------- pickups ----------

function makeCoin(big: boolean, glow: THREE.Texture): THREE.Group {
  const r = big ? 0.6 : 0.32;
  const g = new THREE.Group();
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, big ? 0.14 : 0.08, 28),
    std("#ffcc33", 0.3, 0.85, { emissive: new THREE.Color(big ? "#a06800" : "#5a3a00"), emissiveIntensity: big ? 0.8 : 0.4 }),
  );
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = true;
  g.add(coin);
  if (big) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd84a, transparent: true, opacity: 0.8, depthWrite: false }));
    halo.scale.setScalar(2.6);
    g.add(halo);
  }
  return g;
}

function makePickup(kind: "glue" | "fuel" | "life", glow: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: kind === "glue" ? 0x78b4ff : kind === "life" ? 0xff7896 : 0xffdc78,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(1.9);
  g.add(halo);
  if (kind === "glue") {
    g.add(makeGlueBottle3D());
  } else if (kind === "fuel") {
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.84, 0.32), std("#d8322a", 0.45, 0.2));
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.1), std("#9c1f19", 0.5));
    handle.position.set(-0.1, 0.48, 0);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 10), std("#e0b000", 0.4, 0.5));
    spout.position.set(0.2, 0.5, 0);
    g.add(can, handle, spout);
  } else {
    const s = new THREE.Shape();
    s.moveTo(0, -0.42);
    s.bezierCurveTo(-0.55, 0, -0.38, 0.45, 0, 0.2);
    s.bezierCurveTo(0.38, 0.45, 0.55, 0, 0, -0.42);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    geo.translate(0, 0, -0.11);
    const heart = new THREE.Mesh(geo, std("#e83a5c", 0.35, 0.1, { emissive: new THREE.Color("#5a0a1a"), emissiveIntensity: 0.6 }));
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), std("#fff8ec", 0.4));
    egg.scale.y = 1.3;
    egg.position.z = 0.16;
    g.add(heart, egg);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

// ---------- features ----------

/**
 * A big steel jump ramp: a thick diamond-plate deck following the ramp's curve, raised side
 * rails, a steel truss frame underneath (legs and cross-bracing) and a hazard stripe on the lip.
 */
function makeRampProps(t: Terrain, lip: number): THREE.Group {
  const g = new THREE.Group();
  const start = lip - RAMP.length;
  const base = Math.min(t.height(start - 1), t.height(lip)) - 0.05;
  const half = ROAD + 0.15;
  const steel = std("#8d939c", 0.38, 0.85);
  const dark = std("#4a4f57", 0.5, 0.8);
  // Deck: a curved plate with thickness, from the ground up to the lip
  const n = 24;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const TH = 0.14;
  for (let i = 0; i <= n; i++) {
    const x = start + (i / n) * RAMP.length;
    const y = t.height(x) + 0.03;
    for (const [z, yy, v] of [
      [-half, y, 0],
      [half, y, 1],
      [-half, y - TH, 0],
      [half, y - TH, 1],
    ] as const) {
      pos.push(x, yy, z);
      uv.push(x / 1.2, v * 4);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4;
    const b = a + 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1); // top
    idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // underside
    idx.push(a, a + 2, b, a + 2, b + 2, b); // side -z
    idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // side +z
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  deckGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  deckGeo.setIndex(idx);
  deckGeo.computeVertexNormals();
  const plate = diamondPlate();
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: 0xb4bac2, map: plate, bumpMap: plate, bumpScale: 2.5, roughness: 0.32, metalness: 0.9 }));
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  // Side rails along both edges
  for (const z of [-half, half]) {
    for (let i = 0; i < n; i++) {
      const x0 = start + (i / n) * RAMP.length;
      const x1 = start + ((i + 1) / n) * RAMP.length;
      const y0 = t.height(x0) + 0.12;
      const y1 = t.height(x1) + 0.12;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, 0.16, 0.1), dark);
      rail.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
      rail.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      rail.castShadow = true;
      g.add(rail);
    }
  }
  // Truss underneath: legs at intervals on both sides, with diagonal braces between them
  const legs: number[] = [];
  for (let x = start + 1.4; x <= lip + 0.001; x += 1.4) legs.push(Math.min(x, lip - 0.1));
  for (const z of [-half + 0.1, half - 0.1]) {
    legs.forEach((x, i) => {
      const top = t.height(x) - TH;
      const hgt = top - base;
      if (hgt < 0.15) return;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, hgt, 0.12), steel);
      leg.position.set(x, base + hgt / 2, z);
      leg.castShadow = true;
      g.add(leg);
      const prev = legs[i - 1];
      if (prev !== undefined) {
        const ptop = t.height(prev) - TH;
        // Diagonal brace from the bottom of this leg to the top of the previous one
        const dx = x - prev;
        const dy = base - ptop;
        const brace = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), 0.06, 0.06), steel);
        brace.position.set((x + prev) / 2, (base + ptop) / 2, z);
        brace.rotation.z = Math.atan2(dy, dx);
        g.add(brace);
      }
    });
  }
  // Cross beams under the deck at each leg, and a heavy end frame at the lip
  for (const x of legs) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, half * 2), dark);
    beam.position.set(x, t.height(x) - TH - 0.05, 0);
    g.add(beam);
  }
  const ly = t.height(lip);
  const endPlate = new THREE.Mesh(new THREE.BoxGeometry(0.1, Math.max(0.2, ly - base), half * 2), steel);
  endPlate.position.set(lip + 0.02, base + (ly - base) / 2, 0);
  endPlate.castShadow = true;
  g.add(endPlate);
  // Yellow/black hazard stripe across the lip
  for (let k = 0; k < 10; k++) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, (half * 2) / 10), std(k % 2 ? "#1c1c1f" : "#f5c400", 0.5, 0.2));
    block.position.set(lip - 0.16, ly + 0.06, -half + ((k + 0.5) * half * 2) / 10);
    g.add(block);
  }
  g.add(warningSign(t, lip - RAMP.length - 5, "⤴"));
  return g;
}

let plateTex: THREE.CanvasTexture | null = null;
/** Diamond-tread steel plate: raised lozenges in a staggered grid (also used as the bump map). */
function diamondPlate(): THREE.CanvasTexture {
  if (plateTex) return plateTex;
  plateTex = noiseCanvas(256, (g, n) => {
    g.fillStyle = "#9a9a9a";
    g.fillRect(0, 0, n, n);
    // Fine brushed grain
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${hash(i) > 0.5 ? "255,255,255" : "0,0,0"},0.05)`;
      g.fillRect(hash(i + 1) * n, hash(i + 2) * n, 6 + hash(i + 3) * 18, 1);
    }
    const cell = n / 8;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const cx = col * cell + (row % 2 ? cell / 2 : 0) + cell / 4;
        const cy = row * cell + cell / 2;
        const ang = (row + col) % 2 ? 0.6 : -0.6;
        g.save();
        g.translate(cx, cy);
        g.rotate(ang);
        g.fillStyle = "#e4e4e4";
        g.beginPath();
        g.ellipse(0, 0, cell * 0.36, cell * 0.09, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.beginPath();
        g.ellipse(cell * 0.03, cell * 0.04, cell * 0.36, cell * 0.09, 0, 0, Math.PI);
        g.fill();
        g.restore();
      }
    }
  });
  plateTex.colorSpace = THREE.NoColorSpace;

  return plateTex;
}

function warningSign(t: Terrain, x: number, icon: string): THREE.Group {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.translate(64, 64);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#f5c400";
  ctx.strokeStyle = "#2b1d12";
  ctx.lineWidth = 8;
  ctx.fillRect(-40, -40, 80, 80);
  ctx.strokeRect(-40, -40, 80, 80);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = "#2b1d12";
  ctx.font = "bold 54px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon, 0, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  board.position.y = 1.9;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), std("#5a3d22", 0.8));
  post.position.y = 0.75;
  g.add(board, post);
  g.position.set(x, t.height(x), -ROAD - 0.9);
  return g;
}

function makeBridge(t: Terrain, fork: Fork): THREE.Group {
  const g = new THREE.Group();
  const wood = std("#a8743e", 0.8);
  const dark = std("#5e3b1d", 0.85);
  const stone = std("#8a7660", 0.9);
  const span = (a: number, b: number) => {
    for (let d = a; d < b - 1e-6; d += STEP) {
      const d2 = Math.min(b, d + STEP);
      const y1 = t.deckHeight(fork, d);
      const y2 = t.deckHeight(fork, d2);
      const len = Math.hypot(d2 - d, y2 - y1);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, ROAD * 2 + 0.3), Math.round(d * 2) % 2 ? wood : dark);
      plank.position.set(fork.x + (d + d2) / 2, (y1 + y2) / 2 - 0.11, 0);
      plank.rotation.z = Math.atan2(y2 - y1, d2 - d);
      plank.castShadow = true;
      plank.receiveShadow = true;
      g.add(plank);
    }
    for (let d = a; d <= b + 1e-6; d += 2.5) {
      for (const z of [ROAD + 0.1, -ROAD - 0.1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), dark);
        post.position.set(fork.x + d, t.deckHeight(fork, d) + 0.47, z);
        g.add(post);
      }
    }
  };
  span(0, FORK.gapStart);
  span(FORK.gapEnd, FORK.length);
  for (const d of [FORK.slope + 1, FORK.gapStart - 1.5, FORK.gapEnd + 1.5, FORK.length - FORK.slope - 1]) {
    const top = t.deckHeight(fork, d) - 0.2;
    const floor = t.height(fork.x + d) - 1;
    for (const z of [ROAD - 0.5, -ROAD + 0.5]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, top - floor, 0.6), stone);
      pillar.position.set(fork.x + d, (top + floor) / 2, z);
      pillar.castShadow = true;
      g.add(pillar);
    }
  }
  g.add(warningSign(t, fork.x - 9, "⑂"));
  return g;
}

function makeFinish(t: Terrain, x: number, label: string): THREE.Group {
  const g = new THREE.Group();
  const y = t.height(x);
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 16; col++) {
      ctx.fillStyle = (row + col) % 2 ? "#111" : "#f4f4f4";
      ctx.fillRect(col * 32, row * 32, 32, 32);
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(150, 18, 212, 60);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 44px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(ROAD * 2 + 1, 1.0), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  banner.rotation.y = Math.PI / 2;
  banner.position.set(x, y + 4.1, 0);
  g.add(banner);
  for (const z of [ROAD + 0.5, -ROAD - 0.5]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 10), std("#d8d8d8", 0.3, 0.7));
    pole.position.set(x, y + 2.3, z);
    pole.castShadow = true;
    g.add(pole);
  }
  // Checkered line on the road
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.6, ROAD * 2), new THREE.MeshLambertMaterial({ map: tex }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.PI / 2;
  line.position.set(x, y + 0.03, 0);
  g.add(line);
  return g;
}

function makeSplat(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshStandardMaterial({ color: 0xfffdf5, roughness: 0.2 }));
  white.rotation.x = -Math.PI / 2;
  white.scale.set(1.3, 1, 1);
  const yolk = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.15 }),
  );
  yolk.scale.y = 0.45;
  yolk.position.y = 0.01;
  g.add(white, yolk);
  return g;
}

// ---------- scenery ----------

/** Low-poly 3D version of each terrain's roadside decoration. */
function makeDecor(map: MapDef, k: number): THREE.Group {
  const [c1, c2] = map.decorColors;
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z = 0, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.Mesh(shared(geo), decorMat(color, opts));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (map.decor) {
    case "tree":
    case "maple":
    case "sakura":
    case "jungle": {
      // A real-looking broadleaf: tapered trunk with two limbs, and a lumpy canopy of leaf
      // clusters, darker underneath and sunlit on top.
      const v = Math.floor(hash(k * 977) * 3);
      const tall = map.decor === "jungle" ? 2.2 : 1.25;
      const leaf = map.decor === "sakura" ? mixColor(c2, "#ffffff", 0.2) : c2;
      const dark = mixColor(leaf, "#0b1a08", 0.32);
      const lit = mixColor(leaf, "#fff8d0", 0.16);
      add(cylGeo(0.07, 0.17, tall, 7), c1, 0, tall / 2);
      add(cylGeo(0.035, 0.07, 0.75, 6), c1, 0.22, tall * 0.78, 0.05).rotation.z = -0.75;
      add(cylGeo(0.035, 0.07, 0.65, 6), c1, -0.2, tall * 0.85, -0.08).rotation.z = 0.7;
      const clusters: [number, number, number, number, string][] = [
        [0, tall + 0.45, 0, 0.62, leaf],
        [-0.45, tall + 0.18, 0.15, 0.46, dark],
        [0.48, tall + 0.22, -0.12, 0.48, dark],
        [0.1, tall + 0.1, 0.42, 0.42, dark],
        [-0.12, tall + 0.15, -0.42, 0.42, leaf],
        [-0.22, tall + 0.72, 0.1, 0.4, lit],
        [0.28, tall + 0.68, -0.05, 0.38, lit],
      ];
      for (let i = 0; i < clusters.length - (v === 2 ? 2 : 0); i++) {
        const [x, y, z, r, col] = clusters[i];
        const m = add(blobGeo(r, (i + v) % 3), col, x * (v === 1 ? 1.15 : 1), y, z);
        m.rotation.y = i * 1.3 + v;
      }
      break;
    }
    case "pine": {
      // Layered conifer: four drooping tiers, darker toward the bottom (snow on top only where it snows)
      add(cylGeo(0.06, 0.13, 0.9, 6), c1, 0, 0.45);
      const tiers = [
        [0.85, 0.75, 0.7],
        [0.7, 0.7, 1.15],
        [0.55, 0.62, 1.55],
        [0.38, 0.55, 1.92],
      ];
      tiers.forEach(([r, h, y], i) => add(coneGeo(r, h, 9), mixColor(c2, "#06140a", 0.25 - i * 0.07), 0, y).rotation.y = i * 0.6);
      if (map.snow) {
        add(coneGeo(0.22, 0.32, 9), "#f4f8ff", 0, 2.12);
        add(coneGeo(0.5, 0.18, 9), "#eef4ff", 0, 1.68);
      }
      break;
    }
    case "cactus":
      add(cylGeo(0.13, 0.15, 1.5), c1, 0, 0.75);
      add(cylGeo(0.09, 0.09, 0.5), c1, -0.32, 0.95).rotation.z = 0.1;
      add(cylGeo(0.09, 0.09, 0.45), c1, 0.3, 1.05).rotation.z = -0.1;
      break;
    case "palm": {
      // Curving segmented trunk, a coconut cluster, and long fronds that arch up then droop
      const segs = 5;
      let px = 0;
      let py = 0;
      for (let i = 0; i < segs; i++) {
        const lean = 0.05 + i * 0.05;
        const len = 0.46;
        const seg = add(cylGeo(0.075 - i * 0.006, 0.09 - i * 0.006, len, 7), mixColor(c1, "#000000", (i % 2) * 0.12), px + Math.sin(lean) * len * 0.5, py + Math.cos(lean) * len * 0.5);
        seg.rotation.z = -lean;
        px += Math.sin(lean) * len;
        py += Math.cos(lean) * len;
      }
      for (let i = 0; i < 3; i++) add(sphereGeo(0.08), "#5a3a1a", px + Math.cos(i * 2.1) * 0.08, py - 0.08, Math.sin(i * 2.1) * 0.08);
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const col = i % 2 ? c2 : mixColor(c2, "#0b1a08", 0.2);
        // Inner half rises, outer half droops
        const inner = add(boxGeo(0.6, 0.03, 0.2), col, px, py + 0.05);
        inner.rotation.set(0, ang, 0.35);
        inner.translateX(0.28);
        const outer = add(boxGeo(0.62, 0.03, 0.16), col, px, py + 0.05);
        outer.rotation.set(0, ang, 0.35);
        outer.translateX(0.55);
        outer.rotateZ(-0.95);
        outer.translateX(0.26);
      }
      break;
    }
    case "acacia": {
      // Savanna acacia: forked trunk and a wide, flat, layered umbrella canopy
      add(cylGeo(0.06, 0.11, 1.2, 6), c1, 0, 0.6);
      add(cylGeo(0.04, 0.06, 0.8, 6), c1, 0.25, 1.45).rotation.z = -0.55;
      add(cylGeo(0.04, 0.06, 0.8, 6), c1, -0.22, 1.45).rotation.z = 0.5;
      const top = add(blobGeo(1.0, 1), mixColor(c2, "#0b1a08", 0.2), 0, 1.78);
      top.scale.set(1.45, 0.24, 1.25);
      const lid = add(blobGeo(0.8, 2), mixColor(c2, "#fff8d0", 0.1), 0.15, 1.92);
      lid.scale.set(1.3, 0.2, 1.1);
      break;
    }
    case "rock":
    case "mesa":
    case "spire": {
      const geo = map.decor === "spire" ? coneGeo(0.45, 2.2, 6) : map.decor === "mesa" ? cylGeo(0.5, 0.7, 1.1, 7) : dodecaGeo(0.5);
      add(geo, c1, 0, map.decor === "spire" ? 1.1 : map.decor === "mesa" ? 0.55 : 0.25);
      break;
    }
    case "crystal":
      for (const [x, h, lean] of [
        [-0.2, 0.9, -0.2],
        [0.05, 1.3, 0],
        [0.3, 0.7, 0.25],
      ]) {
        add(coneGeo(0.13, h, 5), c1, x, h / 2, 0, { emissive: new THREE.Color(c1), emissiveIntensity: 0.6 }).rotation.z = lean;
      }
      break;
    case "lamp": {
      add(cylGeo(0.05, 0.06, 2.6), c1, 0, 1.3);
      add(boxGeo(0.6, 0.06, 0.06), c1, 0.28, 2.55);
      add(sphereGeo(0.14), c2, 0.55, 2.45, 0, { emissive: new THREE.Color(c2), emissiveIntensity: 1.6 });
      break;
    }
    case "reed":
      for (const [x, h] of [
        [-0.2, 1.1],
        [0, 1.4],
        [0.18, 1.2],
      ]) {
        add(cylGeo(0.02, 0.025, h, 5), c1, x, h / 2);
        add(cylGeo(0.05, 0.05, 0.25, 6), c2, x, h - 0.1);
      }
      break;
    case "lollipop":
      add(cylGeo(0.05, 0.05, 1.5), "#fff8ee", 0, 0.75);
      add(cylGeo(0.55, 0.55, 0.12, 24), c2, 0, 1.9).rotation.x = Math.PI / 2;
      add(torusGeo(0.32, 0.07), c1, 0, 1.9, 0.07);
      break;
    case "deadtree": {
      add(cylGeo(0.06, 0.12, 1.7, 6), c1, 0, 0.85);
      for (const [x, y, rz] of [
        [0.3, 1.3, -0.9],
        [-0.3, 1.5, 0.9],
        [0.12, 1.8, -0.4],
      ]) {
        add(cylGeo(0.03, 0.05, 0.7, 5), c1, x, y).rotation.z = rz;
      }
      add(boxGeo(0.34, 0.45, 0.1), c2, 0.65, 0.22);
      break;
    }
    case "robot": {
      // Factory clutter away from the belt: stacked crates and a drum
      add(boxGeo(0.9, 0.9, 0.9), "#9a6a3a", 0, 0.45);
      add(boxGeo(0.7, 0.7, 0.7), "#86592e", 0.1, 1.25).rotation.y = 0.4;
      add(cylGeo(0.3, 0.3, 0.9, 12), c2, 0.95, 0.45);
      add(cylGeo(0.31, 0.31, 0.06, 12), c1, 0.95, 0.75);
      break;
    }
    case "coral":
      add(cylGeo(0.07, 0.1, 0.8, 6), c1, 0, 0.4);
      add(cylGeo(0.05, 0.07, 0.6, 6), c1, -0.22, 0.85).rotation.z = 0.6;
      add(cylGeo(0.05, 0.07, 0.6, 6), c1, 0.22, 0.85).rotation.z = -0.6;
      add(sphereGeo(0.3), c2, 0.6, 0.3).scale.set(1, 1.1, 0.3);
      add(cylGeo(0.03, 0.03, 1.4, 5), "#2f8a5a", -0.55, 0.7);
      break;
  }
  g.scale.setScalar(k);
  return g;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
    SHARED_GEOS.add(g);
  }
  return g;
}
const cylGeo = (rt: number, rb: number, h: number, seg = 8) => cached(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const coneGeo = (r: number, h: number, seg = 8) => cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const icoGeo = (r: number) => cached(`ico${r}`, () => new THREE.IcosahedronGeometry(r, 2));
const dodecaGeo = (r: number) => cached(`dod${r}`, () => new THREE.DodecahedronGeometry(r, 0));
const sphereGeo = (r: number) => cached(`sph${r}`, () => new THREE.SphereGeometry(r, 12, 10));
const boxGeo = (x: number, y: number, z: number) => cached(`box${x},${y},${z}`, () => new THREE.BoxGeometry(x, y, z));
const torusGeo = (r: number, t: number) => cached(`tor${r},${t}`, () => new THREE.TorusGeometry(r, t, 8, 20));
/** A lumpy, faceted leaf cluster (an icosphere with its points pushed in and out); 3 variants. */
const blobGeo = (r: number, variant: number) =>
  cached(`blob${r},${variant}`, () => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = hash(Math.round(v.x * 97) * 3.1 + Math.round(v.y * 97) * 7.7 + Math.round(v.z * 97) * 13.3 + variant * 51);
      v.multiplyScalar(0.84 + n * 0.3);
      v.y *= 0.88;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  });

const matCache = new Map<string, THREE.Material>();
function decorMat(color: string, opts: THREE.MeshStandardMaterialParameters): THREE.Material {
  const key = color + JSON.stringify(opts.emissiveIntensity ?? 0);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.88, ...opts });
    matCache.set(key, m);
    SHARED_MATS.add(m);
  }
  return m;
}

// ---------- realism helpers: textures, grass, tires ----------

const GRASSY_3D = new Set(["ascent", "countryside", "autumn", "jungle", "swamp", "savanna", "sakura", "haunted"]);

function noiseCanvas(size: number, draw: (g: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let groundMat: THREE.MeshStandardMaterial | null = null;
/** Ground: vertex colors from the map, broken up by a fine grain texture. */
function groundMaterial(): THREE.MeshStandardMaterial {
  if (!groundMat) {
    const tex = detailTexture();
    groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 2.2, roughness: 0.95, metalness: 0 });
    // Break up tiling with large, soft light/dark patches sampled from the same texture at a big scale
    groundMat.onBeforeCompile = (shader) => {
      // The texture's red channel is the fine grey detail, green is the large-scale patches:
      // use them as brightness only (the standard map step would tint the ground by them).
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          float detail = texture2D(map, vMapUv).r;
          float macro = texture2D(map, vMapUv * 0.071 + vec2(0.37, 0.11)).g;
          diffuseColor.rgb *= (0.55 + 0.5 * detail) * (0.84 + 0.32 * macro);
        #endif`,
      );
    };
    SHARED_MATS.add(groundMat);
  }
  return groundMat;
}

/**
 * Tileable ground detail: several octaves of smooth noise (clumps, ripples) plus grit, as a
 * light grey texture (≈1 on average, so it shades the terrain colors without darkening them).
 * Also used as the bump map, so the ground catches the light like a real rough surface.
 */
function detailTexture(): THREE.CanvasTexture {
  const n = 512;
  return noiseCanvas(n, (g) => {
    const img = g.createImageData(n, n);
    const lattice = (cells: number, seed: number) => {
      const v = new Float32Array(cells * cells);
      for (let i = 0; i < v.length; i++) v[i] = hash(i * 1.37 + seed * 101.3);
      return (x: number, y: number) => {
        const fx = (x / n) * cells;
        const fy = (y / n) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (cx: number, cy: number) => v[((cy % cells) + cells) % cells * cells + (((cx % cells) + cells) % cells)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        return a + (b - a) * sy;
      };
    };
    const octaves = [lattice(4, 1), lattice(8, 2), lattice(16, 3), lattice(32, 4), lattice(64, 5)];
    const weights = [0.32, 0.26, 0.2, 0.14, 0.08];
    const macro = lattice(3, 9);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let o = 0; o < octaves.length; o++) v += octaves[o](x, y) * weights[o];
        const grit = hash(x * 7.13 + y * 131.7) > 0.86 ? (hash(x + y * 3.1) - 0.5) * 0.35 : 0;
        const r = Math.max(0, Math.min(1, 0.7 + (v - 0.5) * 0.75 + grit));
        const i = (y * n + x) * 4;
        img.data[i] = r * 255;
        img.data[i + 1] = macro(x, y) * 255; // green channel: the large-scale patches
        img.data[i + 2] = r * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

const roadMats = new Map<string, THREE.MeshStandardMaterial>();
/** Packed dirt (or asphalt in the city) with gravel and two worn wheel ruts along the road. */
function roadMaterial(map: MapDef): THREE.MeshStandardMaterial {
  let m = roadMats.get(map.id);
  if (m) return m;
  if (map.conveyor) {
    m = beltMaterial();
    SHARED_MATS.add(m);
    roadMats.set(map.id, m);
    return m;
  }
  const asphalt = !!map.skyline;
  const baseColor = asphalt ? "#4a4c53" : mixColor(map.ground, "#ffffff", 0.2);
  const tex = noiseCanvas(512, (g, n) => {
    g.fillStyle = baseColor;
    g.fillRect(0, 0, n, n);
    // Wheel ruts (v runs across the road; the tires sit near 0.32 and 0.68)
    for (const v of [0.32, 0.68]) {
      const grad = g.createLinearGradient(0, (v - 0.09) * n, 0, (v + 0.09) * n);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, asphalt ? "rgba(0,0,0,0.25)" : "rgba(60,35,15,0.28)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, (v - 0.09) * n, n, 0.18 * n);
    }
    // Gravel and grit
    for (let i = 0; i < 14000; i++) {
      const light = hash(i * 1.7) > 0.5;
      g.fillStyle = light ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.14)";
      const s = 1 + hash(i + 9) * (asphalt ? 1.5 : 3);
      g.fillRect(hash(i + 3) * n, hash(i + 5) * n, s, s);
    }
    // Faint tire tread streaks along the ruts
    g.strokeStyle = asphalt ? "rgba(0,0,0,0.12)" : "rgba(40,25,10,0.1)";
    for (let i = 0; i < 60; i++) {
      const v = (hash(i) > 0.5 ? 0.32 : 0.68) + (hash(i + 1) - 0.5) * 0.08;
      g.lineWidth = 1 + hash(i + 2) * 2;
      g.beginPath();
      g.moveTo(0, v * n);
      g.lineTo(n, v * n + (hash(i + 3) - 0.5) * 6);
      g.stroke();
    }
    // Soft edges blending into the verge
    for (const [a, b] of [
      [0, 0.06],
      [0.94, 1],
    ]) {
      const grad = g.createLinearGradient(0, a * n, 0, b * n);
      grad.addColorStop(a === 0 ? 0 : 1, "rgba(0,0,0,0.25)");
      grad.addColorStop(a === 0 ? 1 : 0, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, a * n, n, (b - a) * n);
    }
    if (asphalt) {
      g.fillStyle = "rgba(255,255,255,0.75)";
      for (let x = 0; x < n; x += n / 2) g.fillRect(x, n * 0.495, n * 0.25, n * 0.012);
    }
  });
  m = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: asphalt ? 0.8 : 1.6, roughness: asphalt ? 0.8 : 0.97, metalness: 0 });
  SHARED_MATS.add(m);
  roadMats.set(map.id, m);
  return m;
}

let tuftGeo: THREE.BufferGeometry | null = null;
/** A small clump of grass: a few thin, leaning blades. */
function tuftGeometry(): THREE.BufferGeometry {
  if (tuftGeo) return tuftGeo;
  const pos: number[] = [];
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + hash(b) * 0.6;
    const r = 0.05 + hash(b + 3) * 0.08;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = 0.22 + hash(b + 7) * 0.2;
    const lean = 0.06 + hash(b + 11) * 0.08;
    const w = 0.025;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  tuftGeo = shared(g);
  return tuftGeo;
}

let tuftMat: THREE.MeshStandardMaterial | null = null;
function tuftMaterial(): THREE.MeshStandardMaterial {
  if (!tuftMat) {
    tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    SHARED_MATS.add(tuftMat);
  }
  return tuftMat;
}

/** A tire with rounded shoulders (lathe profile around the y axis, later turned to face sideways). */
function tireGeometry(r: number, width: number): THREE.BufferGeometry {
  return cached(`tire${r},${width}`, () => {
    const inner = r * 0.6;
    const hw = width / 2;
    const round = Math.min(hw * 0.7, r * 0.2);
    const cx = r - round;
    const pts: THREE.Vector2[] = [new THREE.Vector2(inner, -hw)];
    // Shoulder 1: quarter circle from the sidewall onto the tread
    for (let k = 0; k <= 6; k++) {
      const ang = -Math.PI / 2 + (k / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + round * Math.cos(ang), -hw + round + round * Math.sin(ang)));
    }
    // Shoulder 2: from the tread back down the other sidewall
    for (let k = 0; k <= 6; k++) {
      const ang = (k / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + round * Math.cos(ang), hw - round + round * Math.sin(ang)));
    }
    pts.push(new THREE.Vector2(inner, hw));
    return new THREE.LatheGeometry(pts, 32);
  });
}

// ---------- sky dome ----------

/** A CSS color ("#rgb", "#rrggbb", "rgb()", "rgba()") as sRGB components 0..1, plus alpha. */
function srgb(c: string): [THREE.Vector3, number] {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return [new THREE.Vector3(p[0] / 255, p[1] / 255, p[2] / 255), p[3] ?? 1];
  }
  const col = new THREE.Color(c);
  const out = { r: 0, g: 0, b: 0 };
  col.getRGB(out, THREE.SRGBColorSpace);
  return [new THREE.Vector3(out.r, out.g, out.b), 1];
}

function setSkyUniforms(mat: THREE.ShaderMaterial, map: MapDef): void {
  const u = mat.uniforms;
  u.uTop.value = srgb(map.sky[0])[0];
  u.uMid.value = srgb(map.sky[1])[0];
  u.uHorizon.value = srgb(map.sky[2])[0];
  u.uSunColor.value = srgb(map.sun.color)[0];
  const [glow, ga] = srgb(map.sun.glow);
  u.uGlow.value = glow.multiplyScalar(ga * 1.6);
  u.uSunSize.value = Math.cos(0.032 * (map.sun.radius / 44));
  u.uShowSun.value = map.planet ? 0 : 1;
  u.uStars.value = map.stars ? 1 : 0;
  if (map.clouds) {
    const [cc, ca] = srgb(map.clouds);
    u.uCloud.value = cc;
    u.uCloudAmt.value = (map.wet ? 0.95 : 0.6) * Math.min(1, ca + 0.1);
  } else u.uCloudAmt.value = 0;
}

/**
 * Sky dome shader: an atmospheric gradient (horizon → sky → zenith), a sun disc with a halo,
 * drifting fbm clouds that are brighter on the sun side and shaded underneath, and twinkling
 * stars at night. Colors are given and written in sRGB (no tone mapping), like the old painted sky.
 */
function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Vector3(0.3, 0.6, 0.9) },
      uMid: { value: new THREE.Vector3(0.6, 0.8, 0.95) },
      uHorizon: { value: new THREE.Vector3(0.9, 0.95, 1) },
      // Low in front of the chase camera (and ahead-left from the driver's seat), so it's in view
      uSunDir: { value: new THREE.Vector3(0.6, 0.11, -0.79).normalize() },
      uSunColor: { value: new THREE.Vector3(1, 0.95, 0.7) },
      uGlow: { value: new THREE.Vector3(1, 0.9, 0.6) },
      uSunSize: { value: Math.cos(0.032) },
      uShowSun: { value: 1 },
      uCloud: { value: new THREE.Vector3(1, 1, 1) },
      uCloudAmt: { value: 0.6 },
      uStars: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uSunDir, uSunColor, uGlow, uCloud;
      uniform float uSunSize, uShowSun, uCloudAmt, uStars, uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // Atmosphere: pale and hazy at the horizon, deeper toward the zenith
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.01, 0.09, h));
        col = mix(col, uTop, smoothstep(0.08, 0.42, h));
        if (h < 0.0) col = uHorizon * (1.0 + h * 0.4);
        // Sun: halo + disc
        float s = max(dot(d, uSunDir), 0.0);
        col += uGlow * (pow(s, 10.0) * 0.28 + pow(s, 90.0) * 0.45) * uShowSun;
        col = mix(col, uSunColor * 1.05 + 0.05, smoothstep(uSunSize, uSunSize + 0.00035, s) * uShowSun);
        // Stars
        if (uStars > 0.01 && h > 0.0) {
          vec3 cell = floor(d * 380.0);
          float r = hash3(cell);
          float tw = 0.55 + 0.45 * sin(uTime * 2.3 + r * 60.0);
          col += vec3(step(0.9965, r) * tw * smoothstep(0.02, 0.35, h) * uStars);
        }
        // Clouds on a curved layer overhead, drifting with the wind
        if (uCloudAmt > 0.0 && h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.01, uTime * 0.004);
          float n = fbm(uv);
          float c = smoothstep(0.46, 0.72, n) * uCloudAmt * smoothstep(0.0, 0.07, h);
          // Self-shadowing: thicker parts of the cloud are darker underneath
          float shade = smoothstep(0.5, 0.9, fbm(uv * 1.3 + vec2(0.05, 0.08)));
          float lit = 0.88 + 0.3 * pow(s, 3.0);
          vec3 cc = uCloud * (lit - 0.32 * shade) + uGlow * 0.15 * pow(s, 6.0);
          // Distant clouds melt into the horizon haze
          cc = mix(uHorizon, cc, smoothstep(0.0, 0.12, h));
          col = mix(col, cc, c);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const BLOB_GEO = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  SHARED_GEOS.add(g);
  return g;
})();
let blobTex: THREE.Texture | null = null;
/** Each car gets its own material (its opacity follows the car's height); the texture is shared. */
function blobMaterial(): THREE.MeshBasicMaterial {
  if (!blobTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, "rgba(0,0,0,1)");
    r.addColorStop(0.55, "rgba(0,0,0,0.55)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    blobTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

// ---------- day/night palettes (sRGB, like the sky shader) ----------
const v3 = (hex: string) => {
  const c = new THREE.Color(hex);
  const o = { r: 0, g: 0, b: 0 };
  c.getRGB(o, THREE.SRGBColorSpace);
  return new THREE.Vector3(o.r, o.g, o.b);
};
const SUNSET = {
  top: v3("#3d4486"),
  mid: v3("#f2865c"),
  horizon: v3("#ffc27a"),
  cloud: v3("#ffb08e"),
  sun: v3("#ffb15e"),
  glow: v3("#ff8a4a").multiplyScalar(1.3),
  light: new THREE.Color("#ffb37a"),
};
const NIGHT = {
  top: v3("#03050f"),
  mid: v3("#0a1330"),
  horizon: v3("#1b2747"),
  cloud: v3("#202a40"),
  hemi: new THREE.Color("#2c3a66"),
};
const MOON = {
  color: v3("#eef2ff"),
  glow: v3("#5a6a9a").multiplyScalar(0.6),
  light: new THREE.Color("#9fb2ff"),
};

interface RobotArmParts {
  turret: THREE.Object3D;
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  fingers: [THREE.Object3D, THREE.Object3D];
  /** The box it picks up off the belt, and the stack on its pallet. */
  box: THREE.Object3D;
  stacked: THREE.Object3D;
  /** +1 when the arm's local x runs with the belt, -1 when against it. */
  beltDir: number;
  speed: number;
  phase: number;
}

// Arm dimensions (must match makeRobotArm)
const ARM_SHOULDER_Y = 1.05; // shoulder pivot above the base
const ARM_UPPER = 1.7;
const ARM_FORE = 1.5;
const GRIP_DROP = 0.48; // fingertips below the wrist
const BOX = 0.42;
/** Where the arm grabs: distance out over the belt (from the base), and the drop spot by its pallet. */
const GRAB_OUT = 2.1;
const DROP_TURN = 0.9;
const DROP_OUT = 1.8;

/** Two-joint inverse kinematics in the arm's vertical plane: shoulder and elbow angles that put the wrist at (dx, dy) from the shoulder. */
function armIK(dx: number, dy: number): [number, number] {
  const r = Math.min(ARM_UPPER + ARM_FORE - 0.01, Math.max(0.3, Math.hypot(dx, dy)));
  const cosA = (ARM_UPPER * ARM_UPPER + r * r - ARM_FORE * ARM_FORE) / (2 * ARM_UPPER * r);
  const a = Math.atan2(dy, dx) + Math.acos(Math.max(-1, Math.min(1, cosA))); // elbow up
  const ex = ARM_UPPER * Math.cos(a);
  const ey = ARM_UPPER * Math.sin(a);
  const b = Math.atan2(dy - ey, dx - ex);
  const shoulder = a - Math.PI / 2; // the upper arm points up (+y) at rest
  return [shoulder, b - shoulder];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * One pick-and-place cycle: a box rides the belt up to the arm; the arm lowers its gripper over
 * it, closes, lifts, swings round, sets the box on its pallet and returns for the next one.
 */
function animateArm(root: THREE.Group, arm: RobotArmParts, time: number): void {
  const cycle = 7 / arm.speed;
  const p = (((time + arm.phase) % cycle) + cycle) % cycle / cycle;
  // Wrist targets in the turret's plane (x out from the base, y up from the shoulder)
  const boxTop = BOX / 2 - ARM_SHOULDER_Y + 0.05;
  const hover: [number, number] = [GRAB_OUT, boxTop + BOX / 2 + GRIP_DROP + 0.6];
  const grab: [number, number] = [GRAB_OUT, boxTop + BOX / 2 + GRIP_DROP - 0.02];
  const lift: [number, number] = [1.6, 0.9];
  const drop: [number, number] = [DROP_OUT, -ARM_SHOULDER_Y + 0.25 + BOX + GRIP_DROP];
  const toward = -Math.PI / 2; // turret facing the belt
  let target: [number, number];
  let turn: number;
  let grip = 0.13; // finger gap (open)
  let carried = false;
  let onBelt = true;
  if (p < 0.35) {
    target = hover;
    turn = toward;
  } else if (p < 0.45) {
    const k = ease((p - 0.35) / 0.08);
    target = [lerp(hover[0], grab[0], k), lerp(hover[1], grab[1], k)];
    turn = toward;
    if (p > 0.42) grip = lerp(0.13, 0.05, (p - 0.42) / 0.03);
  } else if (p < 0.65) {
    const k = ease((p - 0.45) / 0.2);
    target = k < 0.4 ? [lerp(grab[0], lift[0], k / 0.4), lerp(grab[1], lift[1], k / 0.4)] : lift;
    turn = lerp(toward, DROP_TURN, (k - 0.25) / 0.75);
    grip = 0.05;
    carried = true;
    onBelt = false;
  } else if (p < 0.75) {
    const k = ease((p - 0.65) / 0.1);
    target = [lerp(lift[0], drop[0], k), lerp(lift[1], drop[1], k)];
    turn = DROP_TURN;
    grip = p > 0.72 ? 0.13 : 0.05;
    carried = p <= 0.72;
    onBelt = false;
  } else {
    const k = ease((p - 0.75) / 0.25);
    target = [lerp(drop[0], hover[0], k), lerp(drop[1], hover[1], k)];
    turn = lerp(DROP_TURN, toward, k);
    onBelt = false;
  }
  const [sh, el] = armIK(target[0], target[1]);
  arm.turret.rotation.y = turn;
  arm.shoulder.rotation.z = sh;
  arm.elbow.rotation.z = el;
  arm.wrist.rotation.z = -(sh + el); // keep the gripper pointing straight down
  arm.fingers[0].position.z = grip;
  arm.fingers[1].position.z = -grip;
  // The box: riding the belt, in the gripper, or set down on the pallet
  const box = arm.box;
  if (onBelt) {
    // Rides in from upstream, arriving under the gripper as it comes down
    const along = lerp(-3.2, 0, Math.min(1, p / 0.4)) * arm.beltDir;
    box.position.set(along, BOX / 2 + 0.03, GRAB_OUT);
    box.rotation.set(0, 0, 0);
    box.visible = true;
  } else if (carried) {
    root.updateMatrixWorld(true);
    const tip = arm.wrist.localToWorld(new THREE.Vector3(0, -GRIP_DROP + 0.12, 0));
    root.worldToLocal(tip);
    box.position.copy(tip).add(new THREE.Vector3(0, -BOX / 2 + 0.06, 0));
    box.rotation.set(0, turn + Math.PI / 2, 0);
    box.visible = true;
  } else {
    // Dropped on the pallet; it joins the stack, then this box is recycled for the next pick
    box.visible = p < 0.92;
    box.position.set(Math.cos(DROP_TURN) * DROP_OUT, 0.2 + BOX / 2, -Math.sin(DROP_TURN) * DROP_OUT);
  }
}

/**
 * An industrial robotic arm: a bolted base, a turret that turns, an upper and lower arm on
 * hinged joints, and a two-finger gripper. Built from nested groups so each joint can move.
 */
function makeRobotArm(map: MapDef, seed: number): THREE.Group {
  const [body, dark] = map.decorColors;
  const paint = std(body, 0.45, 0.25);
  const black = std(dark, 0.6, 0.5);
  const chrome = std("#c9ced6", 0.2, 1);
  const root = new THREE.Group();
  const base = new THREE.Mesh(cylGeo(0.55, 0.65, 0.35, 16), black);
  base.position.y = 0.17;
  root.add(base);
  const turret = new THREE.Group();
  turret.position.y = 0.35;
  root.add(turret);
  const tbody = new THREE.Mesh(cylGeo(0.38, 0.45, 0.6, 14), paint);
  tbody.position.y = 0.3;
  turret.add(tbody);
  // Shoulder joint and upper arm
  const shoulder = new THREE.Group();
  shoulder.position.y = 0.7;
  turret.add(shoulder);
  const sj = new THREE.Mesh(cylGeo(0.24, 0.24, 0.55, 14), black);
  sj.rotation.x = Math.PI / 2;
  shoulder.add(sj);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.7, 0.36), paint);
  upper.position.y = 0.85;
  shoulder.add(upper);
  // Elbow and forearm (reaching out over the belt)
  const elbow = new THREE.Group();
  elbow.position.y = 1.7;
  shoulder.add(elbow);
  const ej = new THREE.Mesh(cylGeo(0.2, 0.2, 0.45, 14), black);
  ej.rotation.x = Math.PI / 2;
  elbow.add(ej);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.24, 0.28), paint);
  fore.position.x = 0.75;
  elbow.add(fore);
  // Hydraulic piston along the upper arm
  const piston = new THREE.Mesh(cylGeo(0.05, 0.05, 1.3, 8), chrome);
  piston.position.set(0, 0.85, 0.24);
  shoulder.add(piston);
  // Wrist and gripper
  const wrist = new THREE.Group();
  wrist.position.x = 1.5;
  elbow.add(wrist);
  const wj = new THREE.Mesh(sphereGeo(0.15), black);
  wrist.add(wj);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.3), chrome);
  hand.position.y = -0.2;
  wrist.add(hand);
  const fingers: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.05), black);
    f.position.set(0, -0.45, side * 0.08);
    wrist.add(f);
    fingers.push(f);
  }
  // Pallet beside the arm with a stack of finished boxes, and the box it's about to pick up
  const cardboard = std("#b5834f", 0.85, 0);
  const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 1.0), std("#8a6038", 0.9, 0));
  const px = Math.cos(DROP_TURN) * DROP_OUT;
  const pz = -Math.sin(DROP_TURN) * DROP_OUT;
  pallet.position.set(px, 0.1, pz);
  root.add(pallet);
  const stacked = new THREE.Group();
  for (const [ox, oz, oy] of [
    [-0.25, -0.22, 0],
    [0.25, -0.22, 0],
    [-0.25, 0.24, 0],
    [0.02, 0, 1],
  ]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(BOX, BOX, BOX), cardboard);
    b.position.set(px + ox, 0.2 + BOX / 2 + oy * BOX, pz + oz);
    stacked.add(b);
  }
  root.add(stacked);
  const box = new THREE.Group();
  const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(BOX, BOX, BOX), cardboard);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(BOX + 0.005, 0.06, BOX * 0.3), std("#d9c9a0", 0.7, 0));
  tape.position.y = BOX / 2 - 0.02;
  box.add(boxMesh, tape);
  root.add(box);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const parts: RobotArmParts = {
    turret,
    shoulder,
    elbow,
    wrist,
    fingers: fingers as [THREE.Object3D, THREE.Object3D],
    box,
    stacked,
    beltDir: 1,
    speed: 0.8 + hash(seed * 3.7) * 0.6,
    phase: hash(seed * 1.9) * 10,
  };
  root.userData.arm = parts;
  return root;
}

/** Conveyor belt: dark rubber with raised cross-ribs (scrolled forward every frame). */
function beltMaterial(): THREE.MeshStandardMaterial {
  const tex = noiseCanvas(512, (g, n) => {
    g.fillStyle = "#2a2b2f";
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(255,255,255,${0.02 + hash(i) * 0.03})`;
      g.fillRect(hash(i + 1) * n, hash(i + 2) * n, 2, 2);
    }
    // Cross ribs (u runs along the road, 8 m per tile): one every 0.4 m
    const ribs = 20;
    for (let k = 0; k < ribs; k++) {
      const x = (k / ribs) * n;
      g.fillStyle = "#4a4c52";
      g.fillRect(x, 0, n / ribs * 0.35, n);
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.fillRect(x + (n / ribs) * 0.35, 0, 2, n);
    }
    // Worn lighter strips where the tyres run
    for (const v of [0.32, 0.68]) {
      g.fillStyle = "rgba(255,255,255,0.04)";
      g.fillRect(0, (v - 0.07) * n, n, 0.14 * n);
    }
  });
  return new THREE.MeshStandardMaterial({ color: 0x6a6a6a, map: tex, bumpMap: tex, bumpScale: 2, roughness: 0.85, metalness: 0.05 });
}

interface WalkerParts {
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  head: THREE.Object3D;
}
interface Walker {
  root: THREE.Group;
  parts: WalkerParts;
  x: number;
  z: number;
  speed: number;
  phase: number;
}

/**
 * An original walking factory robot: boxy steel torso with a hazard stripe, a head with a
 * glowing visor and an antenna, swinging arms with clamp hands, and stepping legs.
 */
function makeWalker(seed: number): THREE.Group {
  const paints = ["#c9ced6", "#f2b705", "#3f7fd8", "#e2483d"];
  const body = std(paints[seed % paints.length], 0.4, 0.6);
  const dark = std("#2b2d33", 0.55, 0.5);
  const root = new THREE.Group();
  const scale = 0.9 + hash(seed * 4.4) * 0.35;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.46), body);
  torso.position.y = 1.4;
  root.add(torso);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.48), std("#1c1c1f", 0.5, 0.3));
  stripe.position.y = 1.18;
  root.add(stripe);
  const chestLight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.16), new THREE.MeshStandardMaterial({ color: 0x66ff99, emissive: 0x33ff77, emissiveIntensity: 2 }));
  chestLight.position.set(0.32, 1.5, 0);
  root.add(chestLight);
  // Head with a glowing visor (facing +x, the walking direction) and an antenna
  const head = new THREE.Group();
  head.position.y = 1.98;
  root.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.36), body);
  head.add(skull);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x4fd1ff, emissiveIntensity: 2.4 }));
  visor.position.set(0.21, 0.03, 0);
  head.add(visor);
  const antenna = new THREE.Mesh(cylGeo(0.015, 0.015, 0.3, 6), dark);
  antenna.position.y = 0.3;
  head.add(antenna);
  const tip = new THREE.Mesh(sphereGeo(0.04), new THREE.MeshStandardMaterial({ color: 0xff5544, emissive: 0xff3322, emissiveIntensity: 2 }));
  tip.position.y = 0.46;
  head.add(tip);
  // Arms (pivot at the shoulder) and legs (pivot at the hip)
  const limb = (x: number, y: number, z: number, len: number, w: number, mat: THREE.Material, hand: boolean) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    seg.position.y = -len / 2;
    pivot.add(seg);
    if (hand) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(w * 1.3, 0.12, w * 1.5), dark);
      clamp.position.y = -len - 0.04;
      pivot.add(clamp);
    } else {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), dark);
      foot.position.set(0.05, -len - 0.02, 0);
      pivot.add(foot);
    }
    root.add(pivot);
    return pivot;
  };
  const armL = limb(0, 1.72, 0.37, 0.62, 0.13, body, true);
  const armR = limb(0, 1.72, -0.37, 0.62, 0.13, body, true);
  const legL = limb(0, 1.02, 0.15, 0.95, 0.17, dark, false);
  const legR = limb(0, 1.02, -0.15, 0.95, 0.17, dark, false);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  root.userData.walker = { legL, legR, armL, armR, head } satisfies WalkerParts;
  return root;
}

let glueLabelTex: THREE.CanvasTexture | null = null;
/** The bottle's wrap-around label: electric blue with a lightning bolt and "GLUE", twice around. */
function glueLabelTexture(): THREE.CanvasTexture {
  if (glueLabelTex) return glueLabelTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, "#5fb0ff");
  bg.addColorStop(0.5, "#2f7ae5");
  bg.addColorStop(1, "#1546b8");
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  for (const cx of [128, 384]) {
    g.fillStyle = "#ffd60a";
    g.strokeStyle = "#1b2233";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - 70, 30);
    g.lineTo(cx - 108, 98);
    g.lineTo(cx - 84, 98);
    g.lineTo(cx - 100, 166);
    g.lineTo(cx - 52, 86);
    g.lineTo(cx - 76, 86);
    g.closePath();
    g.fill();
    g.stroke();
    g.font = "900 68px Fredoka, 'Arial Rounded MT Bold', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeText("GLUE", cx + 26, 100);
    g.fillStyle = "#ffffff";
    g.fillText("GLUE", cx + 26, 100);
  }
  glueLabelTex = new THREE.CanvasTexture(c);
  glueLabelTex.colorSpace = THREE.SRGBColorSpace;
  return glueLabelTex;
}

/**
 * 3D super-glue bottle: a curvy glossy white bottle (lathe), a clear band showing amber glue, a
 * wrap-around blue label, a ribbed red cap with a long nozzle, a glossy drip and sparkles.
 */
function makeGlueBottle3D(): THREE.Group {
  const g = new THREE.Group();
  // Bottle profile (radius, height)
  const prof = [
    [0.0, -0.5], [0.24, -0.5], [0.28, -0.46], [0.29, -0.3], [0.29, 0.02], [0.27, 0.18], [0.2, 0.3], [0.13, 0.34], [0.0, 0.34],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bottle = new THREE.Mesh(
    new THREE.LatheGeometry(prof, 32),
    new THREE.MeshPhysicalMaterial({ color: 0xf6f8fc, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  g.add(bottle);
  // Clear window band with amber glue showing through
  const windowBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.296, 0.296, 0.14, 32, 1, true),
    new THREE.MeshPhysicalMaterial({ color: 0xbfd8f0, transparent: true, opacity: 0.45, roughness: 0.05, clearcoat: 1 }),
  );
  windowBand.position.y = 0.1;
  const glue = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.1, 24), std("#ffb21f", 0.2, 0, { emissive: new THREE.Color("#7a3a00"), emissiveIntensity: 0.4 }));
  glue.position.y = 0.08;
  g.add(glue, windowBand);
  // Wrap-around label
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.297, 0.297, 0.42, 40, 1, true), new THREE.MeshStandardMaterial({ map: glueLabelTexture(), roughness: 0.35 }));
  label.position.y = -0.2;
  g.add(label);
  // Red cap: ribbed collar and a long pointed nozzle
  const red = new THREE.MeshPhysicalMaterial({ color: 0xe2241b, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.16, 20), red);
  collar.position.y = 0.42;
  g.add(collar);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.03), std("#a8160f", 0.4));
    rib.position.set(Math.cos(a) * 0.158, 0.42, Math.sin(a) * 0.158);
    rib.rotation.y = -a;
    g.add(rib);
  }
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.36, 18), red);
  nozzle.position.y = 0.68;
  g.add(nozzle);
  // A glossy drip running down from the nozzle
  const dripMat = new THREE.MeshPhysicalMaterial({ color: 0xffb21f, roughness: 0.05, clearcoat: 1, emissive: new THREE.Color("#5a2a00"), emissiveIntensity: 0.4 });
  const run = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.34, 8), dripMat);
  run.position.set(0.07, 0.62, 0.02);
  run.rotation.z = 0.22;
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), dripMat);
  bead.scale.y = 1.25;
  bead.position.set(0.11, 0.44, 0.03);
  g.add(run, bead);
  // Sparkles orbiting the bottle (four little stars)
  const sparkMat = new THREE.SpriteMaterial({ map: sparkleTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let k = 0; k < 4; k++) {
    const sp = new THREE.Sprite(sparkMat);
    sp.name = "sparkle";
    sp.userData.k = k;
    sp.scale.setScalar(0.22);
    g.add(sp);
  }
  g.userData.glue = true;
  return g;
}

let sparkleTex: THREE.CanvasTexture | null = null;
function sparkleTexture(): THREE.CanvasTexture {
  if (sparkleTex) return sparkleTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.translate(32, 32);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.2, "rgba(200,230,255,0.6)");
  glow.addColorStop(1, "rgba(200,230,255,0)");
  g.fillStyle = glow;
  g.fillRect(-32, -32, 64, 64);
  g.fillStyle = "#ffffff";
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const r = k % 2 ? 6 : 30;
    const a = (k / 8) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  sparkleTex = new THREE.CanvasTexture(c);
  return sparkleTex;
}

/** A flat, tapered surface (wing, tailplane) seen from above: root and tip chords, `span` out each side. */
function wingGeometry(rootX0: number, rootX1: number, tipX0: number, tipX1: number, span: number, thick: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(rootX0, 0);
  sh.lineTo(tipX0, span);
  sh.lineTo(tipX1, span);
  sh.lineTo(rootX1, 0);
  sh.lineTo(tipX1, -span);
  sh.lineTo(tipX0, -span);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: 0.03, bevelSegments: 2 });
  // Shape is drawn in x/y; lay it flat (y → z) and center its thickness
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}

/**
 * The plane's flying parts: tapered main wings (with rocket pods underneath), a tailplane, a
 * swept tail fin, and a two-blade propeller with a spinner. Returns the propeller (it spins).
 */
function addPlaneParts(body: THREE.Group, def: VehicleDef, mat: (color: string, opts?: THREE.MeshStandardMaterialParameters) => THREE.Material, ghost: boolean): THREE.Object3D[] {
  const red = mat("#e2483d");
  const yellow = mat("#f2c230");
  const dark = mat("#3a3d46", { metalness: 0.6, roughness: 0.35 });
  const add = (m: THREE.Mesh) => {
    m.castShadow = !ghost;
    body.add(m);
    return m;
  };
  // Main wings, low on the fuselage, with yellow tips
  const wing = add(new THREE.Mesh(wingGeometry(-0.5, 1.0, -0.15, 0.55, 2.7, 0.07), red));
  wing.position.y = 0.38;
  for (const z of [2.65, -2.65]) {
    const tip = add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.12), yellow));
    tip.position.set(0.2, 0.42, z);
  }
  // Rocket pods slung under the wings
  if (def.rocket?.zs) {
    for (const z of def.rocket.zs) {
      const pod = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.95, 16), dark));
      pod.rotation.z = Math.PI / 2;
      pod.position.set(0.05, def.rocket.y, z);
      const nose = add(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 16), red));
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(0.67, def.rocket.y, z);
      const pylon = add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.06), dark));
      pylon.position.set(0.1, def.rocket.y + 0.12, z);
    }
  }
  // Tailplane and a swept tail fin
  const tail = add(new THREE.Mesh(wingGeometry(-2.4, -1.75, -2.35, -2.0, 1.15, 0.05), red));
  tail.position.y = 0.52;
  const finShape = new THREE.Shape();
  finShape.moveTo(-2.3, 0.55);
  finShape.lineTo(-1.8, 0.55);
  finShape.lineTo(-2.08, 1.3);
  finShape.lineTo(-2.32, 1.3);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  finGeo.translate(0, 0, -0.03);
  add(new THREE.Mesh(finGeo, red));
  // Propeller: spinner cone + two blades, spinning about the nose (x axis)
  const prop = new THREE.Group();
  prop.position.set(1.9, 0.32, 0);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 16), dark);
  spinner.rotation.z = -Math.PI / 2;
  spinner.position.x = 0.1;
  prop.add(spinner);
  for (const s of [1, -1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.11), dark);
    blade.position.y = s * 0.36;
    blade.rotation.x = s * 0.25;
    prop.add(blade);
  }
  body.add(prop);
  return [prop];
}

// ---------- sky obstacles ----------

const BALLOON_COLORS_3D: [string, string][] = [
  ["#e94b3c", "#ffd23f"],
  ["#3c8de9", "#ffffff"],
  ["#8e4be9", "#ffb13f"],
  ["#2fbf71", "#fff3b0"],
  ["#ff6fae", "#7fe0ff"],
];

/** Hot-air balloon (origin at the envelope's center): striped envelope, ropes, wicker basket, burner. */
function makeBalloon(o: SkyObstacle): THREE.Group {
  const g = new THREE.Group();
  const r = o.size;
  const [c1, c2] = BALLOON_COLORS_3D[Math.floor(o.seed * BALLOON_COLORS_3D.length) % BALLOON_COLORS_3D.length];
  // Gore stripes around the envelope
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 4;
  const cx = c.getContext("2d")!;
  for (let i = 0; i < 12; i++) {
    cx.fillStyle = i % 2 ? c2 : c1;
    cx.fillRect((i * 256) / 12, 0, 256 / 12 + 1, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Teardrop profile, bottom (mouth) to top
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = i / 20;
    const y = -r * 0.95 + a * r * 1.98;
    const w = a < 0.12 ? 0.3 + (a / 0.12) * 0.25 : Math.sin(Math.min(1, (a - 0.05) / 0.95) * Math.PI * 0.92 + 0.12) * (0.55 + 0.5 * Math.min(1, a / 0.5));
    prof.push(new THREE.Vector2(Math.max(0.02, w * r), y));
  }
  prof.push(new THREE.Vector2(0.001, r * 1.03));
  const env = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), std("#ffffff", 0.55, 0, { map: tex }));
  env.castShadow = true;
  g.add(env);
  // Basket and ropes
  const by = -r - 1.3;
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), std("#a8743f", 0.9));
  basket.position.y = by;
  basket.castShadow = true;
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), std("#6e4721", 0.9));
  rim.position.y = by + 0.38;
  g.add(basket, rim);
  const ropeMat = std("#4a3a28", 0.9);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const top = new THREE.Vector3(sx * r * 0.22, -r * 0.92, sz * r * 0.22);
    const bot = new THREE.Vector3(sx * 0.42, by + 0.4, sz * 0.42);
    const len = top.distanceTo(bot);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 4), ropeMat);
    rope.position.copy(top).add(bot).multiplyScalar(0.5);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
    g.add(rope);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 8), new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.9 }));
  flame.name = "flame";
  flame.position.y = by + 0.75;
  g.add(flame);
  return g;
}

/** Floating rock island (origin at the middle of its top): grassy disc, rocky cone below, trees, crystals. */
function makeIsland(o: SkyObstacle): THREE.Group {
  const g = new THREE.Group();
  const w = o.size;
  const rock = new THREE.Mesh(new THREE.ConeGeometry(w, w * 1.25, 9, 3), std("#7a5a3e", 0.95));
  // Rough up the rock
  const pos = rock.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const h = hash(i * 7.3 + o.seed * 100);
    if (pos.getY(i) < w * 0.6) {
      pos.setX(i, pos.getX(i) * (0.85 + h * 0.3));
      pos.setZ(i, pos.getZ(i) * (0.85 + h * 0.3));
    }
  }
  rock.geometry.computeVertexNormals();
  rock.rotation.x = Math.PI;
  rock.position.y = -w * 0.62;
  rock.scale.z = 0.8;
  rock.castShadow = true;
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(w, w * 0.97, 0.3, 18), std("#5cbf45", 0.85));
  grass.position.y = -0.15;
  grass.scale.z = 0.8;
  grass.receiveShadow = true;
  g.add(rock, grass);
  const trunkMat = std("#6b4423", 0.9);
  const leafMat = std("#4caf3f", 0.8);
  for (let k = 0; k < 2 + Math.floor(o.seed * 3); k++) {
    const a = hash(k * 3.1 + o.seed * 50) * Math.PI * 2;
    const d = w * 0.25 + hash(k * 5.7 + o.seed) * w * 0.4;
    const tx = Math.cos(a) * d;
    const tz = Math.sin(a) * d * 0.8;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 6), trunkMat);
    trunk.position.set(tx, 0.5, tz);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), leafMat);
    crown.position.set(tx, 1.3, tz);
    crown.castShadow = trunk.castShadow = true;
    g.add(trunk, crown);
  }
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), std("#a99cf0", 0.2, 0.1, { emissive: new THREE.Color("#6b5cd6"), emissiveIntensity: 0.5 }));
  crystal.position.set(0, -w * 1.15, 0);
  crystal.scale.y = 1.8;
  g.add(crystal);
  return g;
}

/** Storm cloud (origin at its center): dark puffs, a warning glow on the road, a lightning bolt. */
function makeStorm(o: SkyObstacle, groundY: number): THREE.Group {
  const g = new THREE.Group();
  const cloudMat = std("#4b5068", 0.95, 0, { emissive: new THREE.Color("#bfd8ff"), emissiveIntensity: 0 });
  const w = o.size;
  const puffs: [number, number, number, number][] = [
    [-0.75, -0.1, 0.2, 0.42], [-0.35, 0.2, -0.3, 0.55], [0.15, 0.3, 0.3, 0.6], [0.6, 0, -0.2, 0.45], [0.9, -0.2, 0.3, 0.32], [-1, -0.25, -0.2, 0.3], [0, -0.3, 0, 0.5], [0.2, 0, -0.7, 0.45], [-0.3, 0, 0.7, 0.45],
  ];
  for (const [px, py, pz, pr] of puffs) {
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(pr * w * 0.55, 1), cloudMat);
    p.position.set(px * w, py * w * 0.5, pz * w);
    g.add(p);
  }
  g.userData.cloudMat = cloudMat;
  const zone = new THREE.Mesh(new THREE.CircleGeometry(STORM.reach, 32), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0, depthWrite: false }));
  zone.rotation.x = -Math.PI / 2;
  zone.scale.y = 1.2;
  zone.position.y = groundY - o.y + 0.08;
  zone.name = "zone";
  g.add(zone);
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
  bolt.name = "bolt";
  bolt.visible = false;
  g.add(bolt);
  return g;
}

function updateStorm(g: THREE.Object3D, o: SkyObstacle, time: number, groundY: number): void {
  const phase = stormPhase(o, time);
  const flick = phase === "warn" && Math.sin(time * 40) > 0.3 ? 1 : 0;
  (g.userData.cloudMat as THREE.MeshStandardMaterial).emissiveIntensity = phase === "strike" ? 0.9 : flick * 0.35;
  const zone = g.getObjectByName("zone") as THREE.Mesh;
  (zone.material as THREE.MeshBasicMaterial).opacity = phase === "strike" ? 0.6 : phase === "warn" ? 0.15 + flick * 0.2 : 0;
  const bolt = g.getObjectByName("bolt") as THREE.Mesh;
  bolt.visible = phase === "strike";
  const frame = Math.floor(time * 20);
  if (bolt.visible && bolt.userData.frame !== frame) {
    bolt.userData.frame = frame;
    const pts: THREE.Vector3[] = [];
    const y0 = -1.2;
    const y1 = groundY - o.y;
    for (let i = 0; i <= 9; i++) {
      const j = i === 0 || i === 9 ? 0 : hash(i * 12.9898 + frame * 78.233) - 0.5;
      pts.push(new THREE.Vector3(j * 1.6, y0 + ((y1 - y0) * i) / 9, j * 0.8));
    }
    bolt.geometry.dispose();
    bolt.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0), 40, 0.09, 5, false);
  }
}
