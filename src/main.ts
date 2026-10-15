import { World, Vec2, Contact, WeldJoint, Fixture } from "planck";
import { Car } from "./car";
import { Terrain } from "./terrain";
import { Renderer, Scene, GhostPose } from "./render";
import { Input } from "./input";
import { Sound } from "./audio";
import { VehicleDef, vehicleById } from "./vehicles";
import { Garage } from "./garage";
import { DIFFICULTIES, Difficulty, difficultyById } from "./difficulty";
import { MapDef, mapById } from "./maps";
import { Music, TRACKS, MAP_TRACK } from "./music";
import { CAMERA_MODES, CameraMode, cameraModeById, angleDelta } from "./camera";
import { CockpitState } from "./cockpit";
import { PartDef, Paint, VehicleMods, NO_MODS, MAX_LEVEL, EGG_CARE, applyMods } from "./upgrades";

type State = "menu" | "garage" | "playing" | "crashed" | "over" | "paused" | "finished";
type Mode = "endless" | "trial";
type EndReason = "smash" | "fuel" | "finish";

const STEP = 1 / 60;
const GLUE_SECONDS = 15;
const SHIELD_SECONDS = 2.5;
const START_X = 0;
const GHOST_HZ = 20;

interface Course {
  id: string;
  name: string;
  length: number;
}

const COURSES: Course[] = [
  { id: "sprint", name: "Sprint", length: 400 },
  { id: "classic", name: "Classic", length: 800 },
  { id: "endurance", name: "Endurance", length: 1500 },
];

interface GhostData {
  vehicle: string;
  paint: string;
  /** Flattened [x, y, angle] samples at GHOST_HZ. */
  frames: number[];
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const store = {
  get(key: string): number {
    try {
      return Number(localStorage.getItem(`eggrally.${key}`)) || 0;
    } catch {
      return 0;
    }
  },
  set(key: string, v: number | string): void {
    try {
      localStorage.setItem(`eggrally.${key}`, String(v));
    } catch {
      /* storage unavailable */
    }
  },
  getStr(key: string): string {
    try {
      return localStorage.getItem(`eggrally.${key}`) ?? "";
    } catch {
      return "";
    }
  },
  getJSON<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`eggrally.${key}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  setJSON(key: string, v: unknown): void {
    try {
      localStorage.setItem(`eggrally.${key}`, JSON.stringify(v));
    } catch {
      /* storage unavailable or full */
    }
  },
};

/** Stable 32-bit hash so each time-trial course always generates the same terrain. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

class Game {
  private renderer = new Renderer($<HTMLCanvasElement>("game"));
  private input = new Input($("pedal-gas"), $("pedal-brake"));
  private sound = new Sound();
  private music = new Music();
  /** "auto" (match terrain), "off", or a track id. */
  private musicChoice = store.getStr("music") || "auto";
  private cameraMode: CameraMode = cameraModeById(store.getStr("camera"));
  private toastTimer: number | null = null;
  private cockpit = new CockpitState();

  private world!: World;
  private terrain!: Terrain;
  private car!: Car;
  private scene!: Scene;

  private state: State = "menu";
  private mode: Mode = store.getStr("mode") === "trial" ? "trial" : "endless";
  private course: Course = COURSES.find((c) => c.id === store.getStr("course")) ?? COURSES[0];
  private acc = 0;
  private last = performance.now();
  private timeScale = 1;
  private crackPending = false;
  private glueJoint: WeldJoint | null = null;
  private crashTimer = 0;
  private endReason: EndReason = "smash";
  private distance = 0;
  private coinsRun = 0;
  private newBestShown = false;

  // Fuel and egg protection for the current run
  private fuel = 0;
  private fuelMax = 1;
  private noFuelTimer = 0;
  private armorLeft = 0;

  // Time trial
  private trialTime = 0;
  private recording: number[] = [];
  private ghost: GhostData | null = null;

  // Persistent progress
  private ownedMaps = new Set(["countryside", ...store.getStr("ownedMaps").split(",").filter(Boolean)]);
  private map: MapDef = mapById(this.ownedMaps.has(store.getStr("map")) ? store.getStr("map") : "countryside");
  private difficulty: Difficulty = difficultyById(store.getStr("difficulty") || "normal");
  private best = this.loadBest();
  private totalCoins = store.get("coins");
  private hudCache = "";
  private owned = new Set(["pickup", ...store.getStr("owned").split(",").filter(Boolean)]);
  private selected = this.owned.has(store.getStr("selected")) ? store.getStr("selected") : "pickup";
  private mods: Record<string, VehicleMods> = store.getJSON("mods", {});
  private ownedPaints = new Set(["stock", ...store.getStr("ownedPaints").split(",").filter(Boolean)]);
  private lives = store.get("lives");
  private armorLevel = store.get("armor");

  private garage = new Garage($("garage-list"), $("garage-coins"), $("garage-tabs"), {
    buyMap: (map) => this.buyMap(map),
    selectMap: (map) => this.selectMap(map),
    buy: (def) => this.buyVehicle(def),
    select: (def) => this.selectVehicle(def),
    buyPart: (part) => this.buyPart(part),
    choosePaint: (paint) => this.choosePaint(paint),
    buyLife: () => this.buyLife(),
    buyArmor: () => this.buyArmor(),
  });

  constructor() {
    this.sound.onReady = (ctx) => this.music.attach(ctx);
    this.setupMusicPickers();
    this.setupCameraPickers();
    this.newRun();
    this.bindUI();
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- setup ----------

  private modsFor(id: string): VehicleMods {
    return { ...NO_MODS, ...this.mods[id] };
  }

  private currentDef(): VehicleDef {
    return applyMods(vehicleById(this.selected), this.modsFor(this.selected));
  }

  private trialKey(): string {
    return `trial.${this.course.id}.${this.map.id}.${this.difficulty.id}`;
  }

  private newRun(): void {
    const trial = this.mode === "trial";
    const seed = trial ? hashString(this.trialKey()) : Math.floor(Math.random() * 1e9);
    const def = this.currentDef();
    this.world = new World({ gravity: new Vec2(0, -this.map.gravity) });
    this.terrain = new Terrain(this.world, seed, this.difficulty, this.map, trial ? this.course.length : null);
    this.terrain.update(START_X, START_X);
    this.car = new Car(this.world, def, START_X, this.terrain.height(START_X), this.difficulty.eggFriction, this.map.gravity);

    this.world.on("begin-contact", (c) => this.onContact(c, 1));
    this.world.on("end-contact", (c) => this.onContact(c, -1));
    // Bridges only exist for drivers who chose the bridge route at that fork.
    this.world.on("pre-solve", (c) => {
      if (!this.isGround(c.getFixtureA()) && this.bridgeOf(c.getFixtureA()) !== null) c.setEnabled(false);
      if (!this.isGround(c.getFixtureB()) && this.bridgeOf(c.getFixtureB()) !== null) c.setEnabled(false);
    });

    this.ghost = trial ? store.getJSON<GhostData | null>(`ghost.${this.trialKey()}`, null) : null;
    const old = this.scene?.camera;
    this.scene = {
      terrain: this.terrain,
      car: this.car,
      camera: {
        x: START_X + 2,
        y: 1.5,
        scale: old?.scale ?? this.renderer.baseScale() * this.cameraMode.zoom,
        angle: 0,
        focusX: this.cameraMode.focusX,
        focusY: this.cameraMode.focusY,
      },
      time: 0,
      eggBroken: false,
      splat: null,
      particles: [],
      dust: [],
      glue: 0,
      shield: 0,
      armor: this.armorLevel,
      cockpit: null,
      ghost: this.ghost ? { def: applyMods(vehicleById(this.ghost.vehicle), { ...NO_MODS, paint: this.ghost.paint }), pose: null } : null,
      smash: null,
      shake: 0,
      gauges: { kmh: 0, rpm: 0, gear: 0, fuel: 1 },
      dash: { glue: 0, fuel: 1, rpm: 0, gear: 0, ghostX: null },
    };
    this.cockpit.reset();
    this.glueJoint = null;
    this.crackPending = false;
    this.crashTimer = 0;
    this.distance = 0;
    this.coinsRun = 0;
    this.acc = 0;
    this.timeScale = 1;
    this.fuel = this.fuelMax = def.fuel;
    this.noFuelTimer = 0;
    this.armorLeft = this.armorLevel;
    this.trialTime = 0;
    this.recording = [];
    this.newBestShown = false;
  }

  /** Bridge fork index for a fixture, or null if it isn't a bridge. */
  private bridgeOf(f: Fixture): number | null {
    const u = f.getUserData() as string | undefined;
    return u?.startsWith("bridge:") ? Number(u.slice(7)) : null;
  }

  /** Terrain, or a bridge on the route the player chose. */
  private isGround(f: Fixture): boolean {
    const u = f.getUserData() as string | undefined;
    if (u === "ground") return true;
    const b = this.bridgeOf(f);
    return b !== null && this.terrain.forks[b]?.choice === "bridge";
  }

  private onContact(c: Contact, delta: 1 | -1): void {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const a = fa.getUserData() as string | undefined;
    const b = fb.getUserData() as string | undefined;
    const with_ = (name: string) => (a === name && this.isGround(fb)) || (b === name && this.isGround(fa));

    if (with_("wheel0")) this.car.wheelContacts[0] = Math.max(0, this.car.wheelContacts[0] + delta);
    if (with_("wheel1")) this.car.wheelContacts[1] = Math.max(0, this.car.wheelContacts[1] + delta);
    // A glued or shielded egg is protected until the effect wears off.
    if (delta === 1 && with_("egg") && !this.scene.eggBroken && !this.eggProtected()) this.crackPending = true;
  }

  private eggProtected(): boolean {
    return this.scene.glue > 0 || this.scene.shield > 0;
  }

  private bindUI(): void {
    const start = () => {
      this.sound.unlock();
      this.startRun();
    };
    $("btn-play").addEventListener("click", start);
    $("btn-retry").addEventListener("click", start);
    $("btn-menu").addEventListener("click", () => {
      this.newRun();
      this.showMenu();
    });
    $("btn-resume").addEventListener("click", () => this.togglePause());
    $("btn-garage").addEventListener("click", () => this.showGarage());
    $("btn-over-garage").addEventListener("click", () => this.showGarage());
    $("btn-garage-back").addEventListener("click", () => {
      this.newRun();
      this.showMenu();
    });

    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "r" && this.state !== "menu" && this.state !== "garage") start();
      else if ((k === "enter" || k === " ") && (this.state === "menu" || this.state === "over")) start();
      else if (k === "escape" && this.state === "garage") $("btn-garage-back").click();
      else if ((k === "p" || k === "escape") && (this.state === "playing" || this.state === "paused")) this.togglePause();
      else if (k === "c" && this.state !== "garage") this.cycleCamera();
      else if (k === "m") {
        this.sound.setMuted(!this.sound.muted);
        this.updateMusic();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.togglePause();
    });
  }

  // ---------- menus ----------

  private setPanels(menu: boolean, over: boolean, paused: boolean, hud: boolean, garage = false): void {
    $("menu").classList.toggle("hidden", !menu);
    $("garage").classList.toggle("hidden", !garage);
    $("over").classList.toggle("hidden", !over);
    $("paused").classList.toggle("hidden", !paused);
    $("hud").classList.toggle("hidden", !hud);
    $("pedals").classList.toggle("hidden", !hud || over);
  }

  private showMenu(): void {
    this.state = "menu";
    this.renderModePicker();
    this.renderDifficulty();
    $("menu-coins").textContent = String(this.totalCoins);
    $("menu-vehicle").textContent = vehicleById(this.selected).name;
    $("menu-map").textContent = this.map.name;
    $("menu-lives").textContent = `❤️ ${this.lives}${this.armorLevel ? `  🛡️ ${this.armorLevel}` : ""}`;
    this.updateMusic();
    this.setPanels(true, false, false, false);
  }

  private renderModePicker(): void {
    const seg = (wrapId: string, items: [string, string, boolean][], onPick: (id: string) => void) => {
      const wrap = $(wrapId);
      wrap.replaceChildren();
      for (const [id, label, active] of items) {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.className = active ? "active" : "";
        btn.setAttribute("aria-pressed", String(active));
        btn.addEventListener("click", () => onPick(id));
        wrap.appendChild(btn);
      }
    };
    seg(
      "mode",
      [
        ["endless", "Endless", this.mode === "endless"],
        ["trial", "Time Trial", this.mode === "trial"],
      ],
      (id) => this.setMode(id as Mode, this.course),
    );
    $("course-row").classList.toggle("hidden", this.mode !== "trial");
    seg(
      "course",
      COURSES.map((c) => [c.id, `${c.name} ${c.length}m`, c.id === this.course.id]),
      (id) => this.setMode("trial", COURSES.find((c) => c.id === id)!),
    );
    if (this.mode === "trial") {
      const bt = store.get(`${this.trialKey()}`);
      $("menu-best-label").textContent = `Best time (${this.course.name}, ${this.map.name}, ${this.difficulty.name})`;
      $("menu-best").textContent = bt ? formatTime(bt) : "—";
    } else {
      $("menu-best-label").textContent = `Best (${this.map.name}, ${this.difficulty.name})`;
      $("menu-best").textContent = `${this.best} m`;
    }
  }

  private setMode(mode: Mode, course: Course): void {
    this.mode = mode;
    this.course = course;
    store.set("mode", mode);
    store.set("course", course.id);
    this.newRun();
    this.showMenu();
  }

  /** Best distance per terrain + difficulty. Older saves (no terrain in the key) count as Countryside. */
  private bestKey(): string {
    return `best.${this.map.id}.${this.difficulty.id}`;
  }

  private loadBest(): number {
    const id = this.difficulty.id;
    const legacy = this.map.id === "countryside" ? store.get(`best.${id}`) || (id === "normal" ? store.get("best") : 0) : 0;
    return store.get(this.bestKey()) || legacy;
  }

  private renderDifficulty(): void {
    const wrap = $("difficulty");
    wrap.replaceChildren();
    for (const d of DIFFICULTIES) {
      const btn = document.createElement("button");
      btn.textContent = d.name;
      btn.className = `diff-${d.id}` + (d.id === this.difficulty.id ? " active" : "");
      btn.setAttribute("aria-pressed", String(d.id === this.difficulty.id));
      btn.addEventListener("click", () => this.setDifficulty(d));
      wrap.appendChild(btn);
    }
    $("difficulty-blurb").textContent = this.difficulty.blurb;
  }

  private setDifficulty(d: Difficulty): void {
    if (d.id === this.difficulty.id) return;
    this.difficulty = d;
    store.set("difficulty", d.id);
    this.best = this.loadBest();
    this.newRun();
    this.showMenu();
  }

  // ---------- music ----------

  private setupMusicPickers(): void {
    for (const id of ["menu-music", "pause-music"]) {
      const select = $<HTMLSelectElement>(id);
      const options: [string, string][] = [["auto", "Match terrain"], ...TRACKS.map((t): [string, string] => [t.id, t.name]), ["off", "Off"]];
      for (const [value, label] of options) select.add(new Option(label, value));
      select.value = this.musicChoice;
      select.addEventListener("change", () => {
        this.musicChoice = select.value;
        store.set("music", this.musicChoice);
        this.sound.unlock();
        this.updateMusic();
      });
    }
    // Browsers only allow audio after a user gesture; the first click or key press starts the music.
    window.addEventListener("pointerdown", () => this.sound.unlock(), { once: true });
    window.addEventListener("keydown", () => this.sound.unlock(), { once: true });
  }

  private updateMusic(): void {
    for (const id of ["menu-music", "pause-music"]) $<HTMLSelectElement>(id).value = this.musicChoice;
    const id = this.musicChoice === "auto" ? MAP_TRACK[this.map.id] ?? "sunny" : this.musicChoice;
    this.music.play(TRACKS.find((t) => t.id === id) ?? null);
    this.music.setVolume(this.sound.muted ? 0 : this.state === "paused" ? 0.35 : 1);
  }

  // ---------- garage & shop ----------

  private showGarage(): void {
    this.state = "garage";
    this.setPanels(false, false, false, false, true);
    this.renderGarage();
  }

  private renderGarage(): void {
    this.garage.render({
      coins: this.totalCoins,
      owned: this.owned,
      selected: this.selected,
      ownedMaps: this.ownedMaps,
      selectedMap: this.map.id,
      mods: this.modsFor(this.selected),
      ownedPaints: this.ownedPaints,
      lives: this.lives,
      armor: this.armorLevel,
    });
  }

  /** Spends coins if affordable; plays the purchase sound. */
  private spend(price: number): boolean {
    if (this.totalCoins < price) return false;
    this.totalCoins -= price;
    store.set("coins", this.totalCoins);
    this.sound.unlock();
    this.sound.coin();
    return true;
  }

  private buyVehicle(def: VehicleDef): void {
    if (this.owned.has(def.id) || !this.spend(def.price)) return;
    this.owned.add(def.id);
    store.set("owned", [...this.owned].join(","));
    this.selectVehicle(def);
  }

  private selectVehicle(def: VehicleDef): void {
    if (!this.owned.has(def.id)) return;
    this.selected = def.id;
    store.set("selected", def.id);
    this.renderGarage();
  }

  private buyMap(map: MapDef): void {
    if (this.ownedMaps.has(map.id) || !this.spend(map.price)) return;
    this.ownedMaps.add(map.id);
    store.set("ownedMaps", [...this.ownedMaps].join(","));
    this.selectMap(map);
  }

  private selectMap(map: MapDef): void {
    if (!this.ownedMaps.has(map.id)) return;
    this.map = map;
    store.set("map", map.id);
    this.best = this.loadBest();
    this.renderGarage();
    this.updateMusic();
  }

  private saveMods(m: VehicleMods): void {
    this.mods[this.selected] = m;
    store.setJSON("mods", this.mods);
    this.renderGarage();
  }

  private buyPart(part: PartDef): void {
    const m = this.modsFor(this.selected);
    const level = m[part.id];
    if (level >= MAX_LEVEL || !this.spend(part.costs[level])) return;
    this.saveMods({ ...m, [part.id]: level + 1 });
  }

  private choosePaint(paint: Paint): void {
    if (!this.ownedPaints.has(paint.id)) {
      if (!this.spend(paint.price)) return;
      this.ownedPaints.add(paint.id);
      store.set("ownedPaints", [...this.ownedPaints].join(","));
    }
    this.saveMods({ ...this.modsFor(this.selected), paint: paint.id });
  }

  private buyLife(): void {
    if (!this.spend(EGG_CARE.lifePrice)) return;
    this.lives++;
    store.set("lives", this.lives);
    this.renderGarage();
  }

  private buyArmor(): void {
    if (this.armorLevel >= EGG_CARE.armorCosts.length || !this.spend(EGG_CARE.armorCosts[this.armorLevel])) return;
    this.armorLevel++;
    store.set("armor", this.armorLevel);
    this.renderGarage();
  }

  // ---------- run lifecycle ----------

  private startRun(): void {
    if (this.state !== "menu") this.newRun();
    this.state = "playing";
    this.hudCache = "";
    $("hud-time-row").classList.toggle("hidden", this.mode !== "trial");
    this.setPanels(false, false, false, true);
    this.updateMusic();
  }

  private togglePause(): void {
    if (this.state === "playing") {
      this.state = "paused";
      this.setPanels(false, false, true, true);
    } else if (this.state === "paused") {
      this.state = "playing";
      this.last = performance.now();
      this.setPanels(false, false, false, true);
    }
    this.updateMusic();
  }

  /** Welds the egg to the car where it currently sits. Picking up more glue resets the timer. */
  private activateGlue(): void {
    if (this.scene.eggBroken) return;
    this.scene.glue = GLUE_SECONDS;
    this.sound.powerUp();
    this.burst(this.car.egg.getPosition(), ["#9fd0ff", "#ffffff", "#3d8bff"], 14);
    if (this.glueJoint) return;
    this.glueJoint = this.world.createJoint(new WeldJoint({}, this.car.chassis, this.car.egg, this.car.egg.getPosition())) as WeldJoint;
  }

  private releaseGlue(): void {
    if (this.glueJoint) this.world.destroyJoint(this.glueJoint);
    this.glueJoint = null;
    this.scene.glue = 0;
    if (!this.eggProtected() && this.eggTouchingGround()) this.crackPending = true;
  }

  private eggTouchingGround(): boolean {
    for (let ce = this.car.egg.getContactList(); ce; ce = ce.next ?? null) {
      const c = ce.contact;
      if (!c.isTouching() || !c.isEnabled()) continue;
      if (this.isGround(c.getFixtureA()) || this.isGround(c.getFixtureB())) return true;
    }
    return false;
  }

  /** The egg is about to break: armor, then extra lives, save it; otherwise it smashes. */
  private eggHit(): void {
    this.crackPending = false;
    if (this.armorLeft > 0) {
      this.armorLeft--;
      this.scene.armor = this.armorLeft;
      this.rescueEgg("🛡️ Shell armor saved your egg!");
    } else if (this.lives > 0) {
      this.lives--;
      store.set("lives", this.lives);
      this.rescueEgg(`❤️ Extra life used! (${this.lives} left)`);
    } else {
      this.crackEgg();
    }
  }

  /** Puts the egg back in the vehicle (flipping the vehicle upright if needed) with a brief shield. */
  private rescueEgg(message: string): void {
    const a = this.car.chassis.getAngle();
    const upsideDown = Math.cos(a) < 0.5;
    const eggFar = Vec2.distance(this.car.egg.getPosition(), this.car.chassis.getPosition()) > 3;
    if (upsideDown || eggFar) this.car.placeUpright(this.terrain.height(this.car.chassis.getPosition().x));
    this.car.resetEgg();
    this.scene.shield = SHIELD_SECONDS;
    this.sound.shield();
    this.burst(this.car.egg.getPosition(), ["#bfe6ff", "#ffffff"], 16);
    this.toast(message);
  }

  private burst(p: Vec2, colors: string[], n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.scene.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp + 2,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 20,
        size: 0.05 + Math.random() * 0.06,
        color: colors[i % colors.length],
      });
    }
  }

  private crackEgg(): void {
    const egg = this.car.egg;
    const p = egg.getPosition().clone();
    const v = egg.getLinearVelocity().clone();
    this.world.destroyBody(egg); // also removes any glue joint
    this.glueJoint = null;
    this.scene.glue = 0;

    const gx = p.x;
    const gy = this.terrain.height(gx);
    const slope = (this.terrain.height(gx + 0.3) - this.terrain.height(gx - 0.3)) / 0.6;
    this.scene.eggBroken = true;
    this.scene.splat = { x: gx, y: gy, angle: Math.atan(slope), t: 0 };
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * (0.15 + 0.7 * Math.random());
      const sp = 2 + Math.random() * 4;
      this.scene.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * sp + v.x * 0.3,
        vy: Math.sin(a) * sp,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 20,
        size: 0.08 + Math.random() * 0.08,
        color: i % 2 ? "#fbf3e2" : "#efe2c4",
      });
    }
    // Full-screen smash in slow motion
    this.scene.smash = 0;
    this.scene.shake = 16;
    this.timeScale = 0.25;
    this.sound.smash();
    this.endRun("smash");
  }

  private endRun(reason: EndReason): void {
    this.endReason = reason;
    this.car.cutEngine();
    this.state = reason === "finish" ? "finished" : "crashed";
    this.crashTimer = 0;
    if (this.mode === "endless" && this.distance > this.best) {
      this.best = this.distance;
      store.set(this.bestKey(), this.best);
    }
    this.totalCoins += this.coinsRun;
    store.set("coins", this.totalCoins);
  }

  private finishTrial(): void {
    const key = this.trialKey();
    const prev = store.get(key);
    const record = !prev || this.trialTime < prev;
    if (record) {
      store.set(key, this.trialTime);
      const ghost: GhostData = { vehicle: this.selected, paint: this.modsFor(this.selected).paint, frames: this.recording.map((n) => Math.round(n * 100) / 100) };
      store.setJSON(`ghost.${key}`, ghost);
    }
    this.sound.finish();
    this.endRun("finish");
    this.showResults(record, prev);
  }

  private showResults(record = false, prevTime = 0): void {
    this.state = "over";
    const trial = this.mode === "trial";
    const title =
      this.endReason === "finish" ? (record ? "🏁 New Record!" : "🏁 Finished!") : this.endReason === "fuel" ? "Out of Fuel!" : "Egg Smashed!";
    $("over-title").textContent = title;
    if (trial && this.endReason === "finish") {
      $("over-dist").textContent = formatTime(this.trialTime);
      $("over-unit").textContent = "";
      $("over-best-label").textContent = "Best time";
      $("over-best").textContent = formatTime(record ? this.trialTime : prevTime);
      $("over-new").classList.toggle("hidden", !record);
      $("over-new").textContent = prevTime && record ? `−${(prevTime - this.trialTime).toFixed(2)}s` : "New best!";
    } else if (trial) {
      $("over-dist").textContent = String(this.distance);
      $("over-unit").textContent = `/ ${this.course.length} m`;
      $("over-best-label").textContent = "Best time";
      const bt = store.get(this.trialKey());
      $("over-best").textContent = bt ? formatTime(bt) : "—";
      $("over-new").classList.add("hidden");
    } else {
      $("over-dist").textContent = String(this.distance);
      $("over-unit").textContent = "m";
      $("over-best-label").textContent = `Best (${this.map.name}, ${this.difficulty.name})`;
      $("over-best").textContent = `${this.best} m`;
      $("over-new").textContent = "New best!";
      $("over-new").classList.toggle("hidden", !(this.distance > 0 && this.distance >= this.best));
    }
    $("over-coins").textContent = String(this.coinsRun);
    this.setPanels(false, true, false, true);
  }

  // ---------- simulation ----------

  private step(): void {
    const playing = this.state === "playing";
    const hasFuel = this.fuel > 0;
    if (playing) this.car.drive(this.input.gas, this.input.brake, hasFuel);
    else this.car.cutEngine();

    this.world.step(STEP, 8, 3);
    this.scene.time += STEP;

    if (this.crackPending && playing && !this.scene.eggBroken) {
      if (this.eggProtected()) this.crackPending = false;
      else this.eggHit();
    } else this.crackPending = false;

    const cp = this.car.chassis.getPosition();
    const cam = this.scene.camera;
    this.terrain.update(cp.x, cam.x - this.renderer.width / 2 / cam.scale);

    // Route choice at canyon forks: holding gas takes the bridge.
    for (const fork of this.terrain.forks) {
      if (fork.choice === null && cp.x > fork.x - 3) {
        fork.choice = playing && this.input.gas ? "bridge" : "valley";
        if (playing) this.toast(fork.choice === "bridge" ? "🌉 Bridge route — jump the gap!" : "🛣️ Safe valley road");
      }
    }

    if (playing) {
      this.distance = Math.max(this.distance, Math.floor(cp.x - START_X));
      if (this.mode === "endless" && !this.newBestShown && this.best > 0 && this.distance > this.best) {
        this.newBestShown = true;
        this.sound.newBest();
        this.toast("🏆 NEW BEST!");
      }

      // Fuel
      this.fuel = Math.max(0, this.fuel - STEP * (0.05 + 0.95 * this.car.load));
      if (hasFuel && this.fuel === 0) this.toast("⛽ Out of fuel!");
      if (this.fuel === 0) {
        const still = Math.hypot(this.car.chassis.getLinearVelocity().x, this.car.chassis.getLinearVelocity().y) < 0.5;
        this.noFuelTimer = still ? this.noFuelTimer + STEP : 0;
        if (this.noFuelTimer > 2) {
          this.endRun("fuel");
          return;
        }
      }

      // Time trial
      if (this.mode === "trial") {
        this.trialTime += STEP;
        if (Math.round(this.scene.time * 60) % (60 / GHOST_HZ) === 0) this.recording.push(cp.x, cp.y, this.car.chassis.getAngle());
        if (this.terrain.finishX !== null && cp.x >= this.terrain.finishX && !this.scene.eggBroken) {
          this.finishTrial();
          return;
        }
      }

      // Egg fell into the void somehow (e.g. squeezed through geometry)
      if (!this.scene.eggBroken) {
        const ep = this.car.egg.getPosition();
        if (ep.y < this.terrain.height(ep.x) - 6) this.eggHit();
      }

      for (const pu of this.terrain.powerUps) {
        if (pu.taken || Math.abs(pu.x - cp.x) > 4 || !this.car.touches(new Vec2(pu.x, pu.y), 0.35)) continue;
        pu.taken = true;
        pu.takenAt = this.scene.time;
        if (pu.kind === "glue") this.activateGlue();
        else if (pu.kind === "fuel") {
          this.fuel = this.fuelMax;
          this.sound.fuel();
          this.toast("⛽ Refueled!");
        } else {
          this.lives++;
          store.set("lives", this.lives);
          this.sound.life();
          this.toast(`❤️ Extra life! (${this.lives})`);
        }
      }
      if (this.scene.glue > 0) {
        this.scene.glue = Math.max(0, this.scene.glue - STEP);
        if (this.scene.glue === 0) this.releaseGlue();
      }
      if (this.scene.shield > 0) {
        this.scene.shield = Math.max(0, this.scene.shield - STEP);
        if (this.scene.shield === 0 && !this.eggProtected() && this.eggTouchingGround()) this.crackPending = true;
      }
      for (const c of this.terrain.coins) {
        if (c.taken || Math.abs(c.x - cp.x) > 3) continue;
        const big = c.value > 1;
        // Big coins must actually be touched; small ones have a generous pickup box.
        const hit = big ? this.car.touches(new Vec2(c.x, c.y), 0.45) : Math.abs(c.x - cp.x) < 1.7 && Math.abs(c.y - cp.y) < 1.4;
        if (!hit) continue;
        c.taken = true;
        c.takenAt = this.scene.time;
        this.coinsRun += c.value * this.difficulty.coinValue;
        if (big) {
          this.sound.bigCoin();
          this.toast(`💰 +${c.value * this.difficulty.coinValue}`);
        } else this.sound.coin();
      }
      this.spawnDust();
    }

    if (this.state === "crashed") {
      if (this.scene.splat) this.scene.splat.t += STEP;
      this.crashTimer += STEP;
      if (this.crashTimer > (this.endReason === "smash" ? 0.9 : 0.4)) this.showResults();
    } else if (this.state === "over" && this.scene.splat) this.scene.splat.t += STEP;

    this.updateParticles();
  }

  private spawnDust(): void {
    const car = this.car;
    const speed = Math.abs(car.wheelSpeed);
    if (car.wheelContacts[0] === 0 || speed < 2 || (car.load < 0.6 && !car.braking)) return;
    if (this.scene.dust.length > 70 || Math.random() > 0.6) return;
    const w = car.wheels[0].getPosition();
    const r = car.def.wheels[0].r;
    this.scene.dust.push({
      x: w.x - r * 0.5,
      y: this.terrain.height(w.x) + 0.1,
      vx: -1 - Math.random() * 1.5,
      vy: 0.6 + Math.random() * 1.2,
      life: 0.8,
      max: 0.8,
      size: 0.15 + Math.random() * 0.15,
    });
  }

  private updateParticles(): void {
    const g = this.map.gravity;
    const ps = this.scene.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.vy -= 1.2 * g * STEP;
      p.x += p.vx * STEP;
      p.y += p.vy * STEP;
      p.rot += p.vr * STEP;
      const ground = this.terrain.height(p.x);
      if (p.y < ground + 0.04) {
        p.y = ground + 0.04;
        p.vx *= 0.5;
        p.vy = Math.abs(p.vy) * 0.25;
        p.vr *= 0.5;
      }
    }
    if (ps.length > 120) ps.splice(0, ps.length - 120);
    const ds = this.scene.dust;
    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i];
      d.life -= STEP;
      if (d.life <= 0) {
        ds.splice(i, 1);
        continue;
      }
      d.x += d.vx * STEP;
      d.y += d.vy * STEP;
      d.vy *= 0.97;
    }
  }

  private ghostPose(): GhostPose | null {
    if (!this.ghost || this.state === "menu") return null;
    const f = this.ghost.frames;
    const n = f.length / 3;
    if (n === 0) return null;
    const t = Math.min(n - 1, this.trialTime * GHOST_HZ);
    const i = Math.floor(t);
    const j = Math.min(n - 1, i + 1);
    const k = t - i;
    return {
      x: f[i * 3] + (f[j * 3] - f[i * 3]) * k,
      y: f[i * 3 + 1] + (f[j * 3 + 1] - f[i * 3 + 1]) * k,
      a: f[i * 3 + 2] + angleDelta(f[i * 3 + 2], f[j * 3 + 2]) * k,
    };
  }

  /** Seconds the ghost took to reach x (for the split-time readout). */
  private ghostTimeAt(x: number): number | null {
    if (!this.ghost) return null;
    const f = this.ghost.frames;
    for (let i = 0; i < f.length; i += 3) if (f[i] >= x) return i / 3 / GHOST_HZ;
    return null;
  }

  private updateCamera(dt: number): void {
    const cam = this.scene.camera;
    const mode = this.cameraMode;
    const body = this.car.chassis;
    const p = body.getPosition();
    const v = body.getLinearVelocity();
    const lead = Math.max(-3, Math.min(mode.maxLead, v.x * mode.lead));

    // Rotating views turn with the car (the cockpit stays attached even after a crash).
    const targetAngle = mode.rotate && (mode.cockpit || this.state === "playing") ? body.getAngle() : 0;
    cam.angle += angleDelta(cam.angle, targetAngle) * (1 - Math.exp(-dt * mode.angleStiffness));
    if (!mode.rotate && Math.abs(cam.angle) < 0.001) cam.angle = 0;
    const kf = 1 - Math.exp(-dt * 6);
    cam.focusX += (mode.focusX - cam.focusX) * kf;
    cam.focusY += (mode.focusY - cam.focusY) * kf;
    if (Math.abs(cam.focusX - mode.focusX) < 1e-4) cam.focusX = mode.focusX;
    if (Math.abs(cam.focusY - mode.focusY) < 1e-4) cam.focusY = mode.focusY;

    let tx: number;
    let ty: number;
    if (mode.cockpit) {
      // The camera is the driver's eye, bobbing on the seat with the suspension.
      this.cockpit.update(dt, this.car, this.map.gravity, this.state === "playing" && this.car.load > 0);
      const d = this.car.def.driver;
      const eye = body.getWorldPoint({ x: d.x + 0.05, y: d.y + 0.05 + this.cockpit.bob });
      tx = eye.x;
      ty = eye.y;
      this.scene.cockpit = this.cockpit;
    } else {
      this.scene.cockpit = null;
      const heading = mode.rotate ? cam.angle : 0;
      const ahead = 1 + lead;
      tx = p.x + Math.cos(heading) * ahead - Math.sin(heading) * mode.lift;
      ty = p.y + Math.sin(heading) * ahead + Math.cos(heading) * mode.lift;
    }
    // Inside the cab the camera is bolted to the truck; other views ease after it.
    const k = mode.cockpit ? 1 : 1 - Math.exp(-dt * mode.stiffness);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    if (mode.cockpit) cam.angle = body.getAngle();

    const speed = Math.hypot(v.x, v.y);
    const speedFactor = mode.speedZoom ? 1 - Math.min(speed / 50, 0.22) : 1;
    const targetScale = this.renderer.baseScale() * mode.zoom * speedFactor;
    cam.scale += (targetScale - cam.scale) * (1 - Math.exp(-dt * 2.5));
  }

  // ---------- camera views ----------

  private setupCameraPickers(): void {
    for (const id of ["menu-camera", "pause-camera"]) {
      const select = $<HTMLSelectElement>(id);
      for (const m of CAMERA_MODES) select.add(new Option(m.name, m.id));
      select.value = this.cameraMode.id;
      select.addEventListener("change", () => this.setCameraMode(cameraModeById(select.value), false));
    }
    $("btn-camera").addEventListener("click", () => this.cycleCamera());
  }

  private cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(this.cameraMode);
    this.setCameraMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length], true);
  }

  private setCameraMode(mode: CameraMode, announce: boolean): void {
    this.cameraMode = mode;
    store.set("camera", mode.id);
    this.cockpit.reset();
    for (const id of ["menu-camera", "pause-camera"]) $<HTMLSelectElement>(id).value = mode.id;
    if (announce) this.toast(`🎥 ${mode.name}`);
  }

  private toast(text: string): void {
    const el = $("toast");
    el.textContent = text;
    el.classList.remove("hidden", "fade");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.add("fade"), 1300);
  }

  // ---------- HUD ----------

  private updateHUD(): void {
    const glue = Math.ceil(this.scene.glue);
    const trial = this.mode === "trial";
    const cx = this.car.chassis.getPosition().x;
    const t = trial ? Math.floor(this.trialTime * 100) : 0;
    const key = `${this.distance}|${this.best}|${this.coinsRun}|${glue}|${t}|${this.lives}|${this.armorLeft}|${this.state}`;
    if (key === this.hudCache) return;
    this.hudCache = key;

    $("hud-glue").classList.toggle("hidden", glue === 0);
    $("hud-glue").classList.toggle("ending", glue > 0 && glue <= 3);
    $("hud-glue-time").textContent = `${glue}s`;
    $("hud-lives").textContent = `❤️ ${this.lives}${this.armorLeft ? `  🛡️ ${this.armorLeft}` : ""}`;
    $("hud-coins").textContent = String(this.totalCoins + (this.state === "playing" ? this.coinsRun : 0));

    const fill = $("hud-prog");
    const mark = $("hud-mark");
    if (trial) {
      const len = this.course.length;
      $("hud-main").textContent = formatTime(this.trialTime);
      $("hud-unit").textContent = "";
      const bt = store.get(this.trialKey());
      const gt = this.ghostTimeAt(cx);
      const delta = gt !== null ? this.trialTime - gt : null;
      const deltaEl = $("hud-delta");
      deltaEl.textContent = delta === null ? "" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}s`;
      deltaEl.className = delta === null ? "" : delta > 0 ? "behind" : "ahead";
      $("hud-sub").textContent = bt ? `BEST ${formatTime(bt)}` : "NO TIME YET";
      $("hud-dist-small").textContent = `${Math.min(len, this.distance)} / ${len} m`;
      fill.style.width = `${Math.min(100, (Math.max(0, cx) / len) * 100)}%`;
      const gp = this.scene.ghost?.pose;
      mark.classList.toggle("hidden", !gp);
      if (gp) mark.style.left = `${Math.min(100, (Math.max(0, gp.x) / len) * 100)}%`;
    } else {
      $("hud-main").textContent = String(this.distance);
      $("hud-unit").textContent = "m";
      $("hud-delta").textContent = "";
      const beat = this.best > 0 && this.distance > this.best;
      $("hud-sub").textContent = this.best > 0 ? (beat ? "🏆 NEW BEST" : `BEST ${this.best} m`) : "SET YOUR FIRST RECORD";
      $("hud-sub").classList.toggle("beat", beat);
      const scaleTo = Math.max(this.best, this.distance, 100);
      fill.style.width = `${(this.distance / scaleTo) * 100}%`;
      fill.classList.toggle("beat", beat);
      mark.classList.toggle("hidden", this.best === 0);
      mark.style.left = `${(this.best / scaleTo) * 100}%`;
    }
  }

  // ---------- frame ----------

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.state !== "paused") {
      // Slow motion after a smash eases back to normal speed.
      this.timeScale = Math.min(1, this.timeScale + dt * 0.6);
      this.acc += dt * this.timeScale;
      while (this.acc >= STEP) {
        this.step();
        this.acc -= STEP;
      }
      this.updateCamera(dt);
      if (this.scene.smash !== null) this.scene.smash += dt;
      this.scene.shake = Math.max(0, this.scene.shake - dt * 30);
    }

    const v = this.car.chassis.getLinearVelocity();
    const running = (this.state === "playing" || this.state === "paused") && this.fuel > 0;
    if (this.state !== "paused") {
      this.sound.engine(dt, {
        running,
        speed: this.car.wheelSpeed,
        load: this.state === "playing" ? this.car.load : 0,
        onGround: this.car.onGround,
        braking: this.state === "playing" && this.car.braking,
        speedScale: Math.sqrt(this.map.gravity / 10),
      });
    }
    const kmh = Math.hypot(v.x, v.y) * 3.6;
    const fuelFrac = this.fuel / this.fuelMax;
    this.scene.gauges = { kmh, rpm: this.sound.rpm, gear: this.sound.gear, fuel: fuelFrac };
    const pose = this.ghostPose();
    if (this.scene.ghost) this.scene.ghost.pose = pose;
    this.scene.dash = { glue: this.scene.glue, fuel: fuelFrac, rpm: this.sound.rpm, gear: this.sound.gear, ghostX: pose?.x ?? null };

    if (this.state !== "menu" && this.state !== "garage") this.updateHUD();
    this.renderer.draw(this.scene);
    requestAnimationFrame((t) => this.frame(t));
  }
}

new Game();
