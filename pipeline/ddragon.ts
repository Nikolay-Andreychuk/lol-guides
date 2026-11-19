import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, DDRAGON_BASE, LOCALE, compareVersions, patchLabel } from "./config";

export const ddragonDir = (v: string) => join(CACHE, "ddragon", v);
const COMPLETE = ".complete";

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status}: ${url}`);
  }
}

export async function fetchOk(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await Bun.sleep(500 * attempt);
    let r: Response;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (r.ok) return r;
    lastErr = new HttpError(r.status, url);
    if (r.status < 500) break;
  }
  throw lastErr;
}

export async function latestVersion(): Promise<string> {
  const r = await fetchOk(`${DDRAGON_BASE}/api/versions.json`);
  const versions = (await r.json()) as string[];
  if (!Array.isArray(versions) || typeof versions[0] !== "string") throw new Error("versions.json: неожиданный формат");
  return versions[0];
}

/** Versions fully downloaded into the cache, newest first. */
export function cachedVersions(): string[] {
  const dir = join(CACHE, "ddragon");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && existsSync(join(dir, v, COMPLETE)))
    .sort((a, b) => compareVersions(b, a));
}

export function currentVersion(): string {
  const v = cachedVersions()[0];
  if (!v) throw new Error("Нет скачанных данных Riot. Сначала запустите `bun pipeline sync`.");
  return v;
}

// ---- Data Dragon shapes (only the fields we read) ----
export interface DDImage { full: string }
export interface DDSpell { id: string; name: string; description: string; image: DDImage }
export interface DDChampion {
  id: string; key: string; name: string; title: string; image: DDImage; tags: string[];
  spells: DDSpell[]; passive: { name: string; description: string; image: DDImage };
}
export interface DDItem {
  name: string; description: string; plaintext?: string; image: DDImage;
  gold: { base: number; total: number; sell: number; purchasable: boolean };
  maps: Record<string, boolean>; tags?: string[]; from?: string[]; into?: string[];
  inStore?: boolean; requiredChampion?: string; requiredAlly?: string; hideFromAll?: boolean;
  consumed?: boolean; stats?: Record<string, number>;
}
export interface DDSummoner { id: string; key: string; name: string; description: string; modes: string[]; image: DDImage }

export interface DDData {
  version: string;
  champions: Record<string, DDChampion>;
  championsEn: Record<string, { id: string; name: string }>;
  items: Record<string, DDItem>;
  summoners: Record<string, DDSummoner>;
}

const cacheData = new Map<string, DDData>();

function readData(dir: string, version: string): DDData {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  return {
    version,
    champions: read(`${LOCALE}/championFull.json`).data,
    championsEn: read("en_US/champion.json").data,
    items: read(`${LOCALE}/item.json`).data,
    summoners: read(`${LOCALE}/summoner.json`).data,
  };
}

export function loadData(version: string): DDData {
  let data = cacheData.get(version);
  if (!data) {
    data = readData(ddragonDir(version), version);
    cacheData.set(version, data);
  }
  return data;
}

export function hasData(version: string): boolean {
  return existsSync(join(ddragonDir(version), COMPLETE));
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/**
 * Downloads the JSON data and the icons for one version into cache/ddragon/<v>.
 * Writes into a temp dir and renames it at the end, so an interrupted run leaves
 * nothing that looks complete.
 */
export async function downloadVersion(version: string, iconsFor: (d: DDData) => Array<[string, string]>, log = console.log) {
  const final = ddragonDir(version);
  // Icons already in the partial dir from an interrupted run are kept; the data files are refetched.
  const tmp = `${final}.partial`;
  mkdirSync(join(tmp, LOCALE), { recursive: true });
  mkdirSync(join(tmp, "en_US"), { recursive: true });
  const files: Array<[string, string]> = [
    [`${LOCALE}/championFull.json`, `data/${LOCALE}/championFull.json`],
    [`${LOCALE}/item.json`, `data/${LOCALE}/item.json`],
    [`${LOCALE}/summoner.json`, `data/${LOCALE}/summoner.json`],
    ["en_US/champion.json", "data/en_US/champion.json"],
  ];
  for (const [local, remote] of files) {
    const r = await fetchOk(`${DDRAGON_BASE}/cdn/${version}/${remote}`);
    writeFileSync(join(tmp, local), Buffer.from(await r.arrayBuffer()));
  }
  const data = readData(tmp, version);
  const icons = iconsFor(data);
  let done = 0;
  await pool(icons, 16, async ([group, file]) => {
    const dest = join(tmp, "img", group, file);
    if (existsSync(dest)) return void done++;
    mkdirSync(join(tmp, "img", group), { recursive: true });
    const r = await fetchOk(`${DDRAGON_BASE}/cdn/${version}/img/${group}/${file}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    if (++done % 200 === 0) log(`  иконки: ${done}/${icons.length}`);
  });
  writeFileSync(join(tmp, COMPLETE), new Date().toISOString());
  rmSync(final, { recursive: true, force: true });
  renameSync(tmp, final);
  return data;
}

/** Fetches one icon into an existing cached version (used for items removed from later patches). */
export async function ensureIcon(version: string, group: string, file: string): Promise<string> {
  const dest = join(ddragonDir(version), "img", group, file);
  if (existsSync(dest)) return dest;
  mkdirSync(join(ddragonDir(version), "img", group), { recursive: true });
  const r = await fetchOk(`${DDRAGON_BASE}/cdn/${version}/img/${group}/${file}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

export function describeVersion(v: string) {
  return `${patchLabel(v)} (Data Dragon ${v})`;
}
