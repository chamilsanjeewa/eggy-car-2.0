/**
 * Leaderboard for this device: every driver who plays here, under their username.
 * (A worldwide leaderboard would need a server; this one lives in the browser's storage.)
 */

export interface RunEntry {
  name: string;
  meters: number;
  vehicle: string;
  map: string;
  difficulty: string;
  /** ISO date of the run. */
  date: string;
}

export interface Board {
  /** Longest single Endless runs, best first. */
  runs: RunEntry[];
  /** Lifetime meters per driver, across all modes. */
  totals: Record<string, number>;
}

const KEY = "eggrally.leaderboard";
const KEEP = 50;
export const SHOW = 10;

export function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(KEY);
    const b = raw ? (JSON.parse(raw) as Partial<Board>) : {};
    return { runs: Array.isArray(b.runs) ? b.runs : [], totals: b.totals && typeof b.totals === "object" ? b.totals : {} };
  } catch {
    return { runs: [], totals: {} };
  }
}

function saveBoard(b: Board): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable or full */
  }
}

/**
 * Records a finished run. Endless runs compete for "longest run"; every mode adds to the
 * driver's total. Returns the run's rank in the top list (1-based), or null if it didn't make it.
 */
export function recordRun(entry: RunEntry, endless: boolean): number | null {
  if (entry.meters <= 0) return null;
  const b = loadBoard();
  b.totals[entry.name] = (b.totals[entry.name] ?? 0) + entry.meters;
  let rank: number | null = null;
  if (endless) {
    b.runs.push(entry);
    b.runs.sort((x, y) => y.meters - x.meters);
    b.runs = b.runs.slice(0, KEEP);
    const i = b.runs.indexOf(entry);
    rank = i >= 0 && i < SHOW ? i + 1 : null;
  }
  saveBoard(b);
  return rank;
}

/** Drivers ranked by lifetime meters. */
export function totalsRanked(b: Board): { name: string; meters: number }[] {
  return Object.entries(b.totals)
    .map(([name, meters]) => ({ name, meters }))
    .sort((x, y) => y.meters - x.meters);
}

export const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`);
