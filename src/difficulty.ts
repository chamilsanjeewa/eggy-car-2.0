export type DifficultyId = "easy" | "normal" | "hard";

export interface Difficulty {
  id: DifficultyId;
  name: string;
  blurb: string;
  /** Multiplier on hill height. */
  hillScale: number;
  /** Distance (m) over which hills grow to full size. */
  rampDistance: number;
  /** Friction between the egg and the car; lower means it slides around more. */
  eggFriction: number;
  /** Coins earned per coin picked up. */
  coinValue: number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: "easy",
    name: "Easy",
    blurb: "Gentle hills and a grippy egg.",
    hillScale: 0.6,
    rampDistance: 1200,
    eggFriction: 0.8,
    coinValue: 1,
  },
  {
    id: "normal",
    name: "Normal",
    blurb: "The classic ride.",
    hillScale: 1,
    rampDistance: 600,
    eggFriction: 0.55,
    coinValue: 1,
  },
  {
    id: "hard",
    name: "Hard",
    blurb: "Steep hills, slippery egg. Coins are worth 2×.",
    hillScale: 1.3,
    rampDistance: 300,
    eggFriction: 0.4,
    coinValue: 2,
  },
];

export function difficultyById(id: string): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}
