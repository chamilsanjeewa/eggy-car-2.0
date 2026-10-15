import { VehicleDef } from "./vehicles";

export type PartId = "engine" | "tires" | "suspension" | "brakes" | "tank";

export interface PartDef {
  id: PartId;
  name: string;
  icon: string;
  blurb: string;
  /** Cost of buying level n (1-based). */
  costs: number[];
}

export const PARTS: PartDef[] = [
  { id: "engine", name: "Engine", icon: "⚙️", blurb: "More torque and top speed.", costs: [60, 140, 260, 450] },
  { id: "tires", name: "Tires", icon: "🛞", blurb: "Grippier rubber for climbs and launches.", costs: [50, 110, 200, 340] },
  { id: "suspension", name: "Suspension", icon: "🔩", blurb: "Softer, better-damped springs: gentler on the egg.", costs: [60, 130, 240, 400] },
  { id: "brakes", name: "Brakes", icon: "🛑", blurb: "Shorter stops without flinging the egg.", costs: [40, 90, 170, 300] },
  { id: "tank", name: "Fuel Tank", icon: "⛽", blurb: "Bigger tank: drive further between fuel cans.", costs: [50, 120, 220, 380] },
];

export const MAX_LEVEL = 4;

export interface Paint {
  id: string;
  name: string;
  /** Hue to repaint the body with (degrees), or null for factory colors. */
  hue: number | null;
  /** Optional saturation/lightness override for special finishes. */
  sat?: number;
  light?: number;
  price: number;
}

export const PAINTS: Paint[] = [
  { id: "stock", name: "Factory", hue: null, price: 0 },
  { id: "red", name: "Racing Red", hue: 2, price: 40 },
  { id: "orange", name: "Sunset", hue: 28, price: 40 },
  { id: "lime", name: "Lime", hue: 95, price: 40 },
  { id: "teal", name: "Teal", hue: 175, price: 60 },
  { id: "blue", name: "Ocean", hue: 212, price: 60 },
  { id: "purple", name: "Grape", hue: 272, price: 60 },
  { id: "pink", name: "Bubblegum", hue: 325, price: 80 },
  { id: "black", name: "Midnight", hue: 220, sat: 12, light: 22, price: 120 },
  { id: "white", name: "Pearl", hue: 40, sat: 10, light: 88, price: 120 },
];

export interface VehicleMods {
  engine: number;
  tires: number;
  suspension: number;
  brakes: number;
  tank: number;
  paint: string;
}

export const NO_MODS: VehicleMods = { engine: 0, tires: 0, suspension: 0, brakes: 0, tank: 0, paint: "stock" };

/** Egg protection: consumable extra lives and a permanent shell armor upgrade. */
export const EGG_CARE = {
  lifePrice: 25,
  /** Armor level n absorbs n cracks per run. Costs per level. */
  armorCosts: [200, 500],
};

// ---------- applying mods ----------

function hexToHsl(hex: string): [number, number, number] {
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
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/** Repaints a color if it's a body color (saturated, not glass/rubber/trim). */
function repaint(color: string, paint: Paint): string {
  if (paint.hue === null || !color.startsWith("#") || color.length !== 7) return color;
  if (color.toLowerCase() === "#bfe8f7") return color; // glass
  const [, s, l] = hexToHsl(color);
  if (s < 30 || l < 15 || l > 90) return color; // greys, tires, liners, chrome
  // Keep each part's relative shade so the two-tone look survives.
  const shade = l - 50;
  const light = paint.light !== undefined ? paint.light + shade * 0.4 : l;
  return hsl(paint.hue, paint.sat ?? Math.max(55, s), Math.max(8, Math.min(95, light)));
}

export function paintById(id: string): Paint {
  return PAINTS.find((p) => p.id === id) ?? PAINTS[0];
}

/** Returns a copy of the vehicle with upgrades and paint applied. */
export function applyMods(def: VehicleDef, mods: VehicleMods): VehicleDef {
  const paint = paintById(mods.paint);
  return {
    ...def,
    maxSpeed: def.maxSpeed * (1 + 0.06 * mods.engine),
    torque: def.torque * (1 + 0.12 * mods.engine),
    wheelFriction: def.wheelFriction * (1 + 0.09 * mods.tires),
    suspension: {
      hz: def.suspension.hz * (1 - 0.07 * mods.suspension),
      damping: Math.min(0.95, def.suspension.damping + 0.05 * mods.suspension),
    },
    // +0.9 m/s² per level, capped where the egg was still safe in testing
    brake: Math.min(11.5, def.brake + 0.9 * mods.brakes),
    fuel: def.fuel * (1 + 0.25 * mods.tank),
    parts: def.parts.map((p) => ({ ...p, fill: repaint(p.fill, paint) })),
    lines: def.lines?.map((l) => ({ ...l, color: repaint(l.color, paint) })),
  };
}
