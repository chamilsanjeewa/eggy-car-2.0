/**
 * The showroom behind the menu and garage: your car on a slowly turning platform in a dark
 * studio, with a glossy floor, spotlights and light strips. Rendered with its own WebGL canvas,
 * and only while one of those screens is open.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { VehicleDef } from "./vehicles";
import { buildEgg, buildVehicle, buildWheelPair, disposeTree } from "./render3d";

export type ShowroomLayout = "menu" | "garage";

const TURN_SPEED = 0.22; // radians per second

export class Showroom {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private turntable = new THREE.Group();
  private car: THREE.Group | null = null;
  private carKey = "";
  private carSize = 4;
  private layout: ShowroomLayout = "menu";
  private running = false;
  private last = 0;
  private angle = -0.65;
  private width = 1;
  private height = 1;
  private readonly still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x0d0e11);
    this.scene.fog = new THREE.Fog(0x0d0e11, 18, 45);
    this.buildStudio();
    this.scene.add(this.turntable);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Shows the given car (rebuilt only when it changes) and starts rendering. */
  show(def: VehicleDef, layout: ShowroomLayout): void {
    this.layout = layout;
    const key = JSON.stringify([def.id, def.parts.map((p) => p.fill), def.wheelColor, def.hubColor]);
    if (key !== this.carKey) {
      this.carKey = key;
      this.setCar(def);
    }
    this.canvas.classList.remove("hidden");
    this.resize();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  hide(): void {
    this.running = false;
    this.canvas.classList.add("hidden");
  }

  get visible(): boolean {
    return this.running;
  }

  // ---------- studio ----------

  private buildStudio(): void {
    const s = this.scene;
    // Glossy floor: a mirror under a semi-transparent dark concrete layer gives soft reflections.
    const mirror = new Reflector(new THREE.CircleGeometry(40, 64), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x55575c,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.002;
    s.add(mirror);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.86 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // Turntable: brushed metal disc with a glowing edge ring
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.5, 0.14, 72),
      new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.32, metalness: 0.85 }),
    );
    disc.position.y = 0.07;
    disc.receiveShadow = true;
    s.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.47, 0.025, 8, 120),
      new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff9a1f, emissiveIntensity: 2.2 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    s.add(ring);
    this.turntable.position.y = 0.14;

    // Curved back wall (cyclorama) with horizontal light strips
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 14, 96, 1, true, Math.PI * 0.62, Math.PI * 0.76),
      new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9, side: THREE.BackSide }),
    );
    wall.position.y = 7;
    s.add(wall);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
    for (const [y, a0, a1] of [
      [1.2, 0.68, 1.32],
      [4.6, 0.75, 1.25],
    ] as const) {
      const strip = new THREE.Mesh(new THREE.CylinderGeometry(21.8, 21.8, 0.08, 96, 1, true, Math.PI * a0, Math.PI * (a1 - a0)), stripMat);
      strip.material.side = THREE.BackSide;
      strip.position.y = y;
      s.add(strip);
    }
    // Overhead softbox
    const softbox = new THREE.Mesh(new THREE.PlaneGeometry(9, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    softbox.rotation.x = Math.PI / 2;
    softbox.position.set(0, 9, 0);
    s.add(softbox);

    // Lights: soft fill, a key spot with shadows, and two colored rim lights
    s.add(new THREE.HemisphereLight(0xcfd8ff, 0x101012, 0.35));
    const key = new THREE.SpotLight(0xffffff, 130, 40, 0.6, 0.6, 1.6);
    key.position.set(5, 11, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    s.add(key, key.target);
    const warm = new THREE.SpotLight(0xffa860, 140, 30, 0.5, 0.8, 1.6);
    warm.position.set(-8, 4, -6);
    const cool = new THREE.SpotLight(0x7fb4ff, 160, 30, 0.5, 0.8, 1.6);
    cool.position.set(8, 3.5, -7);
    s.add(warm, warm.target, cool, cool.target);
  }

  // ---------- car ----------

  private setCar(def: VehicleDef): void {
    if (this.car) disposeTree(this.car, this.turntable);
    const car = new THREE.Group();
    const built = buildVehicle(def, false);
    car.add(built.body);
    for (const w of def.wheels) {
      const pair = buildWheelPair(def, w.r, false);
      pair.position.set(w.x, w.y, 0);
      car.add(pair);
    }
    const egg = buildEgg();
    egg.position.set(def.egg.x, def.egg.y, 0);
    car.add(egg);
    car.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    // Center the car on the platform with its tires on the surface.
    const xs = def.parts.flatMap((p) => p.pts.map((q) => q.x));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const bottom = Math.min(...def.wheels.map((w) => w.y - w.r));
    car.position.set(-(minX + maxX) / 2, -bottom, 0);
    this.carSize = Math.max(3, maxX - minX);
    const holder = new THREE.Group();
    holder.add(car);
    this.turntable.add(holder);
    this.car = holder;
  }

  // ---------- frame ----------

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens: widen the lens so the whole car fits across.
    this.camera.fov = w / h < 0.8 ? 50 : 32;
    // Frame the car where the screen leaves room for it: right of the menu panel on wide screens,
    // in the top band on phones and in the garage.
    const wide = w >= 900;
    let shiftX = 0;
    let shiftY = 0;
    if (this.layout === "menu" && wide) shiftX = -Math.min(260, (w - 440) * 0.28);
    else if (this.layout === "menu") shiftY = h * 0.3;
    else shiftY = h * (w >= 900 ? 0.27 : 0.29);
    this.camera.setViewOffset(w, h, shiftX, shiftY, w, h);
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.still) this.angle += dt * TURN_SPEED;
    this.turntable.rotation.y = this.angle;
    // Camera distance fits the car; narrow screens need to back off further.
    const narrow = this.width / this.height < 0.8;
    const fit = this.carSize * (this.layout === "garage" ? (narrow ? 3.8 : 3.7) : narrow ? 2.4 : 2.3);
    const dist = fit + 5;
    const t = now / 1000;
    const sway = this.still ? 0 : Math.sin(t * 0.15) * 0.4;
    this.camera.position.set(Math.sin(0.35 + sway * 0.1) * dist, 1.9 + this.carSize * 0.18, Math.cos(0.35 + sway * 0.1) * dist);
    this.camera.lookAt(0, 0.9, 0);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((tt) => this.frame(tt));
  }
}
