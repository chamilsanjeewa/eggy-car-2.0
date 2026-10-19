/**
 * Player-made vehicles and terrains (the Workshop). A design is a small spec saved in local
 * storage; it's turned into a full VehicleDef / MapDef and added to the game's lists at startup,
 * so custom cars and terrains work everywhere the built-in ones do.
 */
import { VEHICLES, VehicleDef, vehicleById } from "./vehicles";
import { MAPS, MapDef, Decor, mapById } from "./maps";
import { setVehicleEngine } from "./engineSound";
import { MAP_TRACK } from "./music";

export interface CarSpec {
  id: string;
  name: string;
  /** Built-in vehicle whose body shape it starts from. */
  base: string;
  /** Body stretch: length and height (0.8..1.25), wheel radius scale (0.8..1.4). */
  length: number;
  height: number;
  wheels: number;
  /** Paint color (#rrggbb). */
  color: string;
  /** 1..5 each. */
  speed: number;
  power: number;
  grip: number;
  comfort: number;
  engine: string;
}

export interface MapSpec {
  id: string;
  name: string;
  /** Built-in terrain whose colors and sky it uses. */
  theme: string;
  /** 1..5 */
  hills: number;
  grip: number;
  gravity: number;
  decor: Decor;
  snow: boolean;
  leaves: boolean;
  night: boolean;
  mist: boolean;
}

export const BODY_STYLES: [string, string][] = [
  ["pickup", "Pickup truck"],
  ["buggy", "Dune buggy"],
  ["racer", "Race car"],
  ["coupe", "Sports coupe"],
  ["van", "Van"],
  ["monster", "Monster truck"],
  ["jeep", "Jeep"],
  ["limo", "Limo"],
  ["rover", "Moon rover"],
  ["tuktuk", "Tuk-tuk"],
];

export const ENGINE_SOUNDS: [string, string][] = [
  ["inline4", "Four-cylinder"],
  ["turbo4", "Turbo four"],
  ["v8", "V8 rumble"],
  ["bigcam", "Hot rod V8"],
  ["inline6", "Straight six"],
  ["diesel", "Diesel"],
  ["race", "Race six"],
  ["v10", "Screaming V10"],
  ["flat4", "Flat four"],
  ["twin", "Twin putter"],
  ["electric", "Electric whine"],
];

export const THEMES: [string, string][] = [
  ["countryside", "Green hills"],
  ["desert", "Desert"],
  ["snow", "Snowy peaks"],
  ["autumn", "Autumn"],
  ["beach", "Sunset beach"],
  ["canyon", "Red canyon"],
  ["jungle", "Jungle"],
  ["sakura", "Cherry blossom"],
  ["candy", "Candy land"],
  ["mars", "Red planet"],
  ["moon", "Moon"],
  ["glacier", "Ice"],
  ["neon", "Neon night"],
  ["outback", "Outback"],
];

export const DECORS: [Decor, string][] = [
  ["tree", "Trees"],
  ["pine", "Pine trees"],
  ["palm", "Palm trees"],
  ["maple", "Maples"],
  ["sakura", "Blossom trees"],
  ["acacia", "Acacias"],
  ["cactus", "Cacti"],
  ["rock", "Rocks"],
  ["crystal", "Crystals"],
  ["lollipop", "Lollipops"],
  ["deadtree", "Spooky trees"],
  ["coral", "Coral"],
  ["robot", "Robot arms"],
  ["lamp", "Street lamps"],
];

export const GRAVITIES: [number, string][] = [
  [1.6, "Moon (very floaty)"],
  [3.7, "Mars (floaty)"],
  [6.5, "Light"],
  [10, "Earth"],
  [14, "Heavy"],
];

export const DEFAULT_CAR: Omit<CarSpec, "id"> = { name: "My Car", base: "pickup", length: 1, height: 1, wheels: 1, color: "#2f7ae5", speed: 3, power: 3, grip: 3, comfort: 3, engine: "v8" };
export const DEFAULT_MAP: Omit<MapSpec, "id"> = { name: "My World", theme: "countryside", hills: 3, grip: 4, gravity: 10, decor: "tree", snow: false, leaves: false, night: false, mist: false };

/** Coins to build a car: more performance costs more. */
export function carPrice(s: Pick<CarSpec, "speed" | "power" | "grip" | "comfort">): number {
  const points = s.speed + s.power + s.grip + s.comfort - 4; // 0..16
  return 150 + points * points * 12 + points * 60;
}
export const MAP_PRICE = 300;

// ---------- spec → definitions ----------

const hexToHsl = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
};
const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;

/** Recolors a body color toward the chosen paint, keeping each part's relative shade. */
function paint(color: string, target: string): string {
  if (!color.startsWith("#") || color.length !== 7 || color.toLowerCase() === "#bfe8f7") return color;
  const [, s, l] = hexToHsl(color);
  if (s < 30 || l < 15 || l > 90) return color; // greys, tyres, chrome, liners
  const [th, ts, tl] = hexToHsl(target);
  return hsl(th, Math.max(40, ts), Math.max(10, Math.min(92, tl + (l - 50) * 0.4)));
}

export function buildCarDef(spec: CarSpec): VehicleDef {
  const base = vehicleById(spec.base);
  const L = spec.length;
  const H = spec.height;
  const W = spec.wheels;
  const P = (p: { x: number; y: number }) => ({ x: p.x * L, y: p.y >= 0 ? p.y * H : p.y });
  const EGG_BOTTOM = 0.42;
  const wheels = base.wheels.map((w) => ({ x: w.x * L, y: w.y - (w.r * W - w.r) * 0.3, r: w.r * W })) as VehicleDef["wheels"];
  const roadTop = 12 + spec.speed * 5; // m/s
  return {
    ...base,
    id: spec.id,
    name: spec.name || "Custom car",
    price: 0,
    blurb: `Your own build: ${BODY_STYLES.find((b) => b[0] === spec.base)?.[1] ?? "custom"} body, ${ENGINE_SOUNDS.find((e) => e[0] === spec.engine)?.[1] ?? "engine"}.`,
    stats: { speed: spec.speed, power: spec.power, stability: Math.round((spec.grip + spec.comfort) / 2) },
    maxSpeed: roadTop / wheels[1].r,
    torque: 14 + spec.power * 6,
    brake: Math.min(11.5, 6 + spec.grip * 0.9),
    wheelFriction: 1.2 + spec.grip * 0.2,
    suspension: { hz: 5 - spec.comfort * 0.4, damping: Math.min(0.95, 0.58 + spec.comfort * 0.07) },
    wheels,
    extraWheels: base.extraWheels?.map((w) => ({ x: w.x * L, y: w.y - (w.r * W - w.r) * 0.3, r: w.r * W })),
    parts: base.parts.map((p) => ({ ...p, pts: p.pts.map(P) as typeof p.pts, fill: paint(p.fill, spec.color) })),
    lines: base.lines?.map((l) => ({ ...l, pts: l.pts.map(P) as typeof l.pts, color: paint(l.color, spec.color) })),
    egg: { x: base.egg.x * L, y: (base.egg.y - EGG_BOTTOM) * H + EGG_BOTTOM },
    driver: { ...base.driver, x: base.driver.x * L, y: base.driver.y * H },
    headlight: { x: base.headlight.x * L, y: base.headlight.y * H },
    taillight: { x: base.taillight.x * L, y: base.taillight.y * H },
    rocket: undefined,
    downforce: undefined,
    gyro: undefined,
  };
}

export function buildMapDef(spec: MapSpec): MapDef {
  const theme = mapById(spec.theme);
  const k = 0.35 + (spec.hills - 1) * 0.3; // 0.35 .. 1.55
  const s = theme.shape;
  const night = spec.night;
  return {
    ...theme,
    id: spec.id,
    name: spec.name || "Custom world",
    price: 0,
    blurb: `Your own world: ${THEMES.find((t) => t[0] === spec.theme)?.[1] ?? "custom"} with ${DECORS.find((d) => d[0] === spec.decor)?.[1].toLowerCase() ?? "scenery"}.`,
    stats: { hills: spec.hills, grip: spec.grip },
    tag: GRAVITIES.find((g) => g[0] === spec.gravity)?.[1].split(" ")[0] + " gravity",
    gravity: spec.gravity,
    groundFriction: 0.45 + spec.grip * 0.12,
    shape: { ...s, ampA: s.ampA * k, ampB: s.ampB * k, ampC: s.ampC * k },
    decor: spec.decor,
    decorColors: spec.decor === theme.decor ? theme.decorColors : DECOR_COLORS[spec.decor] ?? theme.decorColors,
    snow: spec.snow,
    leaves: spec.leaves,
    mist: spec.mist,
    stars: night || theme.stars,
    sky: night && !theme.stars ? ["#060914", "#141b3a", "#2c3a66"] : theme.sky,
    clouds: night ? null : theme.clouds,
    // Special mechanics of the theme terrain are left out of custom worlds
    forks: undefined,
    conveyor: undefined,
    indoor: undefined,
    stages: undefined,
    skyroad: undefined,
    climb: undefined,
  };
}

const DECOR_COLORS: Partial<Record<Decor, [string, string]>> = {
  tree: ["#6b4423", "#4caf3f"],
  pine: ["#4a3520", "#2f5d34"],
  palm: ["#8a5a2b", "#3f9b3a"],
  maple: ["#5a3a20", "#e2683d"],
  sakura: ["#5a3a2a", "#ffb7d0"],
  acacia: ["#5a3a20", "#8a9a3a"],
  cactus: ["#3f8a3a", "#f2c230"],
  rock: ["#7a7068", "#9a8f86"],
  crystal: ["#7ec8ec", "#e6f7ff"],
  lollipop: ["#ffffff", "#ff6fae"],
  deadtree: ["#2a2030", "#8a8a96"],
  coral: ["#ff7a8a", "#ffb347"],
  robot: ["#f2b705", "#2b2d33"],
  lamp: ["#3a3d46", "#ffe2a8"],
};

// ---------- storage & registration ----------

const CAR_KEY = "eggrally.customCars";
const MAP_KEY = "eggrally.customMaps";

const read = <T>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full */
  }
};

export const customCars = (): CarSpec[] => read<CarSpec>(CAR_KEY);
export const customMaps = (): MapSpec[] => read<MapSpec>(MAP_KEY);

function addCar(spec: CarSpec): void {
  const i = VEHICLES.findIndex((v) => v.id === spec.id);
  const def = buildCarDef(spec);
  if (i >= 0) VEHICLES[i] = def;
  else VEHICLES.push(def);
  setVehicleEngine(spec.id, spec.engine);
}

function addMap(spec: MapSpec): void {
  const i = MAPS.findIndex((m) => m.id === spec.id);
  const def = buildMapDef(spec);
  if (i >= 0) MAPS[i] = def;
  else MAPS.push(def);
  MAP_TRACK[spec.id] = MAP_TRACK[spec.theme] ?? "sunny";
}

/** Adds every saved custom car and terrain to the game's lists (call once at startup). */
export function registerCustom(): void {
  for (const c of customCars()) addCar(c);
  for (const m of customMaps()) addMap(m);
}

export function saveCar(spec: CarSpec): void {
  const all = customCars().filter((c) => c.id !== spec.id);
  all.push(spec);
  write(CAR_KEY, all);
  addCar(spec);
}

export function saveMap(spec: MapSpec): void {
  const all = customMaps().filter((m) => m.id !== spec.id);
  all.push(spec);
  write(MAP_KEY, all);
  addMap(spec);
}

export function deleteCar(id: string): void {
  write(CAR_KEY, customCars().filter((c) => c.id !== id));
  const i = VEHICLES.findIndex((v) => v.id === id);
  if (i >= 0) VEHICLES.splice(i, 1);
}

export function deleteMap(id: string): void {
  write(MAP_KEY, customMaps().filter((m) => m.id !== id));
  const i = MAPS.findIndex((m) => m.id === id);
  if (i >= 0) MAPS.splice(i, 1);
}

export const newId = (kind: "car" | "map") => `custom-${kind}-${Date.now().toString(36)}`;
