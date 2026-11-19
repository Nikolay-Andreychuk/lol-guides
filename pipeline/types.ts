// Stored guide format (content/<mode>/<lang>/guides/<Champion>.json). Costly to change.

export type Change = { replace: number; with: number } | { move: number; to: number };

/** A situation from the shared dictionary, or one the agent named itself and `situations` has not keyed yet. */
export type GuideSituation =
  | { key: string; changes: Change[] }
  | { name: string; when: string; changes: Change[] };

export const SKILL_KEYS = ["Q", "W", "E"] as const;
export const ABILITY_KEYS = ["P", "Q", "W", "E", "R"] as const;
export const TIP_KEYS = ["early", "mid", "late", "teamfights", "mistakes", "versus"] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];
export type TipKey = (typeof TIP_KEYS)[number];

export interface GuideBody {
  spells: [string, string];
  start: Array<{ item: number; count: number }>;
  build: number[];
  situations: GuideSituation[];
  skills: { mode: "max" | "turn" | "special"; order: Array<(typeof SKILL_KEYS)[number]>; note: string | null };
  combo: string[];
  abilities: Record<AbilityKey, string>;
  tips: Record<TipKey, string>;
  sources: string[];
}

export interface Guide extends GuideBody {
  schema: number;
  champion: string;
  ddragon: string;
}

export interface SituationDef {
  key: string;
  name: string;
  when: string;
}

/** One slot of a build after a situation is applied, with the marks the app shows. */
export interface Slot {
  item: number;
  /** The base item this one replaced («вместо X»). */
  replaced?: number;
  /** Position (1-based) this item has in the base build, when a move put it elsewhere. */
  usually?: number;
}
