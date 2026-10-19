/**
 * Day/night cycle: time of day t in [0, 1), where 0 is midnight, 0.25 sunrise, 0.5 noon and
 * 0.75 sunset. Everything that changes with the time of day reads these values.
 */

/** Seconds of driving for one full day. */
export const DAY_LENGTH = 480;

export interface Daylight {
  /** Sun height: -1 at midnight, 0 on the horizon, 1 at noon. */
  elev: number;
  /** 0 at night → 1 in full daylight. */
  day: number;
  /** 0 by day → 1 in full night. */
  night: number;
  /** Golden hour / twilight glow, strongest with the sun near the horizon (0..1). */
  dusk: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function daylight(t: number): Daylight {
  const elev = Math.sin((t - 0.25) * Math.PI * 2);
  return {
    elev,
    day: smooth(-0.06, 0.28, elev),
    night: 1 - smooth(-0.22, 0.02, elev),
    dusk: Math.exp(-(((elev - 0.03) / 0.17) ** 2)),
  };
}

/** "06:45"-style clock for the HUD. */
export function clockText(t: number): string {
  const mins = Math.floor((((t % 1) + 1) % 1) * 24 * 60);
  const h = Math.floor(mins / 60);
  const m = Math.floor((mins % 60) / 5) * 5;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** An icon for the time of day. */
export function clockIcon(t: number): string {
  const d = daylight(t);
  if (d.night > 0.6) return "🌙";
  if (d.dusk > 0.45) return t < 0.5 ? "🌅" : "🌇";
  return "☀️";
}
