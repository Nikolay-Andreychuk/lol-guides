import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentDir } from "./config";
import type { Guide, SituationDef } from "./types";

export const guidesDir = () => join(contentDir(), "guides");
export const dictionaryPath = () => join(contentDir(), "situations.json");

export function writeJsonAtomic(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

export function loadDictionary(): SituationDef[] {
  return JSON.parse(readFileSync(dictionaryPath(), "utf8"));
}

export function loadGuide(champion: string): Guide | null {
  const p = join(guidesDir(), `${champion}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

export function saveGuide(g: Guide) {
  writeJsonAtomic(join(guidesDir(), `${g.champion}.json`), g);
}

export function listGuides(): Guide[] {
  return readdirSync(guidesDir())
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(guidesDir(), f), "utf8")));
}
