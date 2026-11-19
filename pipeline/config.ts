import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const CACHE = join(ROOT, "cache");
export const DIST = join(ROOT, "dist");

export const DDRAGON_BASE = process.env.ARAM_DDRAGON_BASE ?? "https://ddragon.leagueoflegends.com";
export const LOCALE = "ru_RU";
export const LANG = "ru";
export const MODE = "aram";

// Data Dragon major version -> public patch year label. Riot's numbering is a
// convention, not arithmetic; an unknown major stops the pipeline on purpose.
export const PATCH_MAJOR: Record<number, number> = { 16: 26 };

export const PACK_SCHEMA = 1;
export const GUIDE_SCHEMA = 1;

export const contentDir = (mode = MODE, lang = LANG) => join(ROOT, "content", mode, lang);
export const modeConfigPath = (mode = MODE) => join(ROOT, "content", mode, "mode.json");

export function patchLabel(ddragon: string): string {
  const [major, minor] = ddragon.split(".").map(Number);
  const year = PATCH_MAJOR[major];
  if (year === undefined) {
    throw new Error(
      `Неизвестная мажорная версия Data Dragon ${major} (${ddragon}). Добавьте строку в PATCH_MAJOR в pipeline/config.ts.`,
    );
  }
  return `${year}.${minor}`;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
