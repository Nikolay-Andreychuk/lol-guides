import { readFileSync } from "node:fs";
import { modeConfigPath } from "./config";
import type { DDData, DDItem, DDSummoner } from "./ddragon";

export interface ModeConfig {
  name: string;
  map: string;
  spellMode: string;
  startGold: number;
  /** id -> "include: reason" | "exclude: reason", for items that exist only on this map. */
  itemReview: Record<string, string>;
}

export function loadMode(): ModeConfig {
  return JSON.parse(readFileSync(modeConfigPath(), "utf8"));
}

/** Items a guide may recommend in this mode, plus map-only items nobody has reviewed yet. */
export function eligibleItems(data: DDData, mode: ModeConfig) {
  const items: Record<string, DDItem> = {};
  const unreviewed: string[] = [];
  for (const [id, it] of Object.entries(data.items)) {
    if (!/^\d{4}$/.test(id)) continue;
    if (!it.maps[mode.map] || !it.gold.purchasable || it.inStore === false) continue;
    if (it.requiredChampion || it.requiredAlly || !it.name.trim()) continue;
    if (!it.maps["11"]) {
      const review = mode.itemReview[id];
      if (!review) unreviewed.push(id);
      if (!review?.startsWith("include")) continue;
    }
    items[id] = it;
  }
  return { items, unreviewed };
}

export function modeSpells(data: DDData, mode: ModeConfig): DDSummoner[] {
  return Object.values(data.summoners)
    .filter((s) => s.modes.includes(mode.spellMode))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Riot descriptions carry markup (<br>, <mainText>, <stats>…); the app and the agent get plain text. */
export function plain(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(li|p)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type IconRef = [group: "champion" | "spell" | "passive" | "item", file: string];

export function iconList(data: DDData, mode: ModeConfig): IconRef[] {
  const out: IconRef[] = [];
  for (const c of Object.values(data.champions)) {
    out.push(["champion", c.image.full], ["passive", c.passive.image.full]);
    for (const s of c.spells) out.push(["spell", s.image.full]);
  }
  for (const it of Object.values(eligibleItems(data, mode).items)) out.push(["item", it.image.full]);
  for (const s of modeSpells(data, mode)) out.push(["spell", s.image.full]);
  const seen = new Set<string>();
  return out.filter(([g, f]) => {
    const k = `${g}/${f}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
