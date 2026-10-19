import { World, Vec2, Contact, WeldJoint, Fixture, Body } from "planck";
import { Car, MAX_RIVALS } from "./car";
import { Rival, RivalSkill, RIVAL_SKILLS, makeRivals, rivalPart, rivalSkillById } from "./rivals";
import { Terrain, SkyObstacle, STORM, stormPhase, stormCycle } from "./terrain";
import { Renderer, Scene, GhostPose } from "./render";
import { Input } from "./input";
import { Sound } from "./audio";
import { VEHICLES, VehicleDef, vehicleById } from "./vehicles";
import { MAPS } from "./maps";
import { Garage } from "./garage";
import { DIFFICULTIES, Difficulty, difficultyById } from "./difficulty";
import { MapDef, mapById, airDensity, RAINY, wetMap, gravityAt, skyroadSlope } from "./maps";
import { Music, TRACKS, MAP_TRACK } from "./music";
import { CAMERA_MODES, CameraMode, cameraModeById, angleDelta } from "./camera";
import { CockpitState, EggStatus } from "./cockpit";
import { DEFAULT_INTERIOR, InteriorConfig, InteriorGroup, InteriorOption, resolveInterior } from "./interior";
import { loadBoard, recordRun, totalsRanked, medal, SHOW } from "./leaderboard";
import { TOTAL_LEVELS, LEVELS_PER_PAGE, Level, LevelResult, levelById, parTimes, starsFor } from "./levels";
import { ACHIEVEMENTS, Stats, NO_STATS, achievementFor, progressText, progressFraction } from "./achievements";
import { Renderer3D } from "./render3d";
import { Showroom } from "./showroom";
import { registerCustom, saveCar, saveMap, deleteCar as removeCustomCar, deleteMap as removeCustomMap, CarSpec, MapSpec } from "./custom";
import { DAY_LENGTH, clockText, clockIcon } from "./daynight";
import { PartDef, Paint, VehicleMods, NO_MODS, MAX_LEVEL, EGG_CARE, applyMods } from "./upgrades";

type State = "menu" | "garage" | "playing" | "crashed" | "over" | "paused" | "finished";
type Mode = "endless" | "trial" | "levels" | "race";
type EndReason = "smash" | "fuel" | "finish" | "stopped";

const STEP = 1 / 60;
/** Direction convention for planck's tangent speed on the ground chain (checked in testing). */
const CONVEYOR_SIGN = 1;
const GLUE_SECONDS = 15;
const SHIELD_SECONDS = 2.5;
const START_X = 0;
const GHOST_HZ = 20;

interface SoundSettings {
  master: number;
  music: number;
  engine: number;
  effects: number;
  muted: boolean;
  /** Full 3D (binaural) sound for headphones; off = a natural stereo mix for speakers. */
  headphones: boolean;
  /** Basic audio only (no engine synth, 3D sound or limiter) for devices where those misbehave. */
  simple?: boolean;
}

const DEFAULT_SOUND: SoundSettings = { master: 1, music: 0.8, engine: 0.8, effects: 1, muted: false, headphones: false };
const VOLUME_KEYS = ["master", "music", "engine", "effects"] as const;

/** Optional game rules, all on by default. */
interface GameplaySettings {
  fuel: boolean;
  glue: boolean;
  lives: boolean;
  weather: boolean;
  daynight: boolean;
}

const DEFAULT_GAMEPLAY: GameplaySettings = { fuel: true, glue: true, lives: true, weather: true, daynight: true };
const GAMEPLAY_KEYS = ["fuel", "glue", "lives", "weather", "daynight"] as const;
/** Chance a run on a rainy terrain gets a shower (Endless and Race only: trials stay fair). */
const RAIN_CHANCE = 0.35;

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

const SAVE_PREFIX = "eggrally.";

interface SaveFile {
  game: "egg-rally";
  version: 1;
  savedAt: string;
  data: Record<string, string>;
}

/** Every stored key of this game (progress, records, ghosts, settings). */
function readSave(): Record<string, string> {
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(SAVE_PREFIX)) data[k.slice(SAVE_PREFIX.length)] = localStorage.getItem(k) ?? "";
    }
  } catch {
    /* storage unavailable */
  }
  return data;
}

/** A friendly random username suggestion. */
function randomName(): string {
  const a = ["Speedy", "Turbo", "Wobbly", "Brave", "Sunny", "Lucky", "Rapid", "Zippy", "Mighty", "Steady"];
  const b = ["Yolk", "Shell", "Chick", "Hatchling", "Omelet", "Racer", "Rider", "Driver"];
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(a)} ${pick(b)} ${Math.floor(Math.random() * 90 + 10)}`;
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
  private soundSettings: SoundSettings = { ...DEFAULT_SOUND, ...store.getJSON<Partial<SoundSettings>>("sound", {}) };
  private gameplay: GameplaySettings = { ...DEFAULT_GAMEPLAY, ...store.getJSON<Partial<GameplaySettings>>("gameplay", {}) };
  /** Which panel the sound settings were opened from. */
  private soundFrom: "menu" | "paused" = "menu";
  private toastTimer: number | null = null;
  /** The player's username ("" until they pick one on first launch). */
  private username = store.getStr("username");
  /** Where to return when the name panel closes (null = first launch, no going back). */
  private nameFrom: "menu" | null = null;
  /** Navigation minimap + upcoming-hazard alerts. */
  private navOn = store.getStr("nav") !== "off";
  /** 3D (WebGL) graphics, or the classic 2D look; "3dfast" is 3D with less detail for slower devices. */
  private graphics = (["3d", "3dfast", "2d"].includes(store.getStr("graphics")) ? store.getStr("graphics") : "3d") as "3d" | "3dfast" | "2d";
  private use3d = this.graphics !== "2d";
  private renderer3d: Renderer3D | null = null;
  /** 3D showroom behind the menu and garage (null if WebGL isn't available). */
  private showroom: Showroom | null = (() => {
    try {
      return new Showroom($<HTMLCanvasElement>("showroom"));
    } catch {
      return null;
    }
  })();
  /** Speed shown in miles per hour instead of km/h. */
  private mph = store.getStr("units") === "mph";
  private navAnnounced = new Set<string>();
  private navAlertTimer: number | null = null;
  private cockpit = new CockpitState();

  private world!: World;
  private terrain!: Terrain;
  private car!: Car;
  private scene!: Scene;

  private state: State = "menu";
  private mode: Mode = (["trial", "levels", "race"].includes(store.getStr("mode")) ? store.getStr("mode") : "endless") as Mode;
  private course: Course = COURSES.find((c) => c.id === store.getStr("course")) ?? COURSES[0];
  /** Levels mode: the chosen level and the stars/best time earned on each. */
  private level: Level = levelById(store.get("level") || 1);
  private levelResults: Record<number, LevelResult> = store.getJSON("levels", {});
  private levelReward = 0;
  /** Rank this run reached on the leaderboard (null if it didn't make the top 10). */
  private boardRank: number | null = null;
  private boardTab: "runs" | "totals" = "runs";
  private levelStars = 0;
  private acc = 0;
  private last = performance.now();
  private timeScale = 1;
  private crackPending = false;
  /** Lightning strike each storm last hit you with (one jolt per strike). */
  private zapped = new Map<SkyObstacle, number>();
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

  // Race mode: computer rivals, how many and how good, and the 3-2-1 start
  private rivals: Rival[] = [];
  private raceRivals = Math.max(1, Math.min(MAX_RIVALS, store.get("raceRivals") || 3));
  private raceSkill: RivalSkill = rivalSkillById(store.getStr("raceSkill") || "rookie");
  private countdown = 0;
  private racePlace = 0;
  private racePrize = 0;
  private raceStandings: { name: string; vehicle: string; time: number | null; you: boolean }[] = [];

  // Persistent progress
  private ownedMaps = new Set(["countryside", ...store.getStr("ownedMaps").split(",").filter(Boolean)]);
  private map: MapDef = mapById(this.ownedMaps.has(store.getStr("map")) ? store.getStr("map") : "countryside");
  private difficulty: Difficulty = difficultyById(store.getStr("difficulty") || "normal");
  private best = this.loadBest();
  private totalCoins = store.get("coins");
  private hudCache = "";
  private owned = new Set(["pickup", ...store.getStr("owned").split(",").filter(Boolean)]);
  private selected = this.owned.has(store.getStr("selected")) && VEHICLES.some((v) => v.id === store.getStr("selected")) ? store.getStr("selected") : "pickup";
  private mods: Record<string, VehicleMods> = store.getJSON("mods", {});
  private ownedPaints = new Set(["stock", ...store.getStr("ownedPaints").split(",").filter(Boolean)]);
  private lives = store.get("lives");
  private armorLevel = store.get("armor");
  /** Car interior (shared by all vehicles) and which interior items you own ("group:id"). */
  private interior: InteriorConfig = { ...DEFAULT_INTERIOR, ...store.getJSON<Partial<InteriorConfig>>("interior", {}) };
  private ownedInterior = new Set(store.getStr("ownedInterior").split(",").filter(Boolean));
  /** Lifetime stats that drive achievements, and which achievements are done. */
  private stats: Stats = { ...NO_STATS, ...store.getJSON<Partial<Stats>>("stats", {}) };
  private achieved = new Set(store.getStr("achievements").split(",").filter(Boolean));
  /** Seconds the car has been airborne in the current jump. */
  private airTime = 0;
  /** Stuck detection: seconds of gas without progress, and where that started. */
  private stuckTimer = 0;
  private stuckX = 0;
  /** Seconds until the next automatic save during a run. */
  private autosaveTimer = 5;
  private soundCheckTimer = 0;
  private lastSoundHint = 0;
  /** Rain this run (0 = dry, up to 1 = downpour). */
  private rain = 0;
  /**
   * Smooth motion: physics runs at a fixed 60 Hz, screens refresh at 60–144 Hz. Cars are drawn
   * at a blend between the last two physics steps (`prevPose`), then put back before the next step.
   */
  private prevPose = new Map<Body, { x: number; y: number; a: number }>();
  private shownPose = new Map<Body, { trueX: number; trueY: number; trueA: number; x: number; y: number; a: number }>();
  /** Seconds the car has been sitting still (the flip button also helps a stalled car). */
  private flipStillTimer = 0;
  private achCheckTimer = 0;

  private garage = new Garage($("garage-list"), $("garage-coins"), $("garage-tabs"), {
    buyMap: (map) => this.buyMap(map),
    selectMap: (map) => this.selectMap(map),
    buy: (def) => this.buyVehicle(def),
    select: (def) => this.selectVehicle(def),
    buyPart: (part) => this.buyPart(part),
    choosePaint: (paint) => this.choosePaint(paint),
    buyLife: () => this.buyLife(),
    buyArmor: () => this.buyArmor(),
    chooseInterior: (group, option) => this.chooseInterior(group, option),
    buildCar: (spec, price) => this.buildCustomCar(spec, price),
    buildMap: (spec, price) => this.buildCustomMap(spec, price),
    deleteCar: (id) => this.deleteCustomCar(id),
    deleteMap: (id) => this.deleteCustomMap(id),
  });

  constructor() {
    this.sound.onReady = (ctx, master) => this.music.attach(ctx, master);
    this.setupSoundSettings();
    this.setupMusicPickers();
    this.setupCameraPickers();
    this.newRun();
    this.bindUI();
    this.setupUsername();
    this.showMenu();
    // If you already own everything (e.g. from before the plane existed), unlock it now
    this.checkPlaneUnlock();
    // First launch: ask for a username before showing the menu.
    if (!this.username) this.openNamePanel(null);
    requestAnimationFrame((t) => this.frame(t));
    // Development builds only: a handle for performance checks from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __eggrally: Game }).__eggrally = this;
  }

  // ---------- setup ----------

  private modsFor(id: string): VehicleMods {
    return { ...NO_MODS, ...this.mods[id] };
  }

  private currentDef(): VehicleDef {
    return applyMods(vehicleById(this.selected), this.modsFor(this.selected));
  }

  /** Time Trial and Levels are fixed courses with a finish line. */
  private get onCourse(): boolean {
    return this.mode !== "endless";
  }

  private get courseLength(): number {
    return this.mode === "levels" ? this.level.distance : this.course.length;
  }

  private levelUnlocked(l: Level): boolean {
    return l.id === 1 || (this.levelResults[l.id - 1]?.stars ?? 0) > 0;
  }

  private trialKey(): string {
    if (this.mode === "levels") return `level.${this.level.id}`;
    if (this.mode === "race") return `race.${this.course.id}.${this.map.id}.${this.difficulty.id}`;
    return `trial.${this.course.id}.${this.map.id}.${this.difficulty.id}`;
  }

  private newRun(): void {
    const trial = this.onCourse;
    if (this.mode === "levels") {
      // Each level sets its own terrain and difficulty (just for this run; your picks are kept).
      this.map = mapById(this.level.map);
      this.difficulty = difficultyById(this.level.difficulty);
    }
    // Races get a fresh course every time; time trials and levels always use the same one.
    const seed = trial && this.mode !== "race" ? hashString(this.trialKey()) : Math.floor(Math.random() * 1e9);
    const def = this.currentDef();
    this.world = new World({ gravity: new Vec2(0, -this.map.gravity) });
    const canRain = this.gameplay.weather && (this.mode === "endless" || this.mode === "race") && RAINY.has(this.map.id);
    this.rain = canRain && Math.random() < RAIN_CHANCE ? 0.6 + Math.random() * 0.4 : 0;
    this.terrain = new Terrain(this.world, seed, this.difficulty, this.rain > 0 ? wetMap(this.map, this.rain) : this.map, trial ? this.courseLength : null, this.gameplay);
    this.zapped.clear();
    this.terrain.update(START_X, START_X);
    this.sound.setVehicle(this.selected);
    this.car = new Car(this.world, def, START_X, this.terrain.height(START_X), this.difficulty.eggFriction, this.map.gravity, { air: airDensity(this.map), wet: this.rain });
    this.rivals =
      this.mode === "race"
        ? makeRivals(this.world, this.terrain, this.raceRivals, this.raceSkill, this.selected, START_X, this.difficulty.eggFriction, this.map.gravity, seed)
        : [];
    this.countdown = 0;
    // Rival engines (race mode) for the 3D sound
    this.sound.setRivals(this.rivals.map((r) => r.def.id));

    this.world.on("begin-contact", (c) => this.onContact(c, 1));
    this.world.on("end-contact", (c) => this.onContact(c, -1));
    // Bridges only exist for drivers who chose the bridge route at that fork.
    const belt = this.map.conveyor ?? 0;
    this.world.on("pre-solve", (c) => {
      if (!this.isGround(c.getFixtureA()) && this.bridgeOf(c.getFixtureA()) !== null) c.setEnabled(false);
      if (!this.isGround(c.getFixtureB()) && this.bridgeOf(c.getFixtureB()) !== null) c.setEnabled(false);
      // Conveyor belt road: the surface itself moves forward, carrying whatever touches it
      if (belt) {
        const a = c.getFixtureA().getUserData() === "ground";
        const b = c.getFixtureB().getUserData() === "ground";
        if (a !== b) c.setTangentSpeed(a ? CONVEYOR_SIGN * belt : -CONVEYOR_SIGN * belt);
      }
    });

    this.ghost = trial && this.mode !== "race" ? store.getJSON<GhostData | null>(`ghost.${this.trialKey()}`, null) : null;
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
      armor: this.gameplay.lives ? this.armorLevel : 0,
      cockpit: null,
      rivals: this.rivals,
      rain: this.rain,
      // Day/night cycle on terrains without a fixed time (night maps and the reef keep theirs).
      // Runs start in daylight, at a random time between early morning and late afternoon.
      dayTime: this.gameplay.daynight && !this.map.stars && !this.map.bubbles && !this.map.indoor && !this.map.stages ? 0.29 + Math.random() * 0.4 : null,
      ghost: this.ghost ? { def: applyMods(vehicleById(this.ghost.vehicle), { ...NO_MODS, paint: this.ghost.paint }), pose: null } : null,
      smash: null,
      shake: 0,
      gauges: { kmh: 0, rpm: 0, gear: 0, fuel: 1, mph: this.mph, redline: 6800, attitude: { pitch: 0, slope: 0, airborne: false } },
      navMap: this.navOn,
      interior: resolveInterior(this.interior),
      dash: { glue: 0, fuel: 1, rpm: 0, gear: 0, ghostX: null, mph: this.mph, egg: "ok", readout: "", attitude: { pitch: 0, slope: 0, airborne: false } },
    };
    this.cockpit.reset();
    this.prevPose.clear();
    this.shownPose.clear();
    this.glueJoint = null;
    this.crackPending = false;
    this.crashTimer = 0;
    this.distance = 0;
    this.coinsRun = 0;
    this.acc = 0;
    this.timeScale = 1;
    this.fuel = this.fuelMax = def.fuel;
    this.noFuelTimer = 0;
    this.armorLeft = this.gameplay.lives ? this.armorLevel : 0;
    this.trialTime = 0;
    this.recording = [];
    this.newBestShown = false;
    this.navAnnounced.clear();
    $("nav-alert").classList.add("hidden");
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

    // Rival cars: wheel contacts for their driving, and their own egg cracks.
    for (const [f, other] of [[fa, fb], [fb, fa]] as const) {
      const rp = rivalPart(f.getUserData());
      if (!rp || other.getUserData() !== "ground") continue;
      const r = this.rivals[rp.index];
      if (!r) continue;
      if (rp.part === "wheel0") r.wheelContacts[0] = Math.max(0, r.wheelContacts[0] + delta);
      else if (rp.part === "wheel1") r.wheelContacts[1] = Math.max(0, r.wheelContacts[1] + delta);
      else if (rp.part === "egg" && delta === 1 && !r.eggBroken && this.state === "playing") {
        r.crack();
        if (Math.abs(r.x - this.car.chassis.getPosition().x) < 40) this.toast(`💥 ${r.name} cracked their egg!`);
      }
    }
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
    // Level pages
    $("level-prev").addEventListener("click", () => this.pickLevel(this.level.id - LEVELS_PER_PAGE));
    $("level-next").addEventListener("click", () => this.pickLevel(Math.min(this.latestLevel(), this.level.id + LEVELS_PER_PAGE)));
    $("level-latest").addEventListener("click", () => this.pickLevel(this.latestLevel()));
    const jump = () => {
      const want = Number($<HTMLInputElement>("level-jump").value);
      if (want > this.latestLevel()) this.toast(`🔒 Level ${want.toLocaleString()} is locked — reach it by clearing Level ${this.latestLevel().toLocaleString()} first`);
      this.pickLevel(want);
    };
    $("level-go").addEventListener("click", jump);
    $("level-jump").addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") jump();
    });
    $("btn-next").addEventListener("click", () => {
      if (this.level.id >= TOTAL_LEVELS) return;
      const next = levelById(this.level.id + 1);
      this.level = next;
      store.set("level", next.id);
      start();
    });
    $("btn-menu").addEventListener("click", () => {
      this.newRun();
      this.showMenu();
    });
    $("btn-resume").addEventListener("click", () => this.togglePause());
    $("btn-pause").addEventListener("click", () => {
      if (this.state === "playing" || this.state === "paused") this.togglePause();
    });
    $("btn-stop").addEventListener("click", () => this.stopRun());
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
      else if (!$("name-panel").classList.contains("hidden")) {
        if (k === "escape" && this.nameFrom) this.closePanel("name-panel", this.nameFrom);
        return; // typing a name shouldn't trigger game shortcuts
      } else if (k === "escape" && !$("sound").classList.contains("hidden")) this.closeSoundSettings();
      else if (k === "escape" && !$("gameplay").classList.contains("hidden")) this.closePanel("gameplay", "menu");
      else if (k === "escape" && !$("achievements").classList.contains("hidden")) this.closePanel("achievements", "menu");
      else if (k === "escape" && !$("board").classList.contains("hidden")) this.closePanel("board", "menu");
      else if (k === "escape" && !$("save").classList.contains("hidden")) this.closePanel("save", this.saveFrom);
      else if (k === "escape" && this.state === "garage") $("btn-garage-back").click();
      else if ((k === "p" || k === "escape") && (this.state === "playing" || this.state === "paused")) this.togglePause();
      else if (k === "f" && this.state === "playing") this.flipOver();
      else if (k === "c" && this.state !== "garage") this.cycleCamera();
      else if (k === "n" && this.state !== "garage") this.toggleNav();
      else if (k === "m") {
        this.setSound({ muted: !this.soundSettings.muted });
        this.toast(this.soundSettings.muted ? "🔇 Sound muted" : "🔊 Sound on");
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      if (this.state === "playing") this.togglePause();
      // Phones can close a backgrounded page without warning: save now.
      if (this.state === "playing" || this.state === "paused") this.checkpoint();
    });
    // Closing or refreshing the page mid-run counts as stopping the run: distance, stats and
    // the leaderboard are recorded just like pressing Stop.
    window.addEventListener("pagehide", () => {
      if (this.state === "playing" || this.state === "paused") this.stopRun();
    });
  }

  // ---------- menus ----------

  private setPanels(menu: boolean, over: boolean, paused: boolean, hud: boolean, garage = false): void {
    $("menu").classList.toggle("hidden", !menu);
    $("garage").classList.toggle("hidden", !garage);
    $("over").classList.toggle("hidden", !over);
    $("paused").classList.toggle("hidden", !paused);
    $("sound").classList.add("hidden");
    $("gameplay").classList.add("hidden");
    $("achievements").classList.add("hidden");
    $("board").classList.add("hidden");
    $("save").classList.add("hidden");
    $("hud").classList.toggle("hidden", !hud);
    $("pedals").classList.toggle("hidden", !hud || over);
    $("name-panel").classList.add("hidden");
    if (!hud || over) $("nav-alert").classList.add("hidden");
    this.updateShowroom(menu ? "menu" : garage ? "garage" : null);
  }

  /** The car on the showroom turntable, and its name plate. */
  private updateShowroom(layout: "menu" | "garage" | null): void {
    document.body.classList.toggle("showroom-on", layout !== null && this.showroom !== null);
    if (layout === null) {
      this.showroom?.hide();
      return;
    }
    const def = this.currentDef();
    this.showroom?.show(def, layout);
    const base = vehicleById(this.selected);
    for (const id of ["menu-caption", "garage-caption"]) {
      const el = $(id);
      el.replaceChildren();
      const name = document.createElement("b");
      name.textContent = base.name;
      const blurb = document.createElement("span");
      blurb.textContent = base.blurb;
      el.append(name, blurb);
    }
  }

  private showMenu(): void {
    this.state = "menu";
    $("menu-name").textContent = this.username || "Driver";
    this.renderModePicker();
    this.renderDifficulty();
    $("menu-coins").textContent = String(this.totalCoins);
    $("menu-vehicle").textContent = vehicleById(this.selected).name;
    $("menu-map").textContent = this.map.name;
    $("menu-lives").textContent = this.gameplay.lives ? `❤️ ${this.lives}${this.armorLevel ? `  🛡️ ${this.armorLevel}` : ""}` : "";
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
        ["levels", "Levels", this.mode === "levels"],
        ["race", "Race", this.mode === "race"],
      ],
      (id) => this.setMode(id as Mode, this.course),
    );
    $("course-row").classList.toggle("hidden", this.mode !== "trial");
    $("race-row").classList.toggle("hidden", this.mode !== "race");
    seg(
      "race-course",
      COURSES.map((c) => [c.id, `${c.name} ${c.length}m`, c.id === this.course.id]),
      (id) => this.setMode("race", COURSES.find((c) => c.id === id)!),
    );
    seg(
      "race-rivals",
      Array.from({ length: MAX_RIVALS }, (_, i) => [String(i + 1), String(i + 1), i + 1 === this.raceRivals] as [string, string, boolean]),
      (id) => {
        this.raceRivals = Number(id);
        store.set("raceRivals", this.raceRivals);
        this.newRun();
        this.showMenu();
      },
    );
    seg(
      "race-skill",
      RIVAL_SKILLS.map((k) => [k.id, k.name, k.id === this.raceSkill.id]),
      (id) => {
        this.raceSkill = rivalSkillById(id);
        store.set("raceSkill", id);
        this.newRun();
        this.showMenu();
      },
    );
    $("race-skill-blurb").textContent = this.raceSkill.blurb;
    $("level-row").classList.toggle("hidden", this.mode !== "levels");
    $("diff-block").classList.toggle("hidden", this.mode === "levels");
    if (this.mode === "levels") this.renderLevels();
    seg(
      "course",
      COURSES.map((c) => [c.id, `${c.name} ${c.length}m`, c.id === this.course.id]),
      (id) => this.setMode("trial", COURSES.find((c) => c.id === id)!),
    );
    if (this.mode === "levels") {
      const r = this.levelResults[this.level.id];
      $("menu-best-label").textContent = `Level ${this.level.id} best`;
      $("menu-best").textContent = r ? `${"★".repeat(r.stars)}${"☆".repeat(3 - r.stars)} ${formatTime(r.best)}` : "—";
    } else if (this.mode === "race") {
      $("menu-best-label").textContent = "Races won";
      $("menu-best").textContent = String(this.stats.racesWon ?? 0);
    } else if (this.mode === "trial") {
      const bt = store.get(`${this.trialKey()}`);
      $("menu-best-label").textContent = `Best time (${this.course.name}, ${this.map.name}, ${this.difficulty.name})`;
      $("menu-best").textContent = bt ? formatTime(bt) : "—";
    } else {
      $("menu-best-label").textContent = `Best (${this.map.name}, ${this.difficulty.name})`;
      $("menu-best").textContent = `${this.best} m`;
    }
  }

  /** Level grid: stars earned, locks, and details of the selected level. */
  /** Highest level you can play (levels unlock one after another). */
  private latestLevel(): number {
    let id = 1;
    while (id < TOTAL_LEVELS && (this.levelResults[id]?.stars ?? 0) > 0) id++;
    return id;
  }

  private pickLevel(id: number): void {
    const target = Math.max(1, Math.min(this.latestLevel(), Math.floor(id) || 1));
    this.level = levelById(target);
    store.set("level", target);
    this.newRun();
    this.showMenu();
  }

  private renderLevels(): void {
    const grid = $("level-grid");
    grid.replaceChildren();
    // Show the page of 20 that contains the selected level.
    const page = Math.floor((this.level.id - 1) / LEVELS_PER_PAGE);
    const first = page * LEVELS_PER_PAGE + 1;
    const last = Math.min(TOTAL_LEVELS, first + LEVELS_PER_PAGE - 1);
    $("level-page").textContent = `Levels ${first.toLocaleString()}–${last.toLocaleString()} of ${TOTAL_LEVELS.toLocaleString()}`;
    $<HTMLButtonElement>("level-prev").disabled = page === 0;
    $<HTMLButtonElement>("level-next").disabled = last >= TOTAL_LEVELS || first + LEVELS_PER_PAGE > this.latestLevel();
    for (let id = first; id <= last; id++) {
      const l = levelById(id);
      const unlocked = this.levelUnlocked(l);
      const stars = this.levelResults[l.id]?.stars ?? 0;
      const btn = document.createElement("button");
      btn.className = "lvl" + (l.id === this.level.id ? " active" : "") + (unlocked ? "" : " locked");
      btn.disabled = !unlocked;
      btn.setAttribute("aria-label", unlocked ? `Level ${l.id}, ${stars} stars` : `Level ${l.id}, locked`);
      const num = document.createElement("b");
      num.textContent = unlocked ? l.id.toLocaleString() : "🔒";
      const st = document.createElement("small");
      st.textContent = unlocked ? "★".repeat(stars) + "☆".repeat(3 - stars) : "";
      btn.append(num, st);
      btn.addEventListener("click", () => this.pickLevel(l.id));
      grid.appendChild(btn);
    }
    const l = this.level;
    const par = parTimes(l);
    const diff = difficultyById(l.difficulty).name;
    const done = this.levelResults[l.id];
    $("level-info").textContent =
      `Level ${l.id}: reach ${l.distance} m on ${mapById(l.map).name} (${diff}). ` +
      `★★ under ${formatTime(par.two)}, ★★★ under ${formatTime(par.three)}. ` +
      (done ? `Replay to improve your stars.` : `First clear: +${l.reward} coins.`);
  }

  private setMode(mode: Mode, course: Course): void {
    // Leaving Levels: go back to your own terrain and difficulty picks.
    if (this.mode === "levels" && mode !== "levels") {
      this.map = mapById(this.ownedMaps.has(store.getStr("map")) ? store.getStr("map") : "countryside");
      this.difficulty = difficultyById(store.getStr("difficulty") || "normal");
      this.best = this.loadBest();
    }
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

  // ---------- sound settings ----------

  private setupSoundSettings(): void {
    this.applySound();
    for (const key of VOLUME_KEYS) {
      $<HTMLInputElement>(`snd-${key}`).addEventListener("input", (e) => {
        this.setSound({ [key]: Number((e.target as HTMLInputElement).value) / 100 });
      });
    }
    $<HTMLInputElement>("snd-muted").addEventListener("change", (e) => this.setSound({ muted: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>("snd-headphones").addEventListener("change", (e) => this.setSound({ headphones: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>("snd-simple").addEventListener("change", (e) => {
      this.sound.unlock();
      this.setSound({ simple: (e.target as HTMLInputElement).checked });
    });
    $("snd-check").addEventListener("click", () => this.soundCheck());
    $("btn-mute").addEventListener("click", () => {
      this.sound.unlock();
      this.setSound({ muted: !this.soundSettings.muted });
      this.toast(this.soundSettings.muted ? "🔇 Sound muted" : "🔊 Sound on");
    });
    $("snd-test").addEventListener("click", () => {
      this.sound.unlock();
      this.sound.coin();
      window.setTimeout(() => this.sound.powerUp(), 350);
    });
    $("snd-reset").addEventListener("click", () => this.setSound({ ...DEFAULT_SOUND }));
    $("btn-sound-menu").addEventListener("click", () => this.openSoundSettings("menu"));
    $("btn-sound-pause").addEventListener("click", () => this.openSoundSettings("paused"));
    $("btn-sound-back").addEventListener("click", () => this.closeSoundSettings());

    // Game settings: optional rules, chosen from the main menu and applied from the next run.
    for (const key of GAMEPLAY_KEYS) {
      const box = $<HTMLInputElement>(`opt-${key}`);
      box.checked = this.gameplay[key];
      box.addEventListener("change", () => {
        this.gameplay = { ...this.gameplay, [key]: box.checked };
        store.setJSON("gameplay", this.gameplay);
        this.newRun(); // rebuild the menu backdrop with the new rules
        this.showMenu();
        this.openPanel("gameplay", "menu");
      });
    }
    $("btn-gameplay").addEventListener("click", () => this.openPanel("gameplay", "menu"));
    $("btn-board").addEventListener("click", () => {
      this.renderBoard();
      this.openPanel("board", "menu");
    });
    $("btn-board-back").addEventListener("click", () => this.closePanel("board", "menu"));
    $("btn-achievements").addEventListener("click", () => {
      this.renderAchievements();
      this.openPanel("achievements", "menu");
    });
    $("btn-ach-back").addEventListener("click", () => this.closePanel("achievements", "menu"));
    this.renderUnits();
    this.applyGraphics();

    // Save / load
    $("btn-save-menu").addEventListener("click", () => this.openSave("menu"));
    $("btn-save-pause").addEventListener("click", () => this.openSave("paused"));
    $("btn-save-back").addEventListener("click", () => this.closePanel("save", this.saveFrom));
    $("btn-save-file").addEventListener("click", () => this.saveToFile());
    $("btn-load-file").addEventListener("click", () => $<HTMLInputElement>("load-input").click());
    $<HTMLInputElement>("load-input").addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.loadFromFile(file);
    });
    $("btn-gameplay-back").addEventListener("click", () => this.closePanel("gameplay", "menu"));
  }

  private saveFrom: "menu" | "paused" = "menu";

  private openSave(from: "menu" | "paused"): void {
    this.saveFrom = from;
    $("save-status").textContent = "";
    const ownedVehicles = this.owned.size;
    const ownedMaps = this.ownedMaps.size;
    const records = Object.keys(readSave()).filter((k) => k.startsWith("best.") || k.startsWith("trial.")).length;
    $("save-summary").innerHTML = "";
    for (const [label, value] of [
      ["Coins", String(this.totalCoins)],
      ["Vehicles", `${ownedVehicles}`],
      ["Terrains", `${ownedMaps}`],
      ["Extra lives", `${this.lives}`],
      ["Records", `${records}`],
    ]) {
      const row = document.createElement("div");
      row.innerHTML = `<span></span><b></b>`;
      row.children[0].textContent = label;
      row.children[1].textContent = value;
      $("save-summary").appendChild(row);
    }
    this.openPanel("save", from);
  }

  /** Downloads everything the game has stored as a JSON file. */
  private saveToFile(): void {
    const save: SaveFile = { game: "egg-rally", version: 1, savedAt: new Date().toISOString(), data: readSave() };
    const blob = new Blob([JSON.stringify(save)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eggy-car-save-${save.savedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("save-status").textContent = "✅ Saved! Check your downloads folder.";
    this.sound.coin();
  }

  /** Replaces the stored progress with a save file, after confirming, then restarts the game. */
  private async loadFromFile(file: File): Promise<void> {
    let save: SaveFile;
    try {
      save = JSON.parse(await file.text()) as SaveFile;
      if (save?.game !== "egg-rally" || typeof save.data !== "object" || save.data === null) throw new Error("not a save");
    } catch {
      $("save-status").textContent = "❌ That file isn't an Eggy Car save.";
      return;
    }
    const when = save.savedAt ? new Date(save.savedAt).toLocaleString() : "an unknown date";
    if (!window.confirm(`Load the save from ${when}? This replaces your current progress.`)) return;
    try {
      for (const k of Object.keys(readSave())) localStorage.removeItem(SAVE_PREFIX + k);
      for (const [k, v] of Object.entries(save.data)) if (typeof v === "string") localStorage.setItem(SAVE_PREFIX + k, v);
    } catch {
      $("save-status").textContent = "❌ Couldn't write to browser storage.";
      return;
    }
    window.location.reload();
  }

  /** Switches between the 3D renderer and the classic 2D one, falling back to 2D without WebGL. */
  private applyGraphics(): void {
    if (this.use3d && !this.renderer3d) {
      try {
        if (!Renderer3D.supported()) throw new Error("no WebGL");
        this.renderer3d = new Renderer3D($<HTMLCanvasElement>("game3d"));
      } catch {
        this.use3d = false;
        this.toast("3D isn't available on this device — using 2D");
      }
    }
    if (!this.use3d) this.graphics = "2d";
    this.renderer3d?.setQuality(this.graphics === "3dfast" ? "fast" : "high");
    $("game3d").classList.toggle("hidden", !this.use3d);
    document.body.classList.toggle("three-d", this.use3d);
    const wrap = $("graphics");
    wrap.replaceChildren();
    for (const [id, label] of [
      ["3d", "3D"],
      ["3dfast", "3D Fast"],
      ["2d", "Classic 2D"],
    ]) {
      const active = id === this.graphics;
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = active ? "active" : "";
      btn.setAttribute("aria-pressed", String(active));
      btn.addEventListener("click", () => {
        this.graphics = id as "3d" | "3dfast" | "2d";
        this.use3d = id !== "2d";
        store.set("graphics", id);
        this.applyGraphics();
      });
      wrap.appendChild(btn);
    }
  }

  /** Speed units picker (applies instantly, no new run needed). */
  private renderUnits(): void {
    const wrap = $("units");
    wrap.replaceChildren();
    for (const [id, label] of [
      ["kmh", "km/h"],
      ["mph", "mph"],
    ]) {
      const active = (id === "mph") === this.mph;
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = active ? "active" : "";
      btn.setAttribute("aria-pressed", String(active));
      btn.addEventListener("click", () => {
        this.mph = id === "mph";
        store.set("units", id);
        this.renderUnits();
      });
      wrap.appendChild(btn);
    }
  }

  // ---------- username ----------

  private setupUsername(): void {
    $("btn-name").addEventListener("click", () => this.openNamePanel("menu"));
    $("name-random").addEventListener("click", () => {
      $<HTMLInputElement>("name-input").value = randomName();
      $("name-error").textContent = "";
    });
    $("name-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $<HTMLInputElement>("name-input").value.trim().replace(/\s+/g, " ");
      if (name.length < 2 || name.length > 16 || !/^[\p{L}\p{N} _-]+$/u.test(name)) {
        $("name-error").textContent = "Use 2–16 letters, numbers, spaces, - or _.";
        return;
      }
      this.username = name;
      store.set("username", name);
      this.sound.unlock();
      $("name-panel").classList.add("hidden");
      this.showMenu();
      this.toast(`👋 Hi, ${name}!`);
    });
  }

  private openNamePanel(from: "menu" | null): void {
    this.nameFrom = from;
    $("name-title").textContent = from ? "Change username" : "Welcome, driver!";
    $<HTMLInputElement>("name-input").value = this.username || randomName();
    $("name-error").textContent = "";
    $("menu").classList.add("hidden");
    $("name-panel").classList.remove("hidden");
    $<HTMLInputElement>("name-input").focus();
    $<HTMLInputElement>("name-input").select();
  }

  private openPanel(id: string, from: string): void {
    $(from).classList.add("hidden");
    $(id).classList.remove("hidden");
  }

  private closePanel(id: string, to: string): void {
    $(id).classList.add("hidden");
    $(to).classList.remove("hidden");
  }

  private setSound(change: Partial<SoundSettings>): void {
    this.soundSettings = { ...this.soundSettings, ...change };
    store.setJSON("sound", this.soundSettings);
    this.applySound();
  }

  /** Pushes the settings to the audio engine and syncs the panel's controls. */
  private applySound(): void {
    const s = this.soundSettings;
    this.sound.setMuted(s.muted);
    this.sound.setSimple(!!s.simple);
    this.sound.setHeadphones(!!s.headphones);
    this.sound.setVolumes({ master: s.master, effects: s.effects, engine: s.engine });
    this.updateMusic();
    for (const key of VOLUME_KEYS) {
      const pct = Math.round(s[key] * 100);
      $<HTMLInputElement>(`snd-${key}`).value = String(pct);
      $(`snd-${key}-val`).textContent = `${pct}%`;
    }
    $<HTMLInputElement>("snd-muted").checked = s.muted;
    // The HUD sound button always shows whether sound is on (a forgotten mute is easy to miss)
    $("btn-mute").textContent = s.muted ? "🔇" : "🔊";
    $("btn-mute").classList.toggle("muted", s.muted);
    this.updateSoundStatus();
    $<HTMLInputElement>("snd-headphones").checked = !!s.headphones;
    $<HTMLInputElement>("snd-simple").checked = !!s.simple;
    $("sound").classList.toggle("muted", s.muted);
  }

  /**
   * Sound check: beep 1 uses a plain HTML audio element (no Web Audio at all); beep 2 uses Web
   * Audio straight to the speakers. Which ones you hear tells us where the sound is getting lost.
   */
  private soundCheck(): void {
    this.sound.unlock();
    const out = $("snd-check-out");
    out.classList.remove("hidden");
    const lines: string[] = [];
    const render = () => {
      out.replaceChildren();
      for (const l of [...lines, ...this.sound.diagnostics(), `Browser: ${navigator.userAgent.match(/(Version\/[\d.]+ Safari|Chrome\/[\d.]+|Firefox\/[\d.]+|Edg\/[\d.]+)/)?.[0] ?? navigator.userAgent.slice(0, 60)}`]) {
        const d = document.createElement("div");
        d.textContent = l;
        out.appendChild(d);
      }
    };
    // Beep 1: a tiny generated WAV through an <audio> element
    const sr = 22050;
    const n = Math.floor(sr * 0.4);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / sr) * 12000 * Math.min(1, (n - i) / 2000), true);
    const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
    lines.push("Beep 1 (low, plain audio): playing…");
    render();
    audio.play().then(
      () => { lines[0] = "Beep 1 (low, plain audio): played"; render(); },
      (e) => { lines[0] = `Beep 1 (low, plain audio): BLOCKED (${(e as Error).name})`; render(); },
    );
    // Beep 2: Web Audio, a moment later
    window.setTimeout(() => {
      this.sound.testBeep();
      lines.push("Beep 2 (high, game audio): played");
      render();
    }, 800);
    window.setTimeout(render, 1600);
  }

  /** Sound settings status line: on, muted, or blocked by the browser (with what to do). */
  private updateSoundStatus(): void {
    const el = $("snd-status");
    if (this.soundSettings.muted) el.textContent = "🔇 Sound is muted. Untick “Mute all” (or press M) to hear it.";
    else if (this.soundSettings.master === 0) el.textContent = "🔈 Master volume is at 0%.";
    else if (!this.sound.running) el.textContent = "⚠️ Your browser is holding the sound back. Click or tap anywhere to turn it on.";
    else el.textContent = "✅ Sound is on. No sound? Check your computer's volume and that this browser tab isn't muted.";
    el.className = `snd-status ${this.soundSettings.muted || !this.sound.running ? "warn" : "ok"}`;
  }

  private openSoundSettings(from: "menu" | "paused"): void {
    this.soundFrom = from;
    this.sound.unlock();
    window.setTimeout(() => this.updateSoundStatus(), 300);
    $(from).classList.add("hidden");
    $("sound").classList.remove("hidden");
  }

  private closeSoundSettings(): void {
    $("sound").classList.add("hidden");
    $(this.soundFrom).classList.remove("hidden");
  }

  // ---------- music ----------

  private setupMusicPickers(): void {
    for (const id of ["menu-music", "pause-music"]) {
      const select = $<HTMLSelectElement>(id);
      const options: [string, string][] = [
        ["auto", "Match terrain"],
        ["shuffle", "🔀 Shuffle all"],
        ...TRACKS.map((t): [string, string] => [t.id, t.name]),
        ["off", "Off"],
      ];
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
    // Wake the audio on every press (not just the first): browsers pause it when you switch tabs
    // or apps, and it can only restart from a tap, click or key press.
    const wake = () => this.sound.unlock();
    for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, wake, { passive: true });
  }

  private updateMusic(): void {
    for (const id of ["menu-music", "pause-music"]) $<HTMLSelectElement>(id).value = this.musicChoice;
    if (this.musicChoice === "shuffle") this.music.shuffle(TRACKS);
    else {
      const id = this.musicChoice === "auto" ? MAP_TRACK[this.map.id] ?? "sunny" : this.musicChoice;
      this.music.play(TRACKS.find((t) => t.id === id) ?? null);
    }
    // Mute and master volume are applied on the shared master bus; this is just the music channel.
    this.music.setVolume(this.soundSettings.music ** 2 * (this.state === "paused" ? 0.35 : 1));
  }

  // ---------- workshop: custom cars and terrains ----------

  private buildCustomCar(spec: CarSpec, price: number): void {
    if (this.totalCoins < price) return;
    this.totalCoins -= price;
    store.set("coins", this.totalCoins);
    saveCar(spec);
    this.owned.add(spec.id);
    store.set("owned", [...this.owned].join(","));
    this.checkPlaneUnlock();
    this.sound.coin();
    this.toast(`🔧 ${spec.name} is ready to drive!`);
    this.selectVehicle(vehicleById(spec.id));
  }

  private buildCustomMap(spec: MapSpec, price: number): void {
    if (this.totalCoins < price) return;
    this.totalCoins -= price;
    store.set("coins", this.totalCoins);
    saveMap(spec);
    this.ownedMaps.add(spec.id);
    store.set("ownedMaps", [...this.ownedMaps].join(","));
    this.checkPlaneUnlock();
    this.sound.coin();
    this.toast(`🔧 ${spec.name} is ready to explore!`);
    this.selectMap(mapById(spec.id));
  }

  private deleteCustomCar(id: string): void {
    removeCustomCar(id);
    this.owned.delete(id);
    store.set("owned", [...this.owned].join(","));
    if (this.selected === id) this.selectVehicle(vehicleById("pickup"));
    else this.renderGarage();
  }

  private deleteCustomMap(id: string): void {
    removeCustomMap(id);
    this.ownedMaps.delete(id);
    store.set("ownedMaps", [...this.ownedMaps].join(","));
    if (this.map.id === id) this.selectMap(mapById("countryside"));
    else this.renderGarage();
  }

  // ---------- garage & shop ----------

  private showGarage(): void {
    this.checkPlaneUnlock();
    this.state = "garage";
    this.setPanels(false, false, false, false, true);
    this.renderGarage();
  }

  private renderGarage(): void {
    if (this.state === "garage") this.updateShowroom("garage");
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
      stats: this.stats,
      interior: this.interior,
      planeProgress: this.planeProgress(),
      ownedInterior: this.ownedInterior,
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
    if (achievementFor("vehicle", def.id)) return;
    if (this.owned.has(def.id) || !this.spend(def.price)) return;
    this.owned.add(def.id);
    store.set("owned", [...this.owned].join(","));
    this.selectVehicle(def);
  }

  /**
   * The Eggy Plane: unlocked by owning every built-in vehicle and terrain (your own Workshop
   * creations don't count). Returns progress for the garage card.
   */
  planeProgress(): { have: number; total: number; missing: string[] } {
    const cars = VEHICLES.filter((v) => !v.id.startsWith("custom-") && v.id !== "eggplane");
    const maps = MAPS.filter((m) => !m.id.startsWith("custom-"));
    const missing = [...cars.filter((v) => !this.owned.has(v.id)).map((v) => v.name), ...maps.filter((m) => !this.ownedMaps.has(m.id)).map((m) => m.name)];
    return { have: cars.length + maps.length - missing.length, total: cars.length + maps.length, missing };
  }

  private checkPlaneUnlock(): void {
    if (this.owned.has("eggplane")) return;
    const p = this.planeProgress();
    if (p.have < p.total) return;
    this.owned.add("eggplane");
    store.set("owned", [...this.owned].join(","));
    this.sound.finish();
    this.toast("✈️ You own everything! The Eggy Plane is unlocked!");
  }

  private selectVehicle(def: VehicleDef): void {
    if (!this.owned.has(def.id)) return;
    this.selected = def.id;
    store.set("selected", def.id);
    this.renderGarage();
  }

  private buyMap(map: MapDef): void {
    if (achievementFor("map", map.id)) return;
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

  /** Selects an interior item, buying it first if needed. */
  private chooseInterior(group: InteriorGroup, option: InteriorOption): void {
    const key = `${group}:${option.id}`;
    if (option.price > 0 && !this.ownedInterior.has(key)) {
      if (!this.spend(option.price)) return;
      this.ownedInterior.add(key);
      store.set("ownedInterior", [...this.ownedInterior].join(","));
    }
    this.interior = { ...this.interior, [group]: option.id };
    store.setJSON("interior", this.interior);
    this.scene.interior = resolveInterior(this.interior);
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
    if (!this.stats.terrainsPlayed.includes(this.map.id)) {
      this.stats.terrainsPlayed = [...this.stats.terrainsPlayed, this.map.id];
      this.checkAchievements();
    }
    this.airTime = 0;
    if (this.state !== "menu") this.newRun();
    this.state = "playing";
    this.hudCache = "";
    $("hud-time-row").classList.toggle("hidden", !this.onCourse);
    // If the browser is still blocking audio a moment after the start, say how to turn it on.
    window.setTimeout(() => {
      if (this.state === "playing" && !this.sound.running && !this.soundSettings.muted) this.toast("🔊 Tap the screen to turn on sound");
    }, 1200);
    if (this.mode === "race") {
      this.countdown = 3;
      this.sound.countdown(false);
    }
    $("hud-race").classList.toggle("hidden", this.mode !== "race");
    if (this.rain > 0) this.toast("🌧️ Rain! Wet roads are slippery — brake early.");
    this.levelReward = 0;
    this.levelStars = 0;
    this.setPanels(false, false, false, true);
    this.updateMusic();
  }

  /** Ends the current run on purpose: coins are kept and the distance counts toward your best. */
  private stopRun(): void {
    if (this.state !== "paused" && this.state !== "playing") return;
    this.last = performance.now();
    this.endRun("stopped");
    this.showResults();
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

  /** Welds the egg to the car where it currently sits. Picking up more glue adds to the timer. */
  private activateGlue(): void {
    if (this.scene.eggBroken) return;
    // Each bottle adds another 15 seconds on top of whatever glue time is left.
    const stacked = this.scene.glue > 0;
    this.scene.glue += GLUE_SECONDS;
    if (stacked) this.toast(`🧴 +${GLUE_SECONDS}s glue — ${Math.ceil(this.scene.glue)}s left`);
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
    if (this.gameplay.lives && this.armorLeft > 0) {
      this.armorLeft--;
      this.scene.armor = this.armorLeft;
      this.rescueEgg("🛡️ Shell armor saved your egg!");
    } else if (this.gameplay.lives && this.lives > 0) {
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

  /** Tipped over (or stuck going nowhere): put the car back on its wheels. */
  private canFlip(): boolean {
    if (this.state !== "playing" || this.scene.eggBroken) return false;
    // Not in the air: the car must be resting on something (wheels, or its body if it's on its roof or side)
    if (!this.carTouchingGround()) return false;
    const v = this.car.chassis.getLinearVelocity();
    const slow = Math.hypot(v.x, v.y) < 1.5;
    return this.car.tipped > 0.6 || (slow && this.flipStillTimer > 1.5);
  }

  /** True when a wheel or the car's body is touching the ground. */
  private carTouchingGround(): boolean {
    if (this.car.onGround) return true;
    for (let ce = this.car.chassis.getContactList(); ce; ce = ce.next ?? null) {
      const c = ce.contact;
      if (c.isTouching() && c.isEnabled() && (this.isGround(c.getFixtureA()) || this.isGround(c.getFixtureB()))) return true;
    }
    return false;
  }

  private flipOver(): void {
    if (this.state !== "playing") return;
    if (this.scene.eggBroken) return;
    if (!this.canFlip()) {
      this.toast(this.carTouchingGround() ? "🔄 Flip works when you've tipped over or stopped" : "🔄 Can't flip in the air — wait until you land");
      return;
    }
    // Glue holds the egg to the chassis: release it for the move, then stick it back on.
    const glued = this.glueJoint !== null;
    if (glued) {
      this.world.destroyJoint(this.glueJoint!);
      this.glueJoint = null;
    }
    this.car.flipUpright((x) => this.terrain.height(x));
    if (glued) this.glueJoint = this.world.createJoint(new WeldJoint({}, this.car.chassis, this.car.egg, this.car.egg.getPosition())) as WeldJoint;
    this.crackPending = false;
    // A moment of protection so the egg can settle without cracking
    this.scene.shield = Math.max(this.scene.shield, 1);
    this.flipStillTimer = 0;
    this.burst(this.car.chassis.getPosition(), ["#d8c9a8", "#ffffff", "#b49a72"], 12);
    this.sound.flip();
    this.toast("🔄 Back on your wheels!");
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

  /** Coins go straight into your wallet (and storage) the moment you earn them. */
  private earn(n: number): void {
    if (n <= 0) return;
    this.coinsRun += n;
    this.totalCoins += n;
    this.stats.coinsEarned += n;
    store.set("coins", this.totalCoins);
  }

  /**
   * Saves progress made so far in the current run (stats, best distance, coins), so nothing is
   * lost if the page closes before the run ends. Distance totals are added when the run ends.
   */
  private checkpoint(): void {
    store.set("coins", this.totalCoins);
    store.setJSON("stats", this.stats);
    if (this.mode === "endless" && this.distance > this.best) {
      this.best = this.distance;
      store.set(this.bestKey(), this.best);
    }
  }

  private endRun(reason: EndReason): void {
    this.endReason = reason;
    if (this.mode === "race" && reason !== "finish") {
      this.computeStandings(false);
      this.racePrize = 0;
    }
    this.car.cutEngine();
    this.state = reason === "finish" ? "finished" : "crashed";
    this.crashTimer = 0;
    if (this.mode === "endless" && this.distance > this.best) {
      this.best = this.distance;
      store.set(this.bestKey(), this.best);
    }
    // (Coins were banked as they were collected; see earn().)
    store.set("coins", this.totalCoins);
    this.stats.totalDistance += this.distance;
    if (reason === "finish" && this.mode === "trial") this.stats.trialsFinished++;
    this.trackBests();
    this.checkAchievements();
    this.boardRank = recordRun(
      {
        name: this.username || "Driver",
        meters: this.distance,
        vehicle: this.car.def.name,
        map: this.map.name,
        difficulty: this.difficulty.name,
        date: new Date().toISOString(),
      },
      this.mode === "endless",
    );
  }

  /** Updates single-run bests (distance overall, on Hard, on Moon Base) from the current run. */
  private trackBests(): void {
    const s = this.stats;
    s.bestRun = Math.max(s.bestRun, this.distance);
    if (this.difficulty.id === "hard") s.bestHard = Math.max(s.bestHard, this.distance);
    if (this.map.id === "moon") s.bestMoon = Math.max(s.bestMoon, this.distance);
  }

  /** Completes any achievements whose goal is met and unlocks their rewards. */
  private checkAchievements(): void {
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (this.achieved.has(a.id) || a.progress(this.stats) < a.target) continue;
      this.achieved.add(a.id);
      changed = true;
      const isVehicle = a.reward.kind === "vehicle";
      const owned = isVehicle ? this.owned : this.ownedMaps;
      const name = isVehicle ? vehicleById(a.reward.id).name : mapById(a.reward.id).name;
      const had = owned.has(a.reward.id);
      owned.add(a.reward.id);
      store.set(isVehicle ? "owned" : "ownedMaps", [...owned].join(","));
      this.sound.newBest();
      this.toast(`🏆 ${a.name}! ${had ? `(${name} already yours)` : `${name} unlocked!`}`);
    }
    if (changed) store.set("achievements", [...this.achieved].join(","));
    if (changed) this.checkPlaneUnlock();
    store.setJSON("stats", this.stats);
  }

  /** In-game leaderboard: longest single runs, or lifetime meters per driver. */
  private renderBoard(): void {
    const tabs = $("board-tabs");
    tabs.replaceChildren();
    for (const [id, label] of [
      ["runs", "Longest run"],
      ["totals", "Total distance"],
    ] as ["runs" | "totals", string][]) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.className = id === this.boardTab ? "active" : "";
      btn.setAttribute("aria-pressed", String(id === this.boardTab));
      btn.addEventListener("click", () => {
        this.boardTab = id;
        this.renderBoard();
      });
      tabs.appendChild(btn);
    }
    const board = loadBoard();
    const list = $("board-list");
    list.replaceChildren();
    const me = this.username || "Driver";
    const row = (rank: number, name: string, meters: number, detail: string) => {
      const r = document.createElement("div");
      r.className = "board-row" + (name === me ? " me" : "");
      const a = document.createElement("span");
      a.className = "board-rank";
      a.textContent = medal(rank);
      const b = document.createElement("span");
      b.className = "board-name";
      b.textContent = name === me ? `${name} (you)` : name;
      const c = document.createElement("span");
      c.className = "board-meters";
      c.textContent = `${meters.toLocaleString()} m`;
      const d = document.createElement("small");
      d.className = "board-detail";
      d.textContent = detail;
      r.append(a, b, c, d);
      list.appendChild(r);
    };
    if (this.boardTab === "runs") {
      board.runs.slice(0, SHOW).forEach((e, i) => row(i + 1, e.name, e.meters, `${e.vehicle} · ${e.map} · ${e.difficulty} · ${new Date(e.date).toLocaleDateString()}`));
      $("board-note").textContent = "Top 10 single runs in Endless mode on this device.";
    } else {
      totalsRanked(board).slice(0, SHOW).forEach((t, i) => row(i + 1, t.name, t.meters, "Lifetime distance, all modes"));
      $("board-note").textContent = "Every meter driven, in any mode, by each driver on this device.";
    }
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "board-empty";
      empty.textContent = "No runs yet — be the first on the board!";
      list.appendChild(empty);
    }
  }

  private renderAchievements(): void {
    const list = $("ach-list");
    list.replaceChildren();
    for (const a of ACHIEVEMENTS) {
      const done = this.achieved.has(a.id);
      const row = document.createElement("div");
      row.className = "ach" + (done ? " done" : "");
      const icon = document.createElement("span");
      icon.className = "ach-icon";
      icon.textContent = done ? "🏆" : a.icon;
      const name = document.createElement("span");
      name.className = "ach-name";
      const reward = a.reward.kind === "vehicle" ? `🚗 ${vehicleById(a.reward.id).name}` : `🗺️ ${mapById(a.reward.id).name}`;
      name.textContent = `${a.name} — unlocks ${reward}`;
      const goal = document.createElement("span");
      goal.className = "ach-goal";
      goal.textContent = a.goal;
      const foot = document.createElement("span");
      foot.className = "ach-foot";
      const bar = document.createElement("span");
      bar.className = "lock-bar";
      const fill = document.createElement("i");
      fill.style.width = `${Math.round((done ? 1 : progressFraction(a, this.stats)) * 100)}%`;
      bar.appendChild(fill);
      const txt = document.createElement("span");
      txt.textContent = done ? "Unlocked!" : progressText(a, this.stats);
      foot.append(bar, txt);
      row.append(icon, name, goal, foot);
      list.appendChild(row);
    }
    $("ach-summary").textContent = `${this.achieved.size} / ${ACHIEVEMENTS.length} unlocked`;
  }

  private finishTrial(): void {
    if (this.mode === "race") {
      this.finishRace();
      return;
    }
    const key = this.trialKey();
    const prev = store.get(key);
    const record = !prev || this.trialTime < prev;
    if (record) {
      store.set(key, this.trialTime);
      const ghost: GhostData = { vehicle: this.selected, paint: this.modsFor(this.selected).paint, frames: this.recording.map((n) => Math.round(n * 100) / 100) };
      store.setJSON(`ghost.${key}`, ghost);
    }
    this.sound.finish();
    if (this.mode === "levels") this.scoreLevel();
    this.endRun("finish");
    this.showResults(record, prev);
  }

  /**
   * Final standings: rivals who already finished keep their time; the rest get a time estimated
   * from their pace so far. Prize money depends on your place and the course length.
   */
  private computeStandings(youFinished: boolean): void {
    const finishX = this.terrain.finishX ?? this.courseLength;
    const t = this.trialTime;
    const rows = this.rivals.map((r) => {
      let time = r.finishTime;
      if (time === null) {
        const pace = Math.max(2, r.x / Math.max(1, t));
        time = t + Math.max(0, finishX - r.x) / pace;
      }
      return { name: r.name, vehicle: r.def.name, time, you: false };
    });
    rows.push({ name: this.username || "You", vehicle: this.car.def.name, time: youFinished ? t : null, you: true } as (typeof rows)[number]);
    rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    this.raceStandings = rows;
    this.racePlace = youFinished ? rows.findIndex((r) => r.you) + 1 : 0;
  }

  private finishRace(): void {
    this.computeStandings(true);
    const prizes = [150, 90, 50, 30, 20, 10];
    this.racePrize = Math.round(prizes[this.racePlace - 1] * (this.courseLength / 400) * (0.75 + RIVAL_SKILLS.indexOf(this.raceSkill) * 0.5));
    this.earn(this.racePrize);
    if (this.racePlace === 1) this.stats.racesWon = (this.stats.racesWon ?? 0) + 1;
    if (this.racePlace === 1) this.sound.finish();
    else this.sound.newBest();
    this.endRun("finish");
    this.showResults();
  }

  /** Stars and coin reward for clearing the current level (more stars later pay a bonus). */
  private scoreLevel(): void {
    const l = this.level;
    const prev = this.levelResults[l.id];
    const stars = starsFor(l, this.trialTime);
    let reward = 0;
    if (!prev) reward = l.reward;
    else if (stars > prev.stars) reward = Math.round(l.reward * 0.25 * (stars - prev.stars));
    this.levelResults[l.id] = { stars: Math.max(stars, prev?.stars ?? 0), best: Math.min(this.trialTime, prev?.best ?? Infinity) };
    store.setJSON("levels", this.levelResults);
    this.levelStars = stars;
    this.levelReward = reward;
    this.earn(reward);
  }

  private showResults(record = false, prevTime = 0): void {
    this.state = "over";
    const trial = this.onCourse;
    const title =
      this.endReason === "finish"
        ? record
          ? "🏁 New Record!"
          : "🏁 Finished!"
        : this.endReason === "fuel"
          ? "Out of Fuel!"
          : this.endReason === "stopped"
            ? "⏹ Run Stopped"
            : "Egg Smashed!";
    $("over-title").textContent = this.mode === "levels" && this.endReason === "finish" ? `Level ${this.level.id} Complete!` : title;
    const next = this.level.id < TOTAL_LEVELS;
    $("btn-next").classList.toggle("hidden", !(this.mode === "levels" && this.endReason === "finish" && next));
    $("over-stars").classList.toggle("hidden", !(this.mode === "levels" && this.endReason === "finish"));
    $("over-standings").classList.toggle("hidden", this.mode !== "race");
    if (this.mode === "levels" && this.endReason === "finish") {
      $("over-stars").textContent = "★".repeat(this.levelStars) + "☆".repeat(3 - this.levelStars);
    }
    if (trial && this.endReason === "finish") {
      $("over-dist").textContent = formatTime(this.trialTime);
      $("over-unit").textContent = "";
      $("over-best-label").textContent = "Best time";
      $("over-best").textContent = formatTime(record ? this.trialTime : prevTime);
      $("over-new").classList.toggle("hidden", !record);
      $("over-new").textContent = prevTime && record ? `−${(prevTime - this.trialTime).toFixed(2)}s` : "New best!";
      if (this.mode === "levels" && this.levelReward > 0) {
        $("over-new").classList.remove("hidden");
        $("over-new").textContent = `+${this.levelReward} coins reward`;
      }
    } else if (trial) {
      $("over-dist").textContent = String(this.distance);
      $("over-unit").textContent = `/ ${this.courseLength} m`;
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
    if (this.mode === "race") this.showRaceResults();
    $("over-coins").textContent = String(this.coinsRun);
    if (this.boardRank !== null && this.mode === "endless") {
      $("over-new").classList.remove("hidden");
      $("over-new").textContent = `🏅 #${this.boardRank} on the leaderboard!`;
    }
    const who = this.username || "driver";
    $("over-greet").textContent =
      this.endReason === "finish"
        ? `Great driving, ${who}!`
        : this.endReason === "fuel"
          ? `Out of gas, ${who} — grab more fuel cans next time.`
          : this.endReason === "stopped"
            ? `See you on the road, ${who}.`
            : `Unlucky, ${who}! Try again?`;
    this.setPanels(false, true, false, true);
  }

  private showRaceResults(): void {
    const ord = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
    const n = this.raceStandings.length;
    const won = this.racePlace === 1;
    if (this.endReason === "finish") {
      $("over-title").textContent = won ? "🏆 You Won!" : `${this.racePlace <= 3 ? medal(this.racePlace) : "🏁"} ${ord(this.racePlace)} Place`;
      $("over-dist").textContent = ord(this.racePlace);
      $("over-unit").textContent = `of ${n}`;
      $("over-best-label").textContent = "Your time";
      $("over-best").textContent = formatTime(this.trialTime);
      $("over-new").classList.toggle("hidden", this.racePrize <= 0);
      $("over-new").textContent = `+${this.racePrize} coins prize`;
      $("over-greet").textContent = won ? `Brilliant race, ${this.username || "driver"}!` : `Good race! Beat ${this.raceStandings[0].name} next time.`;
    } else {
      $("over-dist").textContent = "DNF";
      $("over-unit").textContent = `${Math.min(this.courseLength, this.distance)} / ${this.courseLength} m`;
      $("over-best-label").textContent = "Race";
      $("over-best").textContent = `${this.raceSkill.name} · ${n - 1} rival${n > 2 ? "s" : ""}`;
    }
    const list = $("over-standings");
    list.replaceChildren();
    this.raceStandings.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = r.you ? "you" : "";
      const time = r.time === null ? "DNF" : formatTime(r.time);
      li.textContent = `${i < 3 && r.time !== null ? medal(i + 1) : `${i + 1}.`} ${r.name}${r.you ? " (you)" : ""} · ${r.vehicle} · ${time}`;
      list.appendChild(li);
    });
  }

  /** Your place right now: 1 + rivals who finished or are further along. */
  private racePosition(): number {
    const x = this.car.chassis.getPosition().x;
    return 1 + this.rivals.filter((r) => r.finishTime !== null || r.x > x).length;
  }

  // ---------- simulation ----------

  private step(): void {
    const playing = this.state === "playing";
    const hasFuel = this.fuel > 0;
    // Race start: everyone waits on the line until the lights go green.
    const racing = playing && this.countdown <= 0;
    if (playing && this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= STEP;
      if (Math.ceil(this.countdown) !== before) this.sound.countdown(this.countdown <= 0);
      if (this.countdown <= 0) this.toast("🏁 GO!");
    }
    if (racing) this.car.drive(this.input.gas, this.input.brake, hasFuel);
    else if (playing) this.car.drive(false, false, hasFuel);
    else this.car.cutEngine();
    for (const r of this.rivals) r.drive(this.terrain, this.scene.time, STEP, racing, this.car.chassis.getPosition().x);

    // Sky road: engines follow the thinning gravity, and booster strips stop cars stalling
    if (this.map.skyroad) {
      this.skyroadAssist(this.car);
      for (const r of this.rivals) this.skyroadAssist(r.car);
    }
    // Journey terrains: gravity weakens as you climb toward space
    if (this.map.stages) {
      const g = gravityAt(this.map, this.car.chassis.getPosition().x);
      if (Math.abs(this.world.getGravity().y + g) > 0.01) this.world.setGravity(new Vec2(0, -g));
    }
    // Extra solver passes keep the bed's floor and walls firm under the egg
    this.world.step(STEP, 10, 6);
    // Never let the egg glitch through the car (yours, or a rival's)
    if (!this.scene.eggBroken) this.car.keepEggInside();
    for (const r of this.rivals) if (!r.eggBroken) r.car.keepEggInside();
    this.scene.time += STEP;
    if (this.scene.dayTime !== null) this.scene.dayTime = (this.scene.dayTime + STEP / DAY_LENGTH) % 1;

    if (this.crackPending && playing && !this.scene.eggBroken) {
      if (this.eggProtected()) this.crackPending = false;
      else this.eggHit();
    } else this.crackPending = false;

    const cp = this.car.chassis.getPosition();
    const cam = this.scene.camera;
    // Keep the road built under every rival too, leaders and stragglers.
    let front = cp.x;
    let back = cam.x - this.renderer.width / 2 / cam.scale;
    for (const r of this.rivals) {
      front = Math.max(front, r.x);
      back = Math.min(back, r.x - 15);
    }
    this.terrain.update(front, back);
    if (racing && this.terrain.finishX !== null) {
      for (const r of this.rivals) {
        if (r.finishTime !== null || r.x < this.terrain.finishX) continue;
        r.finishTime = this.trialTime;
        if (this.rivals.filter((o) => o.finishTime !== null).length === 1) this.toast(`🏁 ${r.name} crossed the line first!`);
      }
    }

    // Storm clouds: a car under a lightning strike gets jolted into the air
    if (this.map.skyObstacles) {
      for (const o of this.terrain.obstacles) {
        if (o.kind !== "storm" || Math.abs(o.x - cp.x) > 40) continue;
        const phase = stormPhase(o, this.scene.time);
        const cycle = stormCycle(o, this.scene.time);
        if (phase === "warn" && this.zapped.get(o) !== cycle - 0.5 && Math.abs(o.x - cp.x) < 25) {
          this.zapped.set(o, cycle - 0.5);
          this.sound.thunder(Math.abs(o.x - cp.x));
        }
        if (phase !== "strike" || this.zapped.get(o) === cycle) continue;
        const near = Math.abs(cp.x - o.x) < STORM.reach && cp.y - this.terrain.height(cp.x) < 8;
        if (!near) continue;
        this.zapped.set(o, cycle);
        if (!playing) continue;
        const c = this.car.chassis;
        const m = c.getMass();
        c.applyLinearImpulse(new Vec2(-Math.sign(o.x - cp.x || 1) * m * 1.5, m * 5.5), c.getWorldCenter(), true);
        c.applyAngularImpulse(c.getInertia() * (Math.random() < 0.5 ? -1.2 : 1.2), true);
        this.scene.shake = Math.max(this.scene.shake, 10);
        this.burst(cp, ["#fff7a8", "#ffffff", "#9fd8ff"], 18);
        this.sound.zap();
        this.toast("⚡ Zapped by lightning!");
      }
    }

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

      this.updateNavAlerts(cp.x);

      // Fuel
      if (this.gameplay.fuel) this.fuel = Math.max(0, this.fuel - STEP * (0.05 + 0.95 * this.car.load));
      if (hasFuel && this.fuel === 0) this.toast("⛽ Out of fuel!");
      if (this.fuel === 0) {
        const still = Math.hypot(this.car.chassis.getLinearVelocity().x, this.car.chassis.getLinearVelocity().y) < 0.5;
        this.noFuelTimer = still ? this.noFuelTimer + STEP : 0;
        if (this.noFuelTimer > 2) {
          this.endRun("fuel");
          return;
        }
      }

      // Time trial and levels
      if (this.onCourse) {
        if (racing) this.trialTime += STEP;
        if (Math.round(this.scene.time * 60) % (60 / GHOST_HZ) === 0) this.recording.push(cp.x, cp.y, this.car.chassis.getAngle());
        if (this.terrain.finishX !== null && cp.x >= this.terrain.finishX && !this.scene.eggBroken) {
          this.finishTrial();
          return;
        }
      }

      this.autosaveTimer -= STEP;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = 5;
        this.checkpoint();
      }
      {
        const v = this.car.chassis.getLinearVelocity();
        this.flipStillTimer = Math.hypot(v.x, v.y) < 1 ? this.flipStillTimer + STEP : 0;
      }
      // Never stuck in the ground: pop back up if a wheel or the body went through it…
      const h = (x: number) => this.terrain.height(x);
      this.car.unsink(h);
      // …and if you're giving it gas but going nowhere (wedged, spinning in place), get set back on the road.
      if (racing && this.input.gas && hasFuel && !this.scene.eggBroken) {
        this.stuckTimer += STEP;
        if (this.stuckTimer > 2.5) {
          if (Math.abs(cp.x - this.stuckX) < 0.6) {
            this.car.unstick(h);
            this.toast("🛟 Unstuck!");
          }
          this.stuckTimer = 0;
          this.stuckX = this.car.chassis.getPosition().x;
        }
      } else {
        this.stuckTimer = 0;
        this.stuckX = cp.x;
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
        if (pu.kind === "glue") {
          this.activateGlue();
          this.stats.glueBottles++;
          this.checkAchievements();
        }
        else if (pu.kind === "fuel") {
          this.fuel = this.fuelMax;
          this.sound.fuel();
          this.stats.fuelCans++;
          this.checkAchievements();
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
        this.earn(c.value * this.difficulty.coinValue);
        if (big) {
          this.sound.bigCoin();
          this.stats.bigCoins++;
          this.checkAchievements();
          this.toast(`💰 +${c.value * this.difficulty.coinValue}`);
        } else this.sound.coin();
      }
      this.spawnDust();
      if (!this.car.onGround) this.airTime += STEP;
      else {
        // Hard landing: the camera takes a jolt, bigger after a longer jump.
        if (this.airTime > 0.6) this.scene.shake = Math.max(this.scene.shake, Math.min(9, this.airTime * 5));
        if (this.airTime > this.stats.bestAir) this.stats.bestAir = this.airTime;
        this.airTime = 0;
      }
      this.achCheckTimer -= STEP;
      if (this.achCheckTimer <= 0) {
        this.achCheckTimer = 0.5;
        this.trackBests();
        this.checkAchievements();
      }
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

  /**
   * 3D sound: the camera is the listener, your engine sits in your car's engine bay, and rivals'
   * engines follow their cars. In the 3D views the listener is the real 3D camera; in Classic 2D
   * it hovers in front of the scene like the 2D camera, so sounds pan left and right on screen.
   */
  private updateSpatialAudio(dt: number): void {
    const cp = this.car.chassis.getPosition();
    let pose = this.use3d && this.renderer3d ? this.renderer3d.listenerPose() : null;
    if (!pose) {
      const cam = this.scene.camera;
      pose = { x: cam.x, y: cam.y, z: 14, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
    }
    this.sound.setListener(pose, dt);
    const engine = this.car.chassis.getWorldPoint({ x: this.car.def.headlight.x * 0.6, y: 0.2 });
    this.sound.setEnginePosition(engine.x, engine.y, 0);
    if (this.rivals.length) {
      this.sound.updateRivals(
        this.rivals.map((r) => {
          const p = r.car.chassis.getPosition();
          const v = r.car.chassis.getLinearVelocity();
          return { x: p.x, y: p.y, vx: v.x, vy: v.y, speed: r.car.wheelSpeed, load: r.car.load, idle: r.crashed || r.finishTime !== null };
        }),
        Math.sqrt(this.map.gravity / 10),
      );
    }
  }

  /**
   * Space Launch sky road. Gravity thins as you climb, so the car's power and grip scale with it
   * (like the low-gravity terrains), and booster strips on the climb carry any car that slows
   * below a minimum speed, so nothing stalls or rolls back down the steep road.
   */
  private skyroadAssist(car: Car): void {
    const sr = this.map.skyroad!;
    const p = car.chassis.getPosition();
    car.setGravity(gravityAt(this.map, p.x));
    const slope = skyroadSlope(sr, p.x);
    if (slope < 0.05 || !car.onGround) return;
    const len = Math.hypot(1, slope);
    const tx = 1 / len;
    const ty = slope / len;
    const v = car.chassis.getLinearVelocity();
    const along = v.x * tx + v.y * ty;
    const MIN = 8;
    if (along >= MIN) return;
    const dv = (MIN - along) * Math.min(1, STEP * 3);
    for (const b of [car.chassis, ...car.wheels, car.egg]) {
      const bv = b.getLinearVelocity();
      b.setLinearVelocity(new Vec2(bv.x + dv * tx, bv.y + dv * ty));
    }
  }

  /** Bodies drawn with smoothing: your car and every rival (chassis, wheels, egg). */
  private smoothBodies(): Body[] {
    const out: Body[] = [this.car.chassis, ...this.car.wheels, this.car.egg];
    for (const r of this.rivals) out.push(r.car.chassis, ...r.car.wheels, r.car.egg);
    return out;
  }

  private snapshotPoses(): void {
    for (const b of this.smoothBodies()) {
      const p = b.getPosition();
      this.prevPose.set(b, { x: p.x, y: p.y, a: b.getAngle() });
    }
  }

  /** Moves bodies to where they'd be `alpha` of the way between the last two physics steps (for drawing only). */
  private blendPoses(alpha: number): void {
    this.shownPose.clear();
    for (const b of this.smoothBodies()) {
      const prev = this.prevPose.get(b);
      if (!prev) continue;
      const p = b.getPosition();
      const a = b.getAngle();
      // A big jump means a teleport (flip, respawn): don't smear it.
      if (Math.abs(p.x - prev.x) > 3 || Math.abs(p.y - prev.y) > 3 || Math.abs(a - prev.a) > 1) continue;
      const x = prev.x + (p.x - prev.x) * alpha;
      const y = prev.y + (p.y - prev.y) * alpha;
      const ang = prev.a + (a - prev.a) * alpha;
      this.shownPose.set(b, { trueX: p.x, trueY: p.y, trueA: a, x, y, a: ang });
      b.setTransform(new Vec2(x, y), ang);
    }
  }

  /** Puts bodies back at their true physics positions, unless something moved them meanwhile (e.g. a flip). */
  private restorePoses(): void {
    for (const [b, s] of this.shownPose) {
      const p = b.getPosition();
      if (Math.abs(p.x - s.x) > 1e-6 || Math.abs(p.y - s.y) > 1e-6 || Math.abs(b.getAngle() - s.a) > 1e-6) continue;
      b.setTransform(new Vec2(s.trueX, s.trueY), s.trueA);
    }
    this.shownPose.clear();
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
    $("btn-flip").addEventListener("click", () => this.flipOver());
    $("flip-prompt").addEventListener("click", () => this.flipOver());
    $("btn-nav").addEventListener("click", () => this.toggleNav());
    this.syncNavButton();
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

  // ---------- navigation ----------

  private toggleNav(): void {
    this.navOn = !this.navOn;
    store.set("nav", this.navOn ? "on" : "off");
    this.scene.navMap = this.navOn;
    this.syncNavButton();
    if (!this.navOn) $("nav-alert").classList.add("hidden");
    this.toast(this.navOn ? "🧭 Navigation on" : "🧭 Navigation off");
  }

  private syncNavButton(): void {
    $("btn-nav").classList.toggle("off", !this.navOn);
    $("btn-nav").setAttribute("aria-pressed", String(this.navOn));
  }

  /** Announces the next hazard or pickup once, when it comes within range. */
  private updateNavAlerts(x: number): void {
    if (!this.navOn) return;
    const RANGE = 80;
    const t = this.terrain;
    const fuelFrac = this.fuel / this.fuelMax;
    type Alert = { key: string; at: number; text: (d: number) => string; urgent?: boolean };
    const alerts: Alert[] = [];
    for (const f of t.features) {
      if (f.kind === "ramp") {
        const start = f.x - 7;
        alerts.push({
          key: `ramp${f.x}`,
          at: start,
          text: (d) => (this.gameplay.glue ? `⤴️ Jump ramp in ${d} m — speed up to grab the glue!` : `⤴️ Jump ramp in ${d} m`),
        });
      } else {
        alerts.push({ key: `fork${f.x}`, at: f.x, text: (d) => `⑂ Fork in ${d} m — hold gas for the bridge, let go for the safe road` });
      }
    }
    for (const pu of t.powerUps) {
      if (pu.taken) continue;
      if (pu.kind === "fuel" && this.gameplay.fuel && fuelFrac < 0.6) {
        const low = fuelFrac < 0.25;
        alerts.push({ key: `fuel${pu.x}`, at: pu.x, urgent: low, text: (d) => (low ? `⛽ Low fuel! Fuel can in ${d} m` : `⛽ Fuel can in ${d} m`) });
      } else if (pu.kind === "life") {
        alerts.push({ key: `life${pu.x}`, at: pu.x, text: (d) => `❤️ Extra life ahead in ${d} m` });
      }
    }
    if (t.finishX !== null) alerts.push({ key: "finish", at: t.finishX, text: (d) => `🏁 Finish in ${d} m — keep it steady!` });

    let next: Alert | null = null;
    for (const a of alerts) {
      const d = a.at - x;
      const range = a.key === "finish" ? 100 : RANGE;
      if (d <= 5 || d > range || this.navAnnounced.has(a.key)) continue;
      if (!next || a.at < next.at) next = a;
    }
    if (!next) return;
    this.navAnnounced.add(next.key);
    const el = $("nav-alert");
    el.textContent = next.text(Math.round((next.at - x) / 5) * 5);
    el.classList.toggle("urgent", !!next.urgent);
    el.classList.remove("hidden", "fade");
    this.sound.navChime();
    if (this.navAlertTimer !== null) window.clearTimeout(this.navAlertTimer);
    this.navAlertTimer = window.setTimeout(() => el.classList.add("fade"), 2800);
  }

  private toast(text: string): void {
    const el = $("toast");
    el.textContent = text;
    el.classList.remove("hidden", "fade");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.add("fade"), 1300);
  }

  /** How settled the egg is, for the dashboard lamp: lifted or moving fast relative to the bed is trouble. */
  private eggStatus(): EggStatus {
    if (this.scene.eggBroken) return "gone";
    if (this.scene.glue > 0) return "glued";
    const chassis = this.car.chassis;
    const egg = this.car.egg;
    const local = chassis.getLocalPoint(egg.getPosition());
    const lift = local.y - this.car.def.egg.y;
    const ev = egg.getLinearVelocity();
    const cv = chassis.getLinearVelocityFromWorldPoint(egg.getPosition());
    const rel = Math.hypot(ev.x - cv.x, ev.y - cv.y);
    if (lift > 0.3 || rel > 3.5) return "danger";
    if (lift > 0.08 || rel > 1.2) return "slip";
    return "ok";
  }

  /** Truck pitch, the ground slope beneath it, and whether it's airborne (for the gyro). */
  private attitude(): { pitch: number; slope: number; airborne: boolean } {
    const chassis = this.car.chassis;
    const x = chassis.getPosition().x;
    const slope = Math.atan((this.terrain.height(x + 1) - this.terrain.height(x - 1)) / 2);
    // Keep the angle in -π..π so a full flip doesn't read as 360°
    let pitch = chassis.getAngle() % (Math.PI * 2);
    if (pitch > Math.PI) pitch -= Math.PI * 2;
    if (pitch < -Math.PI) pitch += Math.PI * 2;
    return { pitch, slope, airborne: !this.car.onGround };
  }

  /** Distance or time, plus best, for the dashboard screen header. */
  /** Distance traveled for the sat-nav's info bar, with your best (Endless) or the finish (courses). */
  private dashTrip(): { trip: number; best: number; goal: number | null; time: string | null } {
    if (this.onCourse) return { trip: Math.min(this.courseLength, this.distance), best: 0, goal: this.courseLength, time: formatTime(this.trialTime) };
    return { trip: this.distance, best: this.best, goal: null, time: null };
  }

  private dashReadout(): string {
    if (this.onCourse) {
      const bt = store.get(this.trialKey());
      return `${formatTime(this.trialTime)} · ${Math.min(this.courseLength, this.distance)}/${this.courseLength} m${bt ? ` · best ${formatTime(bt)}` : ""}`;
    }
    return `${this.distance} m${this.best ? ` · best ${this.best} m` : ""}`;
  }

  // ---------- HUD ----------

  private updateHUD(): void {
    const glue = Math.ceil(this.scene.glue);
    const trial = this.onCourse;
    const cx = this.car.chassis.getPosition().x;
    const t = trial ? Math.floor(this.trialTime * 100) : 0;
    const race = this.mode === "race";
    const order = race ? this.raceOrder() : "";
    const clock = this.scene.dayTime === null ? "" : `${clockIcon(this.scene.dayTime)} ${clockText(this.scene.dayTime)}`;
    const key = `${this.distance}|${this.best}|${this.coinsRun}|${glue}|${t}|${this.lives}|${this.armorLeft}|${this.state}|${order}|${Math.ceil(this.countdown)}|${clock}`;
    if (key === this.hudCache) return;
    this.hudCache = key;

    $("hud-glue").classList.toggle("hidden", glue === 0);
    $("hud-glue").classList.toggle("ending", glue > 0 && glue <= 3);
    $("hud-glue-time").textContent = `${glue}s`;
    $("hud-lives").textContent = `❤️ ${this.lives}${this.armorLeft ? `  🛡️ ${this.armorLeft}` : ""}`;
    $("hud-lives").classList.toggle("hidden", !this.gameplay.lives);
    $("hud-coins").textContent = String(this.totalCoins);
    $("hud-name").textContent = `👤 ${this.username || "Driver"}`;
    $("hud-clock").textContent = clock;
    $("hud-clock").classList.toggle("hidden", !clock);

    const fill = $("hud-prog");
    const mark = $("hud-mark");
    if (trial) {
      const len = this.courseLength;
      $("hud-main").textContent = formatTime(this.trialTime);
      $("hud-unit").textContent = "";
      const bt = store.get(this.trialKey());
      const gt = this.ghostTimeAt(cx);
      const delta = gt !== null ? this.trialTime - gt : null;
      const deltaEl = $("hud-delta");
      deltaEl.textContent = delta === null ? "" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}s`;
      deltaEl.className = delta === null ? "" : delta > 0 ? "behind" : "ahead";
      $("hud-sub").textContent = bt ? `BEST ${formatTime(bt)}` : "NO TIME YET";
      if (race) this.updateRaceHud(cx, len);
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

  /** Running order (for the HUD cache key): rival indexes and you ("Y"), leader first. */
  private raceOrder(): string {
    const x = this.car.chassis.getPosition().x;
    const items = [...this.rivals.map((r) => ({ id: String(r.index), x: r.finishTime !== null ? 1e9 - r.finishTime : r.x, c: r.crashed })), { id: "Y", x, c: false }];
    items.sort((a, b) => b.x - a.x);
    return items.map((i) => i.id + (i.c ? "!" : "")).join(",");
  }

  private updateRaceHud(cx: number, len: number): void {
    const pos = this.racePosition();
    const n = this.rivals.length + 1;
    $("hud-sub").textContent = `POSITION ${pos} / ${n}`;
    // Gap to the car just ahead (or your lead over second place)
    const ahead = this.rivals.filter((r) => r.finishTime === null && r.x > cx).sort((a, b) => a.x - b.x)[0];
    const behind = this.rivals.filter((r) => r.x <= cx).sort((a, b) => b.x - a.x)[0];
    const deltaEl = $("hud-delta");
    if (this.countdown > 0) {
      deltaEl.textContent = "";
    } else if (ahead) {
      deltaEl.textContent = `${ahead.name} +${Math.round(ahead.x - cx)}m`;
      deltaEl.className = "behind";
    } else if (pos === 1 && behind) {
      deltaEl.textContent = `lead ${Math.round(cx - behind.x)}m`;
      deltaEl.className = "ahead";
    } else deltaEl.textContent = "";
    // Progress bar marker: the leading rival
    const lead = this.rivals.reduce<Rival | null>((m, r) => (!m || r.x > m.x ? r : m), null);
    const mark = $("hud-mark");
    mark.classList.toggle("hidden", !lead);
    if (lead) mark.style.left = `${Math.min(100, (Math.max(0, lead.x) / len) * 100)}%`;
    // Standings list
    const x = cx;
    const rows = [...this.rivals.map((r) => ({ name: r.name, x: r.finishTime !== null ? 1e9 - r.finishTime : r.x, you: false, crashed: r.crashed, done: r.finishTime !== null })), { name: this.username || "You", x, you: true, crashed: false, done: false }];
    rows.sort((a, b) => b.x - a.x);
    const board = $("hud-race");
    board.replaceChildren();
    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = r.you ? "you" : "";
      row.textContent = `${i + 1}. ${r.name}${r.done ? " 🏁" : r.crashed ? " 💥" : ""}`;
      board.appendChild(row);
    });
    const big = $("race-count");
    big.classList.toggle("hidden", this.countdown <= 0 || this.state !== "playing");
    big.textContent = String(Math.ceil(this.countdown));
  }

  // ---------- frame ----------

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.state !== "paused") {
      // Slow motion after a smash eases back to normal speed.
      this.timeScale = Math.min(1, this.timeScale + dt * 0.6);
      this.acc += dt * this.timeScale;
      this.restorePoses();
      while (this.acc >= STEP) {
        this.snapshotPoses();
        this.step();
        this.acc -= STEP;
      }
      this.blendPoses(this.acc / STEP);
      this.updateCamera(dt);
      if (this.scene.smash !== null) this.scene.smash += dt;
      this.scene.shake = Math.max(0, this.scene.shake - dt * 30);
    }

    const v = this.car.chassis.getLinearVelocity();
    const running = (this.state === "playing" || this.state === "paused") && this.fuel > 0;
    this.sound.setRain(this.state === "playing" ? this.rain : 0);
    this.music.tick();
    this.updateSpatialAudio(dt);
    // Sound health check during play: restart paused audio, repair a broken mix
    this.soundCheckTimer -= dt;
    if (this.soundCheckTimer <= 0 && this.state === "playing") {
      this.soundCheckTimer = 0.5;
      const h = this.sound.checkHealth();
      if (h === "repaired") {
        // The advanced audio broke the mix on this device: fall back to Simple sound for good
        this.setSound({ simple: true });
        this.toast("🔊 Sound restored (switched to Simple sound)");
      }
      if (h === "suspended" && !this.soundSettings.muted && performance.now() - this.lastSoundHint > 8000) {
        this.lastSoundHint = performance.now();
        this.toast("🔊 Sound paused by the browser — click or tap to turn it back on");
      }
    }
    if (this.state !== "paused") {
      this.sound.engine(dt, {
        running,
        speed: this.car.wheelSpeed,
        load: this.state === "playing" ? this.car.load : 0,
        onGround: this.car.onGround,
        braking: this.state === "playing" && this.car.braking,
        speedScale: Math.sqrt(this.map.gravity / 10),
        surface: this.map.id,
        cabin: this.cameraMode.cockpit,
        rocket: this.state === "playing" ? this.car.rocketOn : 0,
      });
    }
    const kmh = Math.hypot(v.x, v.y) * 3.6;
    const fuelFrac = this.gameplay.fuel ? this.fuel / this.fuelMax : -1;
    const attitude = this.attitude();
    this.scene.gauges = { kmh, rpm: this.sound.displayRpm, gear: this.sound.gear, fuel: fuelFrac, mph: this.mph, redline: this.sound.redline, attitude };
    const pose = this.ghostPose();
    if (this.scene.ghost) this.scene.ghost.pose = pose;
    this.scene.dash = { glue: this.scene.glue, fuel: fuelFrac, rpm: this.sound.displayRpm, gear: this.sound.gear, ghostX: pose?.x ?? null, mph: this.mph, egg: this.eggStatus(), readout: this.dashReadout(), attitude, ...this.dashTrip() };
    // In the driver's seat the score lives on the dashboard, so the floating panel steps aside.
    document.body.classList.toggle("cockpit-view", !!this.scene.cockpit);

    if (this.state !== "menu" && this.state !== "garage") this.updateHUD();
    const flip = this.canFlip();
    $("btn-flip").classList.toggle("ready", flip);
    $("flip-prompt").classList.toggle("hidden", !(flip && this.car.tipped > 0.6));
    // The showroom covers the whole screen behind the menu and garage: no need to draw the game.
    if (this.showroom?.visible) {
      /* skip */
    } else if (this.use3d && this.renderer3d) {
      this.renderer3d.render(this.scene, this.cameraMode.id);
      this.renderer.drawOverlay(this.scene);
    } else {
      this.renderer.draw(this.scene);
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}

// Player-made cars and terrains join the built-in lists before the game starts.
registerCustom();
new Game();
