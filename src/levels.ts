import { MAPS, mapById } from "./maps";

/** A level: reach the finish line at `distance` on a fixed course. */
export interface Level {
  id: number;
  map: string;
  difficulty: "easy" | "normal" | "hard";
  distance: number;
  /** Coins for the first clear. */
  reward: number;
}

const L = (id: number, map: string, difficulty: Level["difficulty"], distance: number): Level => ({
  id,
  map,
  difficulty,
  distance,
  reward: 20 + id * 10,
});

/** The first 20 levels are hand-made; the rest are generated from their number. */
const HANDMADE: Level[] = [
  L(1, "countryside", "easy", 150),
  L(2, "countryside", "easy", 250),
  L(3, "desert", "easy", 300),
  L(4, "countryside", "normal", 350),
  L(5, "beach", "normal", 400),
  L(6, "autumn", "normal", 450),
  L(7, "snow", "normal", 450),
  L(8, "savanna", "normal", 500),
  L(9, "jungle", "normal", 500),
  L(10, "moon", "normal", 400),
  L(11, "desert", "hard", 500),
  L(12, "canyon", "normal", 550),
  L(13, "swamp", "normal", 500),
  L(14, "sakura", "hard", 600),
  L(15, "city", "normal", 700),
  L(16, "candy", "hard", 650),
  L(17, "haunted", "hard", 700),
  L(18, "mars", "normal", 650),
  L(19, "reef", "hard", 700),
  L(20, "volcano", "hard", 800),
];

export const TOTAL_LEVELS = 10000;

/** Small deterministic hash so each generated level is always the same. */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Terrains generated levels cycle through. Frozen to the original 17 so adding terrains later
 * doesn't rearrange levels players have already cleared.
 */
const LEVEL_MAPS = MAPS.slice(0, 17);

/** Levels 21+ cycle through every terrain, mostly Normal/Hard, getting longer up to 3 km. */
function generated(id: number): Level {
  const n = id - HANDMADE.length;
  // Step through the terrains in a shuffled order so neighbours rarely repeat.
  const map = LEVEL_MAPS[(n * 7 + Math.floor(n / LEVEL_MAPS.length)) % LEVEL_MAPS.length].id;
  const difficulty: Level["difficulty"] = id % 10 === 0 ? "easy" : hash(id) > 0.45 ? "hard" : "normal";
  const distance = Math.min(3000, 800 + n * 20);
  return { id, map, difficulty, distance, reward: Math.min(1000, 20 + id * 10) };
}

export function levelById(id: number): Level {
  const i = Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(id) || 1));
  return i <= HANDMADE.length ? HANDMADE[i - 1] : generated(i);
}

export const LEVELS_PER_PAGE = 20;

/**
 * Target times for 2 and 3 stars. Based on average speed over the course, slower on
 * low-gravity terrains (everything moves in slow motion there) and a little kinder on Hard.
 */
export function parTimes(level: Level): { two: number; three: number } {
  const g = Math.sqrt(mapById(level.map).gravity / 10);
  const kind = level.difficulty === "hard" ? 1.15 : 1;
  return { two: (level.distance / (9 * g)) * kind, three: (level.distance / (13 * g)) * kind };
}

export function starsFor(level: Level, time: number): number {
  const p = parTimes(level);
  return time <= p.three ? 3 : time <= p.two ? 2 : 1;
}

export interface LevelResult {
  stars: number;
  best: number;
}
