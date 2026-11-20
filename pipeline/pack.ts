import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CACHE, DDRAGON_BASE, DIST, LANG, LOCALE, MODE, PACK_SCHEMA, ROOT, compareVersions, patchLabel } from "./config";
import { applyChanges } from "./apply";
import { eligibleItems, loadMode, modeSpells, plain } from "./catalog";
import { listGuides, loadDictionary, writeJsonAtomic } from "./content";
import { cachedVersions, currentVersion, ddragonDir, ensureIcon, fetchOk, loadData, pool, type DDData, type DDItem } from "./ddragon";
import type { Guide, Slot, SituationDef } from "./types";
import { validateGuide } from "./validate";

const ROLES: Record<string, string> = { Fighter: "Боец", Tank: "Танк", Mage: "Маг", Assassin: "Убийца", Marksman: "Стрелок", Support: "Поддержка" };
const BASE_SITUATION = { key: "base", name: "Обычно", when: "Если у врагов нет явного перекоса." };
/** Name of the pointer file on the release; the app requests it by this name. */
export const latestName = (mode = MODE, lang = LANG) => `latest-${mode}-${lang}.json`;
export const BUNDLED_PACK = join(ROOT, "app/app/src/main/assets/pack.zip");

// ---- pack.json shape. The app reads a subset (app/…/pack/Models.kt); bump PACK_SCHEMA when a field it declares is removed or changes type ----
export interface PackBuild {
  key: string;
  name: string;
  when: string;
  items: Slot[];
}
export interface PackGuide {
  ddragon: string;
  patch: string;
  spells: string[];
  start: Array<{ item: number; count: number }>;
  builds: PackBuild[];
  skills: Guide["skills"];
  combo: string[];
  abilities: Guide["abilities"];
  tips: Guide["tips"];
}
export interface PackJson {
  schema: number;
  version: number;
  mode: string;
  lang: string;
  ddragon: string;
  patch: string;
  champions: Array<{
    id: string;
    name: string;
    nameEn: string;
    title: string;
    roles: string;
    icon: string;
    abilities?: Record<string, { name: string; icon: string }>;
  }>;
  items: Record<string, { name: string; price: number; description: string; icon: string; removed: boolean }>;
  spells: Record<string, { name: string; description: string; icon: string }>;
  guides: Record<string, PackGuide>;
}

/** Orders a guide's situations by the shared dictionary; names the dictionary does not know yet go last. */
export function resolveBuilds(g: Guide, dict: SituationDef[]): PackBuild[] {
  const order = new Map(dict.map((d, i) => [d.key, i]));
  const builds = g.situations.map((s, i) => {
    const def = "key" in s ? dict.find((d) => d.key === s.key) : undefined;
    if ("key" in s && !def) throw new Error(`${g.champion}: ситуации «${s.key}» нет в словаре`);
    const { slots, errors } = applyChanges(g.build, s.changes);
    if (errors.length) throw new Error(`${g.champion}: ${errors.join("; ")}`);
    const head = def ?? { key: `n:${(s as { name: string }).name}`, name: (s as { name: string }).name, when: (s as { when: string }).when };
    return { rank: def ? order.get(def.key)! : dict.length + i, build: { ...head, items: slots } };
  });
  builds.sort((a, b) => a.rank - b.rank);
  return [{ ...BASE_SITUATION, items: g.build.map((item) => ({ item })) }, ...builds.map((b) => b.build)];
}

async function toWebp(png: string, webp: string) {
  if (existsSync(webp)) return;
  mkdirSync(dirname(webp), { recursive: true });
  // Converted under a temp name: an interrupted cwebp must not leave a file the check above accepts.
  const tmp = `${webp}.tmp`;
  const p = Bun.spawn(["cwebp", "-quiet", "-q", "82", png, "-o", tmp], { stdout: "ignore", stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(`cwebp ${png}: ${await new Response(p.stderr).text()}`);
  renameSync(tmp, webp);
}

/** Item data for an id the current patch dropped: newest cached version that has it, else the guide's own version. */
async function oldItem(id: string, guideVersion: string): Promise<{ version: string; item: DDItem } | null> {
  for (const v of cachedVersions()) {
    const it = loadData(v).items[id];
    if (it) return { version: v, item: it };
  }
  const file = join(CACHE, "ddragon-items", `${guideVersion}.json`);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    const r = await fetchOk(`${DDRAGON_BASE}/cdn/${guideVersion}/data/${LOCALE}/item.json`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const it = JSON.parse(readFileSync(file, "utf8")).data[id] as DDItem | undefined;
  return it ? { version: guideVersion, item: it } : null;
}

/** Item text for the app: plain, with the names of passive and active effects wrapped in ** so the item sheet can bold them. */
export function itemText(html: string): string {
  return plain(html.replace(/<(passive|active)>([\s\S]*?)<\/\1>/g, (_, _tag, name: string) => (plain(name) ? `**${plain(name)}**` : "")));
}

export async function pack(log = console.log) {
  const version = currentVersion();
  const data = loadData(version);
  const mode = loadMode();
  const dict = loadDictionary();
  const guides = listGuides();
  const eligible = eligibleItems(data, mode).items;

  // Seconds included: two packs built a minute apart must not share a version, or phones that
  // took the first one would never take the second.
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const packVersion = Number(stamp);
  const staging = join(DIST, MODE, LANG, `staging-${stamp}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "icons"), { recursive: true });

  const icons = new Map<string, string>(); // pack path -> source png
  const addIcon = (packPath: string, png: string) => icons.set(packPath, png);
  const img = (v: string, group: string, file: string) => join(ddragonDir(v), "img", group, file);

  // Guides first: they decide which items and ability icons the pack needs.
  const packGuides: Record<string, PackGuide> = {};
  const itemIds = new Set<string>();
  for (const g of guides) {
    if (!data.champions[g.champion]) {
      log(`Пропускаю ${g.champion}: чемпиона нет в патче ${version}.`);
      continue;
    }
    if (g.ddragon === version) {
      const r = validateGuide(g, g.champion, data, mode, dict);
      if (r.errors.length) throw new Error(`${g.champion}: гайд не проходит проверку: ${r.errors.join("; ")}`);
    }
    const builds = resolveBuilds(g, dict);
    for (const b of builds) for (const s of b.items) itemIds.add(String(s.item));
    for (const s of g.start) itemIds.add(String(s.item));
    packGuides[g.champion] = {
      ddragon: g.ddragon,
      patch: patchLabel(g.ddragon),
      spells: g.spells,
      start: g.start,
      builds,
      skills: g.skills,
      combo: g.combo,
      abilities: g.abilities,
      tips: g.tips,
    };
  }

  const items: PackJson["items"] = {};
  for (const id of [...itemIds].sort()) {
    let it = data.items[id];
    let from = version;
    const removed = !eligible[id];
    if (!it) {
      const guideVersion = guides.find((g) => g.build.includes(Number(id)) || g.start.some((s) => s.item === Number(id)) || g.situations.some((s) => s.changes.some((c) => "with" in c && c.with === Number(id))))?.ddragon ?? version;
      const old = await oldItem(id, guideVersion);
      if (!old) throw new Error(`Предмет ${id} не найден ни в одной версии Data Dragon`);
      ({ item: it, version: from } = old);
    }
    const png = await ensureIcon(from, "item", it.image.full);
    addIcon(`item/${id}.webp`, png);
    items[id] = { name: it.name, price: it.gold.total, description: itemText(it.description), icon: `item/${id}.webp`, removed };
  }

  const spells: PackJson["spells"] = {};
  for (const s of modeSpells(data, mode)) {
    addIcon(`spell/${s.id}.webp`, img(version, "spell", s.image.full));
    spells[s.id] = { name: s.name, description: plain(s.description), icon: `spell/${s.id}.webp` };
  }

  const keys = ["Q", "W", "E", "R"];
  const champions: PackJson["champions"] = Object.values(data.champions)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((c) => {
      addIcon(`champion/${c.id}.webp`, img(version, "champion", c.image.full));
      const entry: PackJson["champions"][number] = {
        id: c.id,
        name: c.name,
        nameEn: data.championsEn[c.id]?.name ?? c.id,
        title: c.title,
        roles: c.tags.map((t) => ROLES[t] ?? t).join(" · "),
        icon: `champion/${c.id}.webp`,
      };
      if (packGuides[c.id]) {
        addIcon(`ability/${c.id}P.webp`, img(version, "passive", c.passive.image.full));
        entry.abilities = { P: { name: c.passive.name, icon: `ability/${c.id}P.webp` } };
        c.spells.forEach((s, i) => {
          addIcon(`ability/${c.id}${keys[i]}.webp`, img(version, "spell", s.image.full));
          entry.abilities![keys[i]] = { name: s.name, icon: `ability/${c.id}${keys[i]}.webp` };
        });
      }
      return entry;
    });

  const packJson: PackJson = {
    schema: PACK_SCHEMA,
    version: packVersion,
    mode: MODE,
    lang: LANG,
    ddragon: version,
    patch: patchLabel(version),
    champions,
    items,
    spells,
    guides: packGuides,
  };

  log(`Иконки: ${icons.size}, конвертирую в WebP…`);
  const webpCache = join(CACHE, "webp");
  await pool([...icons.entries()], 8, async ([packPath, png]) => {
    const rel = png.slice(join(CACHE, "ddragon").length + 1).replace(/\.png$/, ".webp");
    const cached = join(webpCache, rel);
    await toWebp(png, cached);
    mkdirSync(dirname(join(staging, "icons", packPath)), { recursive: true });
    copyFileSync(cached, join(staging, "icons", packPath));
  });
  writeFileSync(join(staging, "pack.json"), JSON.stringify(packJson));

  const outDir = join(DIST, MODE, LANG);
  const file = `pack-${MODE}-${LANG}-${packVersion}.zip`;
  const zipPath = join(outDir, file);
  // -n .webp stores already-compressed icons as is, so the app reads them without inflating.
  const z = Bun.spawn(["zip", "-q", "-X", "-r", "-n", ".webp", zipPath, "pack.json", "icons"], { cwd: staging, stderr: "pipe" });
  if ((await z.exited) !== 0) throw new Error(`zip: ${await new Response(z.stderr).text()}`);
  rmSync(staging, { recursive: true, force: true });

  const bytes = readFileSync(zipPath);
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const latest = { schema: PACK_SCHEMA, version: packVersion, file, size: bytes.length, sha256 };
  writeJsonAtomic(join(outDir, latestName()), latest);
  mkdirSync(dirname(BUNDLED_PACK), { recursive: true });
  copyFileSync(zipPath, BUNDLED_PACK);

  const stale = Object.values(packGuides).filter((g) => compareVersions(g.ddragon, version) < 0).length;
  log(
    `Пакет ${file}: ${(statSync(zipPath).size / 1e6).toFixed(1)} МБ, гайдов ${Object.keys(packGuides).length} из ${champions.length}` +
      `${stale ? `, устаревших ${stale}` : ""}. Скопирован в приложение (${BUNDLED_PACK.slice(ROOT.length + 1)}).`,
  );
  return { zipPath, latest };
}
