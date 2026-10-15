export type Decor = "tree" | "cactus" | "pine" | "rock" | "crystal" | "maple" | "palm" | "mesa";

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
];

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
