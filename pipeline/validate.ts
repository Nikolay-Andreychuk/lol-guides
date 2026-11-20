import { applyChanges } from "./apply";
import { eligibleItems, modeSpells, type ModeConfig } from "./catalog";
import type { DDData } from "./ddragon";
import { ABILITY_KEYS, SKILL_KEYS, TIP_KEYS, type Change, type GuideBody, type SituationDef } from "./types";

export interface Report {
  errors: string[];
  warnings: string[];
}

/** Longest situation hint: the app keeps two lines for it under the chips on a 360 dp screen. */
export const SIT_WHEN_MAX = 90;

const LIMITS = {
  combo: [2, 4, 200],
  ability: [20, 700],
  tipIntro: [20, 300],
  tipPoints: [3, 6],
  tipPoint: [20, 350],
  note: 200,
  sitName: [2, 30],
  sitWhen: [5, SIT_WHEN_MAX],
  situations: 8,
  changes: 4,
  sources: [1, 25],
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Checks a guide body against the patch data. Errors block publishing; warnings go back to the agent once. */
export function validateGuide(
  g: unknown,
  champion: string,
  data: DDData,
  mode: ModeConfig,
  dictionary: SituationDef[],
): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (s: string) => errors.push(s);
  if (!isObj(g)) return { errors: ["гайд — не объект"], warnings };
  const champ = data.champions[champion];
  if (!champ) err(`чемпиона ${champion} нет в патче ${data.version}`);

  const { items } = eligibleItems(data, mode);
  const itemName = (id: number) => data.items[String(id)]?.name ?? String(id);
  const isBoots = (id: number) => items[String(id)]?.tags?.includes("Boots") ?? false;
  const checkBuildItem = (id: unknown, where: string) => {
    if (!isInt(id)) return err(`${where}: id предмета не число`);
    const it = items[String(id)];
    if (!it) return err(`${where}: предмет ${id} (${itemName(id)}) нельзя купить в режиме ${mode.name}`);
    if (it.consumed) err(`${where}: ${it.name} — расходник, в сборке ему не место`);
  };

  // Spells
  const spellIds = new Set(modeSpells(data, mode).map((s) => s.id));
  if (!Array.isArray(g.spells) || g.spells.length !== 2 || g.spells[0] === g.spells[1]) err("spells: нужно два разных заклинания");
  else for (const s of g.spells) if (!spellIds.has(s as string)) err(`spells: ${s} недоступно в режиме ${mode.name}`);

  // Start
  if (!Array.isArray(g.start) || g.start.length < 1 || g.start.length > 4) err("start: от 1 до 4 позиций");
  else {
    let cost = 0;
    for (const e of g.start) {
      if (!isObj(e) || !isInt(e.item) || !isInt(e.count) || e.count < 1 || e.count > 10) {
        err("start: позиция должна быть {item, count 1–10}");
        continue;
      }
      const it = items[String(e.item)];
      if (!it) err(`start: предмет ${e.item} (${itemName(e.item)}) нельзя купить в режиме ${mode.name}`);
      else cost += it.gold.total * e.count;
    }
    if (cost > mode.startGold) err(`start: стоит ${cost}, а стартового золота ${mode.startGold}`);
  }

  // Build
  const build = Array.isArray(g.build) ? (g.build as unknown[]) : [];
  if (build.length !== 6 || new Set(build).size !== 6) err("build: нужно 6 разных предметов");
  build.forEach((id, i) => checkBuildItem(id, `build[${i + 1}]`));
  if (build.filter((id) => isInt(id) && isBoots(id)).length > 1) err("build: больше одной пары сапог");

  // Situations
  const known = new Set(dictionary.map((d) => d.key));
  const seen = new Set<string>();
  if (!Array.isArray(g.situations)) err("situations: должен быть массив");
  else {
    if (g.situations.length > LIMITS.situations) err(`situations: не больше ${LIMITS.situations}`);
    for (const [n, s] of g.situations.entries()) {
      const where = `situations[${n + 1}]`;
      if (!isObj(s)) {
        err(`${where}: не объект`);
        continue;
      }
      let id: string;
      if (typeof s.key === "string") {
        if (!known.has(s.key)) err(`${where}: ключа «${s.key}» нет в словаре ситуаций`);
        id = s.key;
      } else if (typeof s.name === "string" && typeof s.when === "string") {
        checkLen(s.name, LIMITS.sitName, `${where}.name`, err);
        checkLen(s.when, LIMITS.sitWhen, `${where}.when`, err);
        id = s.name.trim().toLowerCase();
      } else {
        err(`${where}: нужен key из словаря или name + when`);
        continue;
      }
      if (seen.has(id)) err(`${where}: ситуация «${id}» повторяется`);
      seen.add(id);
      const changes = s.changes;
      if (!Array.isArray(changes) || changes.length < 1 || changes.length > LIMITS.changes) {
        err(`${where}: от 1 до ${LIMITS.changes} изменений`);
        continue;
      }
      if (!changes.every(isChange)) {
        err(`${where}: изменение — {replace, with} или {move, to}`);
        continue;
      }
      for (const c of changes) if ("with" in c) checkBuildItem(c.with, `${where}`);
      if (build.length === 6 && build.every(isInt)) {
        const { slots, errors: e } = applyChanges(build as number[], changes);
        e.forEach((x) => err(`${where}: ${x}`));
        if (!e.length && slots.every((sl, i) => sl.item === build[i])) err(`${where}: изменения не меняют сборку`);
        if (slots.filter((sl) => isBoots(sl.item)).length > 1) err(`${where}: после изменений больше одной пары сапог`);
      }
    }
  }

  // Skills
  const sk = g.skills;
  if (!isObj(sk)) err("skills: не объект");
  else {
    if (!["max", "turn", "special"].includes(sk.mode as string)) err("skills.mode: max, turn или special");
    const order = sk.order;
    if (!Array.isArray(order) || order.length !== 3 || [...SKILL_KEYS].some((k) => !order.includes(k)))
      err("skills.order: перестановка Q, W, E");
    if (sk.note !== null && typeof sk.note !== "string") err("skills.note: строка или null");
    if (sk.mode === "special" && !(typeof sk.note === "string" && sk.note.trim())) err("skills: для special нужна note");
    if (typeof sk.note === "string" && sk.note.length > LIMITS.note) err(`skills.note: длиннее ${LIMITS.note}`);
  }

  // Text
  const texts: Array<[string, unknown]> = [];
  if (!Array.isArray(g.combo) || g.combo.length < LIMITS.combo[0] || g.combo.length > LIMITS.combo[1])
    err(`combo: от ${LIMITS.combo[0]} до ${LIMITS.combo[1]} советов`);
  else g.combo.forEach((c, i) => texts.push([`combo[${i + 1}]`, c]));
  for (const [i, c] of texts) if (typeof c === "string" && c.length > LIMITS.combo[2]) err(`${i}: длиннее ${LIMITS.combo[2]}`);
  if (!isObj(g.abilities)) err("abilities: не объект");
  else
    for (const k of ABILITY_KEYS) {
      checkLen(g.abilities[k], LIMITS.ability, `abilities.${k}`, err);
      texts.push([`abilities.${k}`, g.abilities[k]]);
    }
  if (!isObj(g.tips)) err("tips: не объект");
  else
    for (const k of TIP_KEYS) {
      const t = g.tips[k];
      if (!isObj(t)) {
        err(`tips.${k}: нужен объект с intro и points`);
        continue;
      }
      if (t.intro !== null) {
        checkLen(t.intro, LIMITS.tipIntro, `tips.${k}.intro`, err);
        texts.push([`tips.${k}.intro`, t.intro]);
      }
      const [min, max] = LIMITS.tipPoints;
      if (!Array.isArray(t.points) || t.points.length < min || t.points.length > max) err(`tips.${k}.points: от ${min} до ${max} пунктов`);
      else
        t.points.forEach((p, i) => {
          checkLen(p, LIMITS.tipPoint, `tips.${k}.points[${i + 1}]`, err);
          texts.push([`tips.${k}.points[${i + 1}]`, p]);
        });
    }
  // A `versus` point names the enemy composition the way the chips do, so the two screens agree.
  const sitNames = new Set(dictionary.map((d) => d.name));
  if (Array.isArray(g.situations)) for (const s of g.situations) if (isObj(s) && typeof s.name === "string") sitNames.add(s.name.trim());
  const versus = isObj(g.tips) && isObj(g.tips.versus) && Array.isArray(g.tips.versus.points) ? g.tips.versus.points : [];
  const heads = new Set<string>();
  versus.forEach((p, i) => {
    const head = typeof p === "string" ? p.split(":")[0].trim() : "";
    if (sitNames.size && !sitNames.has(head))
      warnings.push(`tips.versus.points[${i + 1}]: «${head.slice(0, 40)}» — не название ситуации; начни пункт с названия из словаря и двоеточия`);
    else if (heads.has(head)) warnings.push(`tips.versus.points[${i + 1}]: «${head.slice(0, 40)}» уже есть выше; объедини пункты`);
    heads.add(head);
  });
  if (isObj(sk) && typeof sk.note === "string") texts.push(["skills.note", sk.note]);
  if (Array.isArray(g.situations))
    for (const [n, s] of g.situations.entries())
      if (isObj(s)) for (const f of ["name", "when"]) if (typeof s[f] === "string") texts.push([`situations[${n + 1}].${f}`, s[f]]);

  const names = officialNames(data);
  const familiar = knownWords(data);
  for (const [where, t] of texts) {
    if (typeof t !== "string") {
      err(`${where}: не строка`);
      continue;
    }
    if (/https?:|www\./i.test(t)) err(`${where}: ссылки в тексте не нужны`);
    if (/[<>*#`[\]]/.test(t)) err(`${where}: разметка не нужна, только простой текст`);
    for (const m of t.matchAll(/\{([^}]*)\}/g)) if (!(ABILITY_KEYS as readonly string[]).includes(m[1])) err(`${where}: токен {${m[1]}} — допустимы {P} {Q} {W} {E} {R}`);
    // JS \b is ASCII-only, so word edges for Cyrillic are spelled out.
    if (/(?<![а-яё])рун(а|ы|у|е|ой|ам|ами|ах)?(?![а-яё])/iu.test(t)) err(`${where}: руны не упоминаются`);
    for (const w of nearMisses(t, names, familiar)) warnings.push(`${where}: «${w.word}» похоже на «${w.name}» — проверь написание; если это обычное слово, оставь как есть`);
  }

  // Sources
  if (!Array.isArray(g.sources) || g.sources.length < LIMITS.sources[0] || g.sources.length > LIMITS.sources[1])
    err(`sources: от ${LIMITS.sources[0]} до ${LIMITS.sources[1]} ссылок`);
  else for (const s of g.sources) if (typeof s !== "string" || !/^https:\/\/\S+$/.test(s)) err(`sources: «${String(s).slice(0, 80)}» — не https-ссылка`);

  return { errors, warnings };
}

function isChange(c: unknown): c is Change {
  if (!isObj(c)) return false;
  const keys = Object.keys(c).sort().join(",");
  if (keys === "replace,with") return isInt(c.replace) && isInt(c.with);
  if (keys === "move,to") return isInt(c.move) && isInt(c.to);
  return false;
}

function checkLen(v: unknown, [min, max]: readonly [number, number], where: string, err: (s: string) => void) {
  if (typeof v !== "string") return err(`${where}: не строка`);
  const n = v.trim().length;
  if (n < min || n > max) err(`${where}: длина ${n}, нужно ${min}–${max}`);
}

// ---- Name near-miss heuristic ----
// Russian inflects names («против Сораки»), so exact matching is impossible. We strip a
// case ending from both words and flag capitalised words one or two edits away from a name.
const ENDINGS = ["ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ом", "ем", "ой", "ей", "ах", "ях", "ам", "ям", "ов", "ев", "ая", "яя", "ое", "ее", "ые", "ие", "ый", "ий", "ую", "юю", "ым", "им", "ых", "их", "у", "ю", "а", "я", "е", "и", "ы", "о", "ь", "й"];
// «Скачок» → «Скачка»: a fleeting vowel drops before the last consonant.
const fleeting = (s: string) => s.replace(/[ое]([^аеёиоуыэюя])$/, "$1");

export function stem(w: string): string {
  const low = w.toLowerCase().replace(/ё/g, "е");
  for (const e of ENDINGS) if (low.endsWith(e) && low.length - e.length >= 4) return low.slice(0, -e.length);
  return low;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Champion names only: item and spell names are ordinary Russian words and flood the check with false alarms. */
export function officialNames(data: DDData): string[] {
  const out = new Set<string>();
  for (const c of Object.values(data.champions))
    c.name.split(/[\s'’\-]+/).filter((w) => /^[А-ЯЁ][а-яё]{4,}$/.test(w)).forEach((w) => out.add(w));
  return [...out];
}

/** Stems of capitalised words from item, summoner spell and ability names: written so, they are correct. */
export function knownWords(data: DDData): Set<string> {
  const out = new Set<string>();
  const add = (name: string) => {
    for (const m of name.matchAll(/[А-ЯЁ][а-яё]{4,}/g)) out.add(stem(m[0]));
  };
  for (const it of Object.values(data.items)) add(it.name);
  for (const s of Object.values(data.summoners)) add(s.name);
  for (const c of Object.values(data.champions)) {
    add(c.passive.name);
    for (const sp of c.spells) add(sp.name);
  }
  return out;
}

export function nearMisses(text: string, names: string[], known: Set<string> = new Set()): Array<{ word: string; name: string }> {
  const stems = new Map(names.map((n) => [stem(n), n]));
  const found: Array<{ word: string; name: string }> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/[А-ЯЁ][а-яё]{4,}/g)) {
    const w = m[0];
    const sw = stem(w);
    if (stems.has(sw) || known.has(sw) || seen.has(w) || [...stems.keys()].some((sn) => fleeting(sn) === sw)) continue;
    for (const [sn, name] of stems) {
      if (sn.length < 5 || Math.abs(sn.length - sw.length) > 2 || sn[0] !== sw[0]) continue;
      const d = lev(sw, sn);
      if (d >= 1 && d <= (sn.length >= 7 ? 2 : 1)) {
        found.push({ word: w, name });
        seen.add(w);
        break;
      }
    }
  }
  return found;
}

export type { GuideBody };
