import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config";
import { dictionaryPath, listGuides, loadDictionary, saveGuide, writeJsonAtomic } from "./content";
import { LimitReached, runAgent } from "./generate";
import { LIMITS, SIT_WHEN_MAX } from "./validate";
import type { GuideSituation, SituationDef } from "./types";

const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dictionary", "mapping"],
  properties: {
    dictionary: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["key", "name", "when"], properties: { key: str, name: str, when: str } },
    },
    mapping: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "key"], properties: { name: str, key: str } },
    },
  },
};

/** The naming rules live once, in the generation skill; this pass reads the same section. */
function namingRules(): string {
  const skill = readFileSync(join(ROOT, ".claude/skills/aram-guide/SKILL.md"), "utf8");
  const m = skill.match(/## Названия ситуаций\n([\s\S]*?)(?=\n## )/);
  if (!m) throw new Error("В SKILL.md нет раздела «Названия ситуаций»");
  return m[1].trim();
}

/** A `versus` point starts with a situation name; when the dictionary merges that name into
 * another, the point is renamed with the chip so the two screens keep agreeing. A longer name
 * that would push the point past the length limit is not applied: the guide must stay packable,
 * and validation then warns about the old heading. */
export function renameVersus(points: string[], renames: Map<string, string>): string[] {
  return points.map((p) => {
    const i = p.indexOf(":");
    const to = i > 0 ? renames.get(p.slice(0, i).trim()) : undefined;
    const renamed = to ? `${to}${p.slice(i)}` : p;
    return renamed.length <= LIMITS.tipPoint[1] ? renamed : p;
  });
}

/**
 * Folds the situation names agents wrote into the shared dictionary and rewrites
 * guides to reference dictionary keys. Existing entries keep their key, name and
 * place; new entries go after them, the most common first.
 */
export async function situations(log = console.log) {
  const dict = loadDictionary();
  const guides = listGuides();
  const named = new Map<string, { whens: Set<string>; champions: Set<string> }>();
  for (const g of guides)
    for (const s of g.situations)
      if ("name" in s) {
        const e = named.get(s.name.trim()) ?? { whens: new Set(), champions: new Set() };
        e.whens.add(s.when.trim());
        e.champions.add(g.champion);
        named.set(s.name.trim(), e);
      }
  if (named.size === 0) {
    log("Все ситуации уже в словаре.");
    return { added: 0 };
  }
  log(`Свожу ${named.size} названий ситуаций из ${guides.length} гайдов со словарём из ${dict.length} записей…`);

  const prompt = [
    "Ты ведёшь словарь ситуаций для гайдов по League of Legends (классический ARAM). Ситуация — состав врагов, при котором меняется сборка.",
    "",
    "## Правила названий",
    namingRules(),
    "",
    "## Текущий словарь (key — название — когда выбирать). Эти записи не меняй.",
    ...(dict.length ? dict.map((d) => `${d.key} — ${d.name} — ${d.when}`) : ["(пуст)"]),
    "",
    "## Названия из гайдов, которых нет в словаре (название — в скольких гайдах — как гайды описали, когда выбирать)",
    ...[...named.entries()]
      .sort((a, b) => b[1].champions.size - a[1].champions.size)
      .map(([name, e]) => `${name} — ${e.champions.size} — ${[...e.whens].slice(0, 4).join(" | ")}`),
    "",
    "## Что вернуть",
    `dictionary: все записи текущего словаря без изменений плюс новые записи для названий, которым в словаре нет пары. Синонимы и близкие составы сведи в одну запись. Для новой записи: key — латиница, строчные буквы, цифры и дефис, до 24 символов (heal, tanks, burst-ad); name — по правилам выше; when — до ${SIT_WHEN_MAX} символов: когда выбирать, обобщи описания из гайдов, можно назвать 2–4 типичных чемпиона.`,
    "mapping: для каждого названия из списка выше — key записи, к которой оно относится.",
  ].join("\n");

  const r = await runAgent(prompt, { schema: SCHEMA, web: false });
  if (r.limit) throw new LimitReached(r.error);
  if (r.error || !r.body) throw new Error(`Агент не свёл названия: ${r.error ?? "пустой ответ"}`);
  const body = r.body as { dictionary: SituationDef[]; mapping: Array<{ name: string; key: string }> };

  const known = new Set(dict.map((d) => d.key));
  const fresh = body.dictionary.filter((d) => !known.has(d.key));
  for (const d of fresh) {
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(d.key)) throw new Error(`Плохой key «${d.key}»`);
    if (!d.name.trim() || d.name.length > 30 || !d.when.trim() || d.when.length > SIT_WHEN_MAX) throw new Error(`Плохая запись словаря «${d.key}»`);
  }
  const map = new Map(body.mapping.map((m) => [m.name.trim(), m.key]));
  const allKeys = new Set([...known, ...fresh.map((d) => d.key)]);
  for (const name of named.keys()) {
    const k = map.get(name);
    if (!k || !allKeys.has(k)) throw new Error(`Для «${name}» нет записи в словаре (агент вернул «${k ?? "ничего"}»)`);
  }

  // New entries go after the existing ones, ordered by how many guides use them.
  const uses = new Map<string, number>();
  for (const [name, e] of named) uses.set(map.get(name)!, (uses.get(map.get(name)!) ?? 0) + e.champions.size);
  fresh.sort((a, b) => (uses.get(b.key) ?? 0) - (uses.get(a.key) ?? 0));
  const next = [...dict, ...fresh.filter((d) => uses.has(d.key)).map(({ key, name, when }) => ({ key, name: name.trim(), when: when.trim() }))];

  // The dictionary only grows, so writing it first leaves no guide pointing at a missing key if
  // the run stops while guides are rewritten; a rerun then finishes the rewrite.
  writeJsonAtomic(dictionaryPath(), next);
  const nameOf = new Map(next.map((d) => [d.key, d.name]));
  for (const g of guides) {
    if (!g.situations.some((s) => "name" in s)) continue;
    const seen = new Set<string>();
    const out: GuideSituation[] = [];
    const renames = new Map<string, string>();
    for (const s of g.situations) {
      const key = "key" in s ? s.key : map.get(s.name.trim())!;
      if ("name" in s && nameOf.get(key) !== s.name.trim()) renames.set(s.name.trim(), nameOf.get(key)!);
      if (seen.has(key)) {
        log(`  ${g.champion}: «${"name" in s ? s.name : key}» совпала с другой ситуацией этого гайда (${key}), оставлена первая`);
        continue;
      }
      seen.add(key);
      out.push({ key, changes: s.changes });
    }
    const versus = { ...g.tips.versus, points: renameVersus(g.tips.versus.points, renames) };
    saveGuide({ ...g, situations: out, tips: { ...g.tips, versus } });
  }
  log(`Словарь: ${next.length} записей (новых ${next.length - dict.length}).`);
  for (const d of next.slice(dict.length)) log(`  ${d.key} — ${d.name} (${uses.get(d.key)} гайд.)`);
  return { added: next.length - dict.length };
}
