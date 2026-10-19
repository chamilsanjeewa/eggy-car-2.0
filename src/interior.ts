/** Car interior customization: what you see from the driver's seat. Shared by every vehicle. */

export type InteriorGroup = "dash" | "wheel" | "gloves" | "charm" | "toy" | "accent";

export interface InteriorOption {
  id: string;
  name: string;
  price: number;
  /** Swatch shown in the shop (a color, or an emoji for charms and toys). */
  swatch: string;
}

export interface InteriorGroupDef {
  id: InteriorGroup;
  name: string;
  icon: string;
  options: InteriorOption[];
}

export const INTERIOR_GROUPS: InteriorGroupDef[] = [
  {
    id: "dash",
    name: "Dashboard",
    icon: "🎛️",
    options: [
      { id: "charcoal", name: "Charcoal", price: 0, swatch: "#2f3239" },
      { id: "tan", name: "Tan Leather", price: 80, swatch: "#a8825a" },
      { id: "red", name: "Sport Red", price: 100, swatch: "#8a2a25" },
      { id: "navy", name: "Midnight Navy", price: 100, swatch: "#2c3e66" },
      { id: "white", name: "Arctic White", price: 120, swatch: "#e2dfd8" },
      { id: "wood", name: "Walnut Wood", price: 150, swatch: "#7a4e2c" },
    ],
  },
  {
    id: "wheel",
    name: "Steering wheel",
    icon: "🛞",
    options: [
      { id: "black", name: "Classic Black", price: 0, swatch: "#151619" },
      { id: "red", name: "Sport Red", price: 60, swatch: "#b8261e" },
      { id: "wood", name: "Walnut", price: 100, swatch: "#7a4a26" },
      { id: "carbon", name: "Carbon", price: 120, swatch: "#33363d" },
      { id: "gold", name: "Gold", price: 200, swatch: "#d8a72a" },
    ],
  },
  {
    id: "gloves",
    name: "Gloves",
    icon: "🧤",
    options: [
      { id: "red", name: "Red", price: 0, swatch: "#e2483d" },
      { id: "black", name: "Black", price: 25, swatch: "#2a2a2e" },
      { id: "white", name: "White", price: 25, swatch: "#f2f2f2" },
      { id: "blue", name: "Blue", price: 25, swatch: "#2f7ae5" },
      { id: "yellow", name: "Yellow", price: 25, swatch: "#f5c400" },
    ],
  },
  {
    id: "charm",
    name: "Mirror charm",
    icon: "🪢",
    options: [
      { id: "dice", name: "Fuzzy Dice", price: 0, swatch: "🎲" },
      { id: "pine", name: "Pine Air Freshener", price: 30, swatch: "🌲" },
      { id: "egg", name: "Egg Charm", price: 50, swatch: "🥚" },
      { id: "star", name: "Lucky Star", price: 60, swatch: "⭐" },
      { id: "none", name: "None", price: 0, swatch: "🚫" },
    ],
  },
  {
    id: "toy",
    name: "Dash toy",
    icon: "🐣",
    options: [
      { id: "none", name: "None", price: 0, swatch: "🚫" },
      { id: "chick", name: "Bobble Chick", price: 60, swatch: "🐤" },
      { id: "cactus", name: "Mini Cactus", price: 50, swatch: "🌵" },
      { id: "duck", name: "Rubber Duck", price: 80, swatch: "🦆" },
      { id: "trophy", name: "Gold Trophy", price: 120, swatch: "🏆" },
    ],
  },
  {
    id: "accent",
    name: "Accent glow",
    icon: "✨",
    options: [
      { id: "orange", name: "Orange", price: 0, swatch: "#ff8a1f" },
      { id: "cyan", name: "Cyan", price: 40, swatch: "#4fd1ff" },
      { id: "lime", name: "Lime", price: 40, swatch: "#8be04e" },
      { id: "pink", name: "Pink", price: 40, swatch: "#ff6fae" },
      { id: "purple", name: "Purple", price: 40, swatch: "#a77bff" },
    ],
  },
];

export type InteriorConfig = Record<InteriorGroup, string>;

export const DEFAULT_INTERIOR: InteriorConfig = { dash: "charcoal", wheel: "black", gloves: "red", charm: "dice", toy: "none", accent: "orange" };

/** Everything the cockpit drawing needs, resolved from the chosen options. */
export interface InteriorStyle {
  /** Dashboard gradient: top highlight, middle, bottom shadow. */
  dash: [string, string, string];
  /** Cabin frame (pillars and roof) center color. */
  trim: string;
  woodGrain: boolean;
  wheelRim: string;
  wheelSpoke: string;
  carbon: boolean;
  glove: [string, string];
  charm: string;
  toy: string;
  accent: string;
  /** Driver's sleeves and the sun visors (not customizable; they still dim at night). */
  sleeve: string;
  visor: string;
}

const DASH: Record<string, [string, string, string]> = {
  charcoal: ["#3a3d46", "#2a2c33", "#1a1b20"],
  tan: ["#b8936a", "#96724c", "#5e4530"],
  red: ["#a2352e", "#7a221d", "#3e110f"],
  navy: ["#3a5080", "#263a63", "#121b30"],
  white: ["#f0eee8", "#d6d2c9", "#a29e95"],
  wood: ["#94633a", "#73492a", "#45291a"],
};
const TRIM: Record<string, string> = {
  charcoal: "#2c2f37",
  tan: "#4a3a2c",
  red: "#3a1a18",
  navy: "#1e2a44",
  white: "#5a5a5e",
  wood: "#3a2a20",
};
const WHEEL: Record<string, [string, string]> = {
  black: ["#101114", "#1d1f24"],
  red: ["#b8261e", "#7a1a14"],
  wood: ["#7a4a26", "#4e2f17"],
  carbon: ["#2a2d33", "#1a1c20"],
  gold: ["#d8a72a", "#8a6a16"],
};
const GLOVES: Record<string, [string, string]> = {
  red: ["#e2483d", "#b8352c"],
  black: ["#2f2f34", "#18181b"],
  white: ["#f4f4f4", "#cfcfcf"],
  blue: ["#2f7ae5", "#1f5fbf"],
  yellow: ["#f5c400", "#c99c00"],
};
const ACCENT: Record<string, string> = { orange: "#ff8a1f", cyan: "#4fd1ff", lime: "#8be04e", pink: "#ff6fae", purple: "#a77bff" };

export function resolveInterior(c: InteriorConfig): InteriorStyle {
  return {
    dash: DASH[c.dash] ?? DASH.charcoal,
    trim: TRIM[c.dash] ?? TRIM.charcoal,
    woodGrain: c.dash === "wood",
    wheelRim: (WHEEL[c.wheel] ?? WHEEL.black)[0],
    wheelSpoke: (WHEEL[c.wheel] ?? WHEEL.black)[1],
    carbon: c.wheel === "carbon",
    glove: GLOVES[c.gloves] ?? GLOVES.red,
    charm: c.charm,
    toy: c.toy,
    accent: ACCENT[c.accent] ?? ACCENT.orange,
    sleeve: "#3b6fb6",
    visor: "#3a3d46",
  };
}

export const DEFAULT_STYLE: InteriorStyle = resolveInterior(DEFAULT_INTERIOR);
