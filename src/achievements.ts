/** Achievements: goals that unlock specific vehicles and terrains (those can't be bought with coins). */

export interface Stats {
  /** Meters driven across all runs. */
  totalDistance: number;
  /** Coins earned across all runs. */
  coinsEarned: number;
  glueBottles: number;
  bigCoins: number;
  fuelCans: number;
  /** Longest single run, in meters. */
  bestRun: number;
  /** Best run on Hard difficulty. */
  bestHard: number;
  /** Best run on Moon Base. */
  bestMoon: number;
  /** Longest single jump, in seconds of airtime. */
  bestAir: number;
  trialsFinished: number;
  /** Terrains you've driven on. */
  terrainsPlayed: string[];
  /** Race mode wins. */
  racesWon: number;
}

export const NO_STATS: Stats = {
  totalDistance: 0,
  coinsEarned: 0,
  glueBottles: 0,
  bigCoins: 0,
  fuelCans: 0,
  bestRun: 0,
  bestHard: 0,
  bestMoon: 0,
  bestAir: 0,
  trialsFinished: 0,
  terrainsPlayed: [],
  racesWon: 0,
};

export interface Achievement {
  id: string;
  name: string;
  icon: string;
  /** What you have to do. */
  goal: string;
  target: number;
  progress: (s: Stats) => number;
  /** How progress is shown, e.g. "640 / 1,000 m". */
  unit: string;
  reward: { kind: "vehicle" | "map"; id: string };
}

const n = (x: number) => Math.floor(x).toLocaleString();

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "longhaul",
    name: "Long Haul",
    icon: "🛣️",
    goal: "Drive 1,000 m in a single run",
    target: 1000,
    progress: (s) => s.bestRun,
    unit: "m",
    reward: { kind: "vehicle", id: "jeep" },
  },
  {
    id: "gluemaster",
    name: "Glue Master",
    icon: "🧴",
    goal: "Grab 10 glue bottles",
    target: 10,
    progress: (s) => s.glueBottles,
    unit: "bottles",
    reward: { kind: "vehicle", id: "rally" },
  },
  {
    id: "bigcoins",
    name: "Treasure Hunter",
    icon: "💰",
    goal: "Collect 10 big coins",
    target: 10,
    progress: (s) => s.bigCoins,
    unit: "big coins",
    reward: { kind: "vehicle", id: "hotrod" },
  },
  {
    id: "airtime",
    name: "Frequent Flyer",
    icon: "🪂",
    goal: "Stay airborne for 3 seconds in one jump",
    target: 3,
    progress: (s) => s.bestAir,
    unit: "s",
    reward: { kind: "map", id: "canyon" },
  },
  {
    id: "trialist",
    name: "Against the Clock",
    icon: "⏱️",
    goal: "Finish a Time Trial",
    target: 1,
    progress: (s) => s.trialsFinished,
    unit: "trials",
    reward: { kind: "vehicle", id: "coupe" },
  },
  {
    id: "hardhero",
    name: "Hard Mode Hero",
    icon: "🔥",
    goal: "Drive 500 m in one run on Hard",
    target: 500,
    progress: (s) => s.bestHard,
    unit: "m",
    reward: { kind: "vehicle", id: "fire" },
  },
  {
    id: "moonwalker",
    name: "Moonwalker",
    icon: "🌙",
    goal: "Drive 300 m in one run on Moon Base",
    target: 300,
    progress: (s) => s.bestMoon,
    unit: "m",
    reward: { kind: "vehicle", id: "rover" },
  },
  {
    id: "collector",
    name: "Coin Collector",
    icon: "🪙",
    goal: "Earn 500 coins in total",
    target: 500,
    progress: (s) => s.coinsEarned,
    unit: "coins",
    reward: { kind: "map", id: "savanna" },
  },
  {
    id: "explorer",
    name: "Explorer",
    icon: "🧭",
    goal: "Drive on 5 different terrains",
    target: 5,
    progress: (s) => s.terrainsPlayed.length,
    unit: "terrains",
    reward: { kind: "map", id: "sakura" },
  },
  {
    id: "marathon",
    name: "Marathon",
    icon: "🏃",
    goal: "Drive 5,000 m in total",
    target: 5000,
    progress: (s) => s.totalDistance,
    unit: "m",
    reward: { kind: "map", id: "haunted" },
  },
  {
    id: "refuel",
    name: "Pit Stop Pro",
    icon: "⛽",
    goal: "Pick up 25 fuel cans",
    target: 25,
    progress: (s) => s.fuelCans,
    unit: "cans",
    reward: { kind: "map", id: "city" },
  },
];

/** The achievement that unlocks a vehicle or terrain, if any. */
export function achievementFor(kind: "vehicle" | "map", id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.reward.kind === kind && a.reward.id === id);
}

export function progressText(a: Achievement, s: Stats): string {
  const p = Math.min(a.target, a.progress(s));
  const shown = a.unit === "s" ? p.toFixed(1) : n(p);
  const target = a.unit === "s" ? a.target.toFixed(1) : n(a.target);
  return `${shown} / ${target} ${a.unit}`;
}

export function progressFraction(a: Achievement, s: Stats): number {
  return Math.max(0, Math.min(1, a.progress(s) / a.target));
}
