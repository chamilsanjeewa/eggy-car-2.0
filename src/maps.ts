export type Decor = "tree" | "cactus" | "pine" | "rock" | "crystal" | "maple" | "palm" | "mesa" | "jungle" | "lamp" | "reed" | "lollipop" | "spire" | "acacia" | "sakura" | "deadtree" | "coral" | "robot";

export interface MapDef {
  id: string;
  name: string;
  price: number;
  blurb: string;
  /** 1–5 ratings shown in the garage. */
  stats: { hills: number; grip: number };
  /** Short extra label, e.g. "Low gravity". */
  tag?: string;

  gravity: number;
  groundFriction: number;
  /** Hill shape: three noise layers, each with an amplitude multiplier and a wavelength in meters. */
  shape: { ampA: number; waveA: number; ampB: number; waveB: number; ampC: number; waveC: number };

  sky: [string, string, string];
  sun: { color: string; glow: string; radius: number };
  /** Draw the sun as a planet with continents (moon map). */
  planet?: boolean;
  clouds: string | null;
  stars?: boolean;
  snow?: boolean;
  /** Falling autumn leaves. */
  leaves?: boolean;
  /** Colors for the falling leaves (autumn colors by default). */
  leafColors?: string[];
  /** Bubbles rising (underwater). */
  bubbles?: boolean;
  /** Floating dust motes (color), e.g. a red-planet dust storm. */
  dust?: string;
  /** Low drifting mist over the ground. */
  mist?: boolean;
  /** City skyline with lit windows in the background (building color). */
  skyline?: string;
  /** A sea along the horizon (color). */
  sea?: string;
  /**
   * Glue bottles sit on optional bridges over a valley instead of on jump ramps:
   * hold gas at the fork to take the bridge, or let go to take the safe valley road.
   */
  forks?: boolean;
  /** Distant hill layers, far then near. */
  hills: [string, string];

  ground: string;
  bands: [string, string];
  pebble: string;
  /** Top surface strokes: dark outer edge then lighter cap. */
  top: [string, string];
  /** Make the top edge glow (lava). */
  glow?: string;
  decor: Decor;
  decorColors: [string, string];
  /** Rain this run (0..1): set on a wet copy of the terrain made by `wetMap`. */
  wet?: number;
  /** The road is a conveyor belt moving forward at this speed (m/s). */
  conveyor?: number;
  /** Indoors: fixed lighting (no day/night or weather), flat floor beside the road. */
  indoor?: boolean;
  /**
   * A journey terrain: the road climbs, and the look (and gravity) changes along it through these
   * stages, each starting at `at` meters. Use `viewMap(map, x)` for how it looks at a point.
   */
  stages?: { at: number; map: MapDef; gravity: number }[];
  /** Road climb per meter (journey terrains). */
  climb?: number;
  /**
   * A steep road into the sky: from `start` it bends up to a `grade` (rise per meter) climb for
   * `climb` meters, then levels out high above. Booster strips keep cars from stalling on it.
   */
  skyroad?: { start: number; climb: number; grade: number };
  /** Sky terrain: balloons, floating islands and lightning storms (see `SkyObstacle`). */
  skyObstacles?: boolean;
}

export const MAPS: MapDef[] = [
  {
    id: "countryside",
    name: "Countryside",
    price: 0,
    blurb: "Green rolling hills. Where every egg begins.",
    stats: { hills: 3, grip: 4 },
    gravity: 10,
    groundFriction: 0.9,
    shape: { ampA: 1, waveA: 32, ampB: 1, waveB: 13, ampC: 1, waveC: 4.5 },
    sky: ["#5ab4ea", "#b4e2f7", "#e6f6fb"],
    sun: { color: "#fff3a6", glow: "rgba(255, 244, 180, 0.5)", radius: 44 },
    clouds: "rgba(255,255,255,0.9)",
    hills: ["#9fd3a8", "#7bc27f"],
    ground: "#9a6434",
    bands: ["#86542a", "#7a4b25"],
    pebble: "#b77d4a",
    top: ["#3e9a2c", "#62c13f"],
    decor: "tree",
    decorColors: ["#6b4423", "#4caf3f"],
  },
  {
    id: "desert",
    name: "Desert Dunes",
    price: 100,
    blurb: "Long, smooth dunes. Sand is a little slippery.",
    stats: { hills: 2, grip: 3 },
    gravity: 10,
    groundFriction: 0.65,
    shape: { ampA: 1.25, waveA: 48, ampB: 0.55, waveB: 20, ampC: 0.3, waveC: 6 },
    sky: ["#f2a65a", "#f9d29b", "#fdeccd"],
    sun: { color: "#fff0c2", glow: "rgba(255, 226, 150, 0.55)", radius: 60 },
    clouds: "rgba(255,245,230,0.6)",
    hills: ["#e9c08a", "#ddaa6c"],
    ground: "#d9a85f",
    bands: ["#c99550", "#b98445"],
    pebble: "#e8c27f",
    top: ["#c9913e", "#f0cf8a"],
    decor: "cactus",
    decorColors: ["#3f8f4a", "#57b062"],
  },
  {
    id: "snow",
    name: "Snowy Peaks",
    price: 250,
    blurb: "Big icy mountains. Tires struggle for grip.",
    stats: { hills: 4, grip: 1 },
    gravity: 10,
    groundFriction: 0.35,
    shape: { ampA: 1.2, waveA: 34, ampB: 1.1, waveB: 12, ampC: 0.6, waveC: 5 },
    sky: ["#8fb8de", "#d2e4f3", "#f2f7fb"],
    sun: { color: "#fffbe8", glow: "rgba(255, 255, 240, 0.45)", radius: 38 },
    clouds: "rgba(255,255,255,0.85)",
    snow: true,
    hills: ["#c7d8ea", "#a9c2dc"],
    ground: "#e9f1f8",
    bands: ["#d3e1ee", "#bfd2e5"],
    pebble: "#b8c9da",
    top: ["#b9d3ea", "#ffffff"],
    decor: "pine",
    decorColors: ["#5a3d22", "#2f6f4f"],
  },
  {
    id: "moon",
    name: "Moon Base",
    price: 500,
    blurb: "Low gravity! Huge floaty jumps over cratered ground.",
    stats: { hills: 3, grip: 4 },
    tag: "Low gravity",
    gravity: 3.6,
    groundFriction: 0.85,
    shape: { ampA: 1.1, waveA: 30, ampB: 0.8, waveB: 9, ampC: 1.6, waveC: 3.2 },
    sky: ["#05060f", "#111633", "#1f2547"],
    sun: { color: "#4a8fe0", glow: "rgba(90, 150, 230, 0.35)", radius: 40 },
    planet: true,
    clouds: null,
    stars: true,
    hills: ["#3a3d4f", "#545869"],
    ground: "#8d8f99",
    bands: ["#7b7d87", "#6c6e78"],
    pebble: "#a5a7b0",
    top: ["#6f717c", "#c3c5cc"],
    decor: "rock",
    decorColors: ["#6f717c", "#9a9ca5"],
  },
  {
    id: "volcano",
    name: "Volcano",
    price: 800,
    blurb: "Steep, jagged rock beside rivers of lava. For experts.",
    stats: { hills: 5, grip: 4 },
    gravity: 10,
    groundFriction: 0.85,
    shape: { ampA: 1.3, waveA: 28, ampB: 1.25, waveB: 10, ampC: 1.2, waveC: 3.5 },
    sky: ["#2a0d12", "#6b1f1a", "#c2461f"],
    sun: { color: "#ffb347", glow: "rgba(255, 120, 40, 0.4)", radius: 50 },
    clouds: "rgba(60,40,40,0.7)",
    hills: ["#4a1c1c", "#331414"],
    ground: "#2e2526",
    bands: ["#3b2f30", "#4a3a3a"],
    pebble: "#5a4646",
    top: ["#ff5a1f", "#ffb347"],
    glow: "rgba(255, 110, 30, 0.45)",
    decor: "crystal",
    decorColors: ["#ff7a2f", "#ffd27a"],
  },
  {
    id: "autumn",
    name: "Autumn Woods",
    price: 150,
    blurb: "Golden forest trails under drifting leaves. Medium hills, good grip.",
    stats: { hills: 3, grip: 4 },
    gravity: 10,
    groundFriction: 0.85,
    shape: { ampA: 1.05, waveA: 30, ampB: 1.05, waveB: 12, ampC: 0.9, waveC: 4.5 },
    sky: ["#7fa7c9", "#e9c9a0", "#f6e3c8"],
    sun: { color: "#ffe0a3", glow: "rgba(255, 200, 120, 0.45)", radius: 46 },
    clouds: "rgba(255,245,235,0.85)",
    leaves: true,
    hills: ["#c9925a", "#a86a3a"],
    ground: "#7a4e2d",
    bands: ["#6a4226", "#5c3920"],
    pebble: "#93643f",
    top: ["#a8662a", "#d9952f"],
    decor: "maple",
    decorColors: ["#5b3a21", "#e0782a"],
  },
  {
    id: "beach",
    name: "Sunset Beach",
    price: 200,
    blurb: "Soft sand and sea breeze at golden hour. Gentle but slippery.",
    stats: { hills: 2, grip: 2 },
    gravity: 10,
    groundFriction: 0.55,
    shape: { ampA: 0.9, waveA: 40, ampB: 0.6, waveB: 16, ampC: 0.4, waveC: 5 },
    sky: ["#6b4c9a", "#f08a6a", "#ffd39a"],
    sun: { color: "#fff1c4", glow: "rgba(255, 170, 110, 0.55)", radius: 64 },
    clouds: "rgba(255,210,200,0.7)",
    sea: "#3d7fb5",
    hills: ["#d8a07a", "#e9be8c"],
    ground: "#e8c98f",
    bands: ["#dcb878", "#cfa865"],
    pebble: "#f4e1b5",
    top: ["#d2ad6c", "#fbe6b0"],
    decor: "palm",
    decorColors: ["#8a5a32", "#3f9b4a"],
  },
  {
    id: "canyon",
    name: "Canyon Bridges",
    price: 400,
    blurb: "Red-rock canyons. Glue waits on risky bridges — or take the safe road below.",
    stats: { hills: 4, grip: 4 },
    tag: "Route choice",
    gravity: 10,
    groundFriction: 0.85,
    shape: { ampA: 1.15, waveA: 34, ampB: 0.9, waveB: 12, ampC: 0.7, waveC: 4 },
    sky: ["#4f8fc7", "#f2c08a", "#f8dcb4"],
    sun: { color: "#fff0c0", glow: "rgba(255, 210, 140, 0.5)", radius: 48 },
    clouds: "rgba(255,240,225,0.75)",
    forks: true,
    hills: ["#c9734a", "#a8532f"],
    ground: "#b4532c",
    bands: ["#9c4524", "#86391d"],
    pebble: "#d07448",
    top: ["#8f3f1f", "#d9824f"],
    decor: "mesa",
    decorColors: ["#9c4524", "#c96a3e"],
  },
  {
    id: "swamp",
    name: "Muddy Swamp",
    price: 250,
    blurb: "Sticky, slippery mud and bumpy roots under a hazy sky.",
    stats: { hills: 2, grip: 1 },
    gravity: 10,
    groundFriction: 0.45,
    shape: { ampA: 0.7, waveA: 36, ampB: 0.9, waveB: 10, ampC: 1.1, waveC: 3.5 },
    sky: ["#7d9a8a", "#b9c9b0", "#d9e2cf"],
    sun: { color: "#f4f1d0", glow: "rgba(240, 240, 200, 0.35)", radius: 40 },
    clouds: "rgba(220,230,215,0.7)",
    mist: true,
    hills: ["#6f8a63", "#4f6b48"],
    ground: "#4a3b2a",
    bands: ["#3d3022", "#33281c"],
    pebble: "#5e4b36",
    top: ["#3f4a2a", "#6b7a3a"],
    decor: "reed",
    decorColors: ["#6b7a3a", "#5a3a22"],
  },
  {
    id: "jungle",
    name: "Jungle Ruins",
    price: 300,
    blurb: "Steamy rainforest trails with steep little hills. Wet and a bit slick.",
    stats: { hills: 4, grip: 3 },
    gravity: 10,
    groundFriction: 0.75,
    shape: { ampA: 1.1, waveA: 30, ampB: 1.2, waveB: 11, ampC: 0.9, waveC: 4 },
    sky: ["#5aa9b8", "#bfe3d0", "#e4f4e6"],
    sun: { color: "#fff6c8", glow: "rgba(255, 245, 190, 0.45)", radius: 44 },
    clouds: "rgba(255,255,255,0.8)",
    mist: true,
    hills: ["#3f8a55", "#2c6b40"],
    ground: "#5e3d24",
    bands: ["#4f331e", "#432b19"],
    pebble: "#7a5638",
    top: ["#2c7a32", "#4fb043"],
    decor: "jungle",
    decorColors: ["#5b3a21", "#2f8a3a"],
  },
  {
    id: "city",
    name: "Night City",
    price: 350,
    blurb: "Smooth, grippy streets under neon-lit skyscrapers. Fast and flowing.",
    stats: { hills: 2, grip: 5 },
    gravity: 10,
    groundFriction: 0.9,
    shape: { ampA: 0.9, waveA: 40, ampB: 0.5, waveB: 18, ampC: 0.2, waveC: 6 },
    sky: ["#0b1030", "#2a2560", "#5a3a78"],
    sun: { color: "#f2f0e6", glow: "rgba(220, 220, 255, 0.3)", radius: 30 },
    clouds: null,
    stars: true,
    skyline: "#1a1838",
    hills: ["#241f48", "#16132e"],
    ground: "#3b3d44",
    bands: ["#33353b", "#2b2d33"],
    pebble: "#4a4c54",
    top: ["#2a2b30", "#f5c400"],
    decor: "lamp",
    decorColors: ["#2a2b30", "#ffe9a0"],
  },
  {
    id: "candy",
    name: "Candy Hills",
    price: 450,
    blurb: "Sweet pastel slopes and giant lollipops. Bouncy, steep and silly.",
    stats: { hills: 4, grip: 4 },
    gravity: 10,
    groundFriction: 0.9,
    shape: { ampA: 1.2, waveA: 26, ampB: 0.9, waveB: 10, ampC: 0.5, waveC: 5 },
    sky: ["#9fc8ff", "#ffd1ec", "#fff0f8"],
    sun: { color: "#fff7d6", glow: "rgba(255, 220, 240, 0.5)", radius: 48 },
    clouds: "rgba(255,255,255,0.95)",
    hills: ["#f7b6d9", "#c9a7f2"],
    ground: "#f2a7c8",
    bands: ["#e88fb6", "#dc79a3"],
    pebble: "#ffffff",
    top: ["#ff6fa8", "#fff0f6"],
    decor: "lollipop",
    decorColors: ["#ff5a8a", "#7fd6ff"],
  },
  {
    id: "mars",
    name: "Red Planet",
    price: 650,
    blurb: "Medium gravity and dusty red canyons. Big floaty jumps, rough landings.",
    stats: { hills: 4, grip: 3 },
    tag: "Low-ish gravity",
    gravity: 6,
    groundFriction: 0.8,
    shape: { ampA: 1.25, waveA: 34, ampB: 1.0, waveB: 12, ampC: 1.2, waveC: 3.5 },
    sky: ["#c26a4a", "#e8a27a", "#f2c9a8"],
    sun: { color: "#f6efe0", glow: "rgba(255, 220, 190, 0.35)", radius: 26 },
    clouds: null,
    dust: "rgba(200, 110, 70, 0.55)",
    hills: ["#a8553a", "#8a3f28"],
    ground: "#9c4a2c",
    bands: ["#86391f", "#73301a"],
    pebble: "#b8603a",
    top: ["#7a321b", "#d07a50"],
    decor: "spire",
    decorColors: ["#7a321b", "#b8603a"],
  },
  {
    id: "savanna",
    name: "Golden Savanna",
    price: 180,
    blurb: "Wide golden plains and flat-topped acacia trees. Easygoing hills.",
    stats: { hills: 2, grip: 4 },
    gravity: 10,
    groundFriction: 0.8,
    shape: { ampA: 1.0, waveA: 38, ampB: 0.8, waveB: 14, ampC: 0.5, waveC: 5 },
    sky: ["#5b9fd4", "#f2d79a", "#fbecc8"],
    sun: { color: "#fff3c4", glow: "rgba(255, 220, 140, 0.55)", radius: 62 },
    clouds: "rgba(255,250,235,0.75)",
    hills: ["#d9b36a", "#c49a4f"],
    ground: "#b88a4a",
    bands: ["#a6793e", "#946a34"],
    pebble: "#cfa262",
    top: ["#a8892f", "#e3c25a"],
    decor: "acacia",
    decorColors: ["#5a3d22", "#6f8a3a"],
  },
  {
    id: "sakura",
    name: "Blossom Valley",
    price: 280,
    blurb: "Rolling green hills under pink blossom trees, with petals on the breeze.",
    stats: { hills: 3, grip: 4 },
    gravity: 10,
    groundFriction: 0.85,
    shape: { ampA: 1.0, waveA: 32, ampB: 0.9, waveB: 12, ampC: 0.6, waveC: 4.5 },
    sky: ["#8ec5ec", "#f6d6e4", "#fdeef4"],
    sun: { color: "#fffbe8", glow: "rgba(255, 230, 240, 0.5)", radius: 46 },
    clouds: "rgba(255,255,255,0.9)",
    leaves: true,
    leafColors: ["#ffc4dc", "#ff9ec4", "#fff0f6", "#f7b0cf"],
    hills: ["#b9d8a8", "#8fbf7f"],
    ground: "#7a5a48",
    bands: ["#694c3c", "#5b4033"],
    pebble: "#8f6c58",
    top: ["#5f9a4a", "#9ccf6a"],
    decor: "sakura",
    decorColors: ["#5b3a2c", "#ffb7d2"],
  },
  {
    id: "haunted",
    name: "Haunted Hills",
    price: 380,
    blurb: "Moonlit graveyard hills, twisted trees and creeping fog. Spooky and steep.",
    stats: { hills: 4, grip: 3 },
    gravity: 10,
    groundFriction: 0.75,
    shape: { ampA: 1.15, waveA: 30, ampB: 1.1, waveB: 11, ampC: 0.8, waveC: 4 },
    sky: ["#120d24", "#2d2050", "#4c3a6b"],
    sun: { color: "#e8f0d0", glow: "rgba(200, 230, 180, 0.3)", radius: 42 },
    clouds: "rgba(60,50,80,0.6)",
    stars: true,
    mist: true,
    hills: ["#3b2f52", "#271f38"],
    ground: "#3a3040",
    bands: ["#30283a", "#272030"],
    pebble: "#4a4052",
    top: ["#2a2233", "#6b5a7a"],
    decor: "deadtree",
    decorColors: ["#2a2030", "#8a8a96"],
  },
  {
    id: "reef",
    name: "Coral Reef",
    price: 550,
    blurb: "Drive the sea floor! Lower gravity, rising bubbles and colorful coral.",
    stats: { hills: 3, grip: 3 },
    tag: "Underwater",
    gravity: 7,
    groundFriction: 0.7,
    shape: { ampA: 1.05, waveA: 34, ampB: 0.9, waveB: 12, ampC: 0.7, waveC: 4.5 },
    sky: ["#0a3d6b", "#1d7fa8", "#5fc3d6"],
    sun: { color: "#d8f6ff", glow: "rgba(200, 245, 255, 0.35)", radius: 70 },
    clouds: null,
    bubbles: true,
    hills: ["#1f6f8f", "#18597a"],
    ground: "#d9c08a",
    bands: ["#cbb07a", "#bda06c"],
    pebble: "#efdcae",
    top: ["#c4a868", "#efdcae"],
    decor: "coral",
    decorColors: ["#ff7a8a", "#ffb347"],
  },
  {
    id: "glacier",
    name: "Glacier",
    price: 380,
    blurb: "Blue ice as far as you can see. Gentle slopes, but the road is slippery!",
    stats: { hills: 2, grip: 1 },
    tag: "Slippery ice",
    gravity: 10,
    groundFriction: 0.45,
    shape: { ampA: 0.9, waveA: 36, ampB: 0.6, waveB: 14, ampC: 0.3, waveC: 5 },
    sky: ["#7fb8e6", "#c9e6f7", "#eef8fd"],
    sun: { color: "#ffffff", glow: "rgba(230, 245, 255, 0.55)", radius: 46 },
    clouds: "rgba(255,255,255,0.85)",
    snow: true,
    hills: ["#cfe6f3", "#b5d7ea"],
    ground: "#9fc6dd",
    bands: ["#8ab7d1", "#79a9c6"],
    pebble: "#e6f4fb",
    top: ["#a9d4ea", "#ffffff"],
    decor: "crystal",
    decorColors: ["#7ec8ec", "#e6f7ff"],
  },
  {
    id: "outback",
    name: "Outback",
    price: 300,
    blurb: "Red dirt, big skies and swirling dust. Bumpy tracks under a scorching sun.",
    stats: { hills: 3, grip: 4 },
    gravity: 10,
    groundFriction: 0.85,
    shape: { ampA: 1.1, waveA: 30, ampB: 0.9, waveB: 12, ampC: 0.8, waveC: 4 },
    sky: ["#3f8fd6", "#9fd0f0", "#f5e6c4"],
    sun: { color: "#fff0b0", glow: "rgba(255, 220, 140, 0.55)", radius: 50 },
    clouds: "rgba(255,255,255,0.6)",
    dust: "#c8643a",
    hills: ["#c97a4a", "#b5603a"],
    ground: "#b4532a",
    bands: ["#9e4622", "#8a3c1d"],
    pebble: "#d98055",
    top: ["#a8481f", "#d9774a"],
    decor: "rock",
    decorColors: ["#7a3a1f", "#a8552c"],
  },
  {
    id: "neon",
    name: "Neon Grid",
    price: 700,
    blurb: "A glowing night-time world of neon lines and a giant pink sun. Smooth and fast.",
    stats: { hills: 2, grip: 4 },
    tag: "Night drive",
    gravity: 10,
    groundFriction: 0.9,
    shape: { ampA: 0.8, waveA: 40, ampB: 0.6, waveB: 16, ampC: 0.3, waveC: 6 },
    sky: ["#0b0420", "#2a0b4a", "#ff4fa3"],
    sun: { color: "#ff7ac8", glow: "rgba(255, 90, 180, 0.45)", radius: 80 },
    clouds: null,
    stars: true,
    skyline: "#2a1b4a",
    hills: ["#3a1060", "#24093f"],
    ground: "#140a26",
    bands: ["#1d0f36", "#120822"],
    pebble: "#ff4fd8",
    top: ["#ff2fd0", "#4ff0ff"],
    glow: "#ff4fd8",
    decor: "crystal",
    decorColors: ["#ff4fd8", "#4ff0ff"],
  },
  {
    id: "saltflats",
    name: "Salt Flats",
    price: 450,
    blurb: "A dazzling white plain, almost perfectly flat. Built for top speed.",
    stats: { hills: 1, grip: 5 },
    tag: "Built for speed",
    gravity: 10,
    groundFriction: 0.95,
    shape: { ampA: 0.35, waveA: 50, ampB: 0.2, waveB: 20, ampC: 0.1, waveC: 6 },
    sky: ["#6fb6ec", "#c7e7fa", "#fbf4e6"],
    sun: { color: "#fffbe0", glow: "rgba(255, 250, 220, 0.6)", radius: 52 },
    clouds: "rgba(255,255,255,0.8)",
    hills: ["#e8dccb", "#d8c9b3"],
    ground: "#e9e4da",
    bands: ["#ddd6c8", "#d1c8b8"],
    pebble: "#ffffff",
    top: ["#d4ccbd", "#ffffff"],
    decor: "rock",
    decorColors: ["#bfb3a0", "#d9cfbf"],
  },
  {
    id: "highlands",
    name: "Highlands",
    price: 520,
    blurb: "Steep green hills, drifting mist and dark pine woods. A real test of nerve.",
    stats: { hills: 5, grip: 4 },
    gravity: 10,
    groundFriction: 0.85,
    shape: { ampA: 1.5, waveA: 38, ampB: 1.2, waveB: 14, ampC: 0.8, waveC: 5 },
    sky: ["#6d8fa8", "#a9c1cf", "#d9e3e8"],
    sun: { color: "#f4f1e0", glow: "rgba(240, 240, 225, 0.35)", radius: 40 },
    clouds: "rgba(230,235,240,0.9)",
    mist: true,
    hills: ["#6f9a6a", "#557f52"],
    ground: "#5a4630",
    bands: ["#4d3b28", "#423222"],
    pebble: "#8a7a64",
    top: ["#4f7d3a", "#7aa35a"],
    decor: "pine",
    decorColors: ["#4a3520", "#2f5d34"],
  },
  {
    id: "ascent",
    name: "Space Launch",
    price: 900,
    blurb: "A huge, steep road climbs from green fields up past the mountains and the sky, all the way into space!",
    stats: { hills: 3, grip: 4 },
    tag: "Earth to space",
    gravity: 10,
    groundFriction: 0.9,
    shape: { ampA: 0.8, waveA: 36, ampB: 0.7, waveB: 14, ampC: 0.5, waveC: 5 },
    sky: ["#4aa8e8", "#a8dcf6", "#e2f4fb"],
    sun: { color: "#fff3a6", glow: "rgba(255, 244, 180, 0.5)", radius: 44 },
    clouds: "rgba(255,255,255,0.9)",
    hills: ["#9fd3a8", "#7bc27f"],
    ground: "#9a6434",
    bands: ["#86542a", "#7a4b25"],
    pebble: "#b77d4a",
    top: ["#3e9a2c", "#62c13f"],
    decor: "tree",
    decorColors: ["#6b4423", "#4caf3f"],
    skyroad: { start: 400, climb: 800, grade: 0.4 },
  },
  {
    id: "factory",
    name: "Robot Factory",
    price: 800,
    blurb: "Ride a moving conveyor belt through a giant factory, past swinging robotic arms.",
    stats: { hills: 2, grip: 4 },
    tag: "Conveyor belt",
    gravity: 10,
    groundFriction: 0.95,
    shape: { ampA: 0.75, waveA: 40, ampB: 0.45, waveB: 16, ampC: 0.12, waveC: 6 },
    sky: ["#1b1d22", "#3a3a3e", "#6b5a48"],
    sun: { color: "#ffb35c", glow: "rgba(255, 150, 60, 0.35)", radius: 30 },
    clouds: "rgba(110, 110, 115, 0.55)",
    mist: true,
    hills: ["#3b3e45", "#2c2f35"],
    ground: "#55585e",
    bands: ["#45484e", "#3b3e44"],
    pebble: "#8a8d93",
    top: ["#2a2b2f", "#3a3c42"],
    decor: "robot",
    decorColors: ["#f2b705", "#2b2d33"],
    conveyor: 2.5,
    indoor: true,
  },
  {
    id: "sky",
    name: "Sky Kingdom",
    price: 850,
    blurb: "A cloud road high above the world. Dodge hot-air balloons, floating islands and lightning storms!",
    stats: { hills: 3, grip: 3 },
    tag: "Sky obstacles",
    gravity: 10,
    groundFriction: 0.8,
    shape: { ampA: 0.9, waveA: 42, ampB: 0.7, waveB: 16, ampC: 0.25, waveC: 6 },
    sky: ["#3f86de", "#94c4f4", "#e8f3ff"],
    sun: { color: "#fffbe6", glow: "rgba(255, 250, 225, 0.6)", radius: 50 },
    clouds: "rgba(255,255,255,0.95)",
    mist: true,
    hills: ["#eef2fb", "#dbe4f6"],
    ground: "#f1f5fd",
    bands: ["#e2e9f8", "#d3ddf3"],
    pebble: "#ffffff",
    top: ["#bccbe9", "#ffffff"],
    decor: "crystal",
    decorColors: ["#a99cf0", "#ffe08a"],
    skyObstacles: true,
  },
];

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

/** Air density relative to Earth's air, for drag: none on the Moon, thin on Mars, water on the reef. */
export function airDensity(map: MapDef): number {
  if (map.id === "moon") return 0;
  if (map.id === "mars") return 0.1;
  if (map.id === "reef") return 2.2;
  return 1;
}

/** Terrains where it can rain. */
export const RAINY = new Set(["countryside", "autumn", "jungle", "swamp", "sakura", "city", "highlands", "haunted", "savanna", "beach", "outback"]);

const mix = (a: string, b: string, t: number): string => {
  const pa = a.match(/[0-9a-f]{2}/gi);
  const pb = b.match(/[0-9a-f]{2}/gi);
  if (!a.startsWith("#") || !b.startsWith("#") || !pa || !pb || pa.length < 3 || pb.length < 3) return a;
  const c = [0, 1, 2].map((i) => Math.round(parseInt(pa[i], 16) * (1 - t) + parseInt(pb[i], 16) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};

/**
 * The same terrain in the rain: a grey sky and clouds, darker wet ground, and less grip
 * (wet roads are slippery: up to 28% less friction in a downpour).
 */
export function wetMap(map: MapDef, rain: number): MapDef {
  const grey = "#5b6470";
  return {
    ...map,
    wet: rain,
    groundFriction: map.groundFriction * (1 - 0.28 * rain),
    sky: [mix(map.sky[0], grey, 0.6 * rain), mix(map.sky[1], grey, 0.55 * rain), mix(map.sky[2], "#8a929c", 0.5 * rain)],
    sun: { ...map.sun, glow: "rgba(210, 215, 225, 0.12)", radius: map.sun.radius * 0.8 },
    clouds: "rgba(150, 158, 170, 0.95)",
    ground: mix(map.ground, "#1e1e22", 0.25 * rain),
    top: [mix(map.top[0], "#222226", 0.15 * rain), mix(map.top[1], "#333338", 0.15 * rain)],
    hills: [mix(map.hills[0], grey, 0.35 * rain), mix(map.hills[1], grey, 0.3 * rain)],
  };
}

// ---------- journey terrains (Space Launch) ----------

/** Gravity in space at the top of the sky road (Space Launch). */
export const LAUNCH_G = 2.2;

const ASCENT_PEAKS: MapDef = {
  ...MAPS.find((m) => m.id === "ascent")!,
  id: "ascent_peaks",
  sky: ["#2a6fc4", "#7fb8e8", "#d4e8f5"],
  sun: { color: "#ffffff", glow: "rgba(240, 248, 255, 0.5)", radius: 40 },
  clouds: "rgba(255,255,255,0.85)",
  hills: ["#b9c4cf", "#8d99a6"],
  ground: "#6b6460",
  bands: ["#5a5450", "#4e4844"],
  pebble: "#a49b94",
  top: ["#c8d2dc", "#f4f8fc"],
  decor: "pine",
  decorColors: ["#4a3520", "#2f5d34"],
  snow: true,
};
const ASCENT_EDGE: MapDef = {
  ...ASCENT_PEAKS,
  id: "ascent_edge",
  sky: ["#0b0820", "#2a1f5a", "#6fb4ff"],
  sun: { color: "#ffffff", glow: "rgba(200, 220, 255, 0.4)", radius: 34 },
  clouds: null,
  stars: true,
  snow: false,
  hills: ["#3b3f5a", "#2c2f45"],
  ground: "#3e3d4a",
  bands: ["#34333f", "#2b2a35"],
  pebble: "#7a7890",
  top: ["#6a6f86", "#b8bdd6"],
  decor: "rock",
  decorColors: ["#585c72", "#6f748c"],
};
const ASCENT_SPACE: MapDef = {
  ...ASCENT_EDGE,
  id: "ascent_space",
  sky: ["#000004", "#04061a", "#121a3a"],
  sun: { color: "#4f8fff", glow: "rgba(80, 140, 255, 0.35)", radius: 70 },
  planet: true,
  hills: ["#1a1d2e", "#121423"],
  ground: "#1e2030",
  bands: ["#191b29", "#141522"],
  pebble: "#4ff0ff",
  top: ["#20e0ff", "#a8f6ff"],
  glow: "#4ff0ff",
  decor: "crystal",
  decorColors: ["#4ff0ff", "#a77bff"],
};
{
  const base = MAPS.find((m) => m.id === "ascent")!;
  base.stages = [
    { at: 0, map: base, gravity: 10 },
    // Climbing the road: the peaks, then the edge of space, then space itself at the top
    { at: 700, map: ASCENT_PEAKS, gravity: 8 },
    { at: 1000, map: ASCENT_EDGE, gravity: 5 },
    { at: 1300, map: ASCENT_SPACE, gravity: LAUNCH_G },
  ];
}

const lerpHex = (a: string, b: string, t: number): string => {
  if (!a.startsWith("#") || !b.startsWith("#") || t <= 0) return t >= 1 ? b : a;
  if (t >= 1) return b;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
};

/** Which two stages x sits between, and how far from the first to the second (0..1). */
function stageAt(map: MapDef, x: number): { a: MapDef["stages"] extends (infer U)[] | undefined ? U : never; b: NonNullable<MapDef["stages"]>[number]; t: number } | null {
  const st = map.stages;
  if (!st) return null;
  let i = 0;
  while (i < st.length - 1 && x >= st[i + 1].at) i++;
  const a = st[i];
  const b = st[Math.min(st.length - 1, i + 1)];
  // Blend over the 200 m before the next stage begins
  const t = b === a ? 0 : Math.min(1, Math.max(0, (x - (b.at - 200)) / 200));
  return { a, b, t };
}

/** Gravity at x (journey terrains get lighter as you climb). */
export function gravityAt(map: MapDef, x: number): number {
  // Sky road: gravity fades with altitude, from normal at the bottom to space gravity at the top
  const sr = map.skyroad;
  if (sr) {
    const top = skyroadAltitude(sr, Infinity);
    const u = Math.min(1, Math.max(0, skyroadAltitude(sr, x) / top));
    return map.gravity + (LAUNCH_G - map.gravity) * u * u * (3 - 2 * u);
  }
  const s = stageAt(map, x);
  return s ? s.a.gravity + (s.b.gravity - s.a.gravity) * s.t : map.gravity;
}

/** How a terrain looks at x: the same map, or for journey terrains a blend of the stages around x. */
export function viewMap(map: MapDef, x: number): MapDef {
  const s = stageAt(map, x);
  if (!s) return map;
  const { a, b, t } = s;
  if (t <= 0) return a.map;
  if (t >= 1) return b.map;
  const A = a.map;
  const B = b.map;
  const near = t < 0.5 ? A : B;
  const pair = <T extends [string, string] | [string, string, string]>(p: T, q: T) => p.map((c, i) => lerpHex(c, q[i], t)) as T;
  return {
    ...near,
    id: near.id,
    sky: pair(A.sky, B.sky),
    hills: pair(A.hills, B.hills),
    ground: lerpHex(A.ground, B.ground, t),
    bands: pair(A.bands, B.bands),
    pebble: lerpHex(A.pebble, B.pebble, t),
    top: pair(A.top, B.top),
    sun: { ...near.sun, color: lerpHex(A.sun.color, B.sun.color, t), radius: A.sun.radius + (B.sun.radius - A.sun.radius) * t },
    stages: undefined,
  };
}

/** Bend-in and level-out length of the sky road (m). */
const SKY_BEND = 120;

/**
 * Height of the sky road above its start at x (without small bumps): flat, then curving up into
 * a straight climb at `grade`, then curving level at the top.
 */
export function skyroadAltitude(sr: NonNullable<MapDef["skyroad"]>, x: number): number {
  const G = sr.grade;
  const e = x - sr.start;
  if (e <= 0) return 0;
  if (e < SKY_BEND) return (G * e * e) / (2 * SKY_BEND);
  const up = (G * SKY_BEND) / 2;
  const c = e - SKY_BEND;
  if (c < sr.climb) return up + G * c;
  const f = Math.min(SKY_BEND, c - sr.climb);
  return up + G * sr.climb + G * f - (G * f * f) / (2 * SKY_BEND);
}

/** Slope (rise per meter) of the sky road at x. */
export function skyroadSlope(sr: NonNullable<MapDef["skyroad"]>, x: number): number {
  const G = sr.grade;
  const e = x - sr.start;
  if (e <= 0) return 0;
  if (e < SKY_BEND) return (G * e) / SKY_BEND;
  const c = e - SKY_BEND;
  if (c < sr.climb) return G;
  return Math.max(0, G * (1 - (c - sr.climb) / SKY_BEND));
}
