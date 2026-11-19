import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, GUIDE_SCHEMA, ROOT, patchLabel } from "./config";
import { eligibleItems, loadMode, modeSpells, plain, type ModeConfig } from "./catalog";
import { listGuides, loadDictionary, loadGuide, saveGuide } from "./content";
import { currentVersion, loadData, type DDData } from "./ddragon";
import { ABILITY_KEYS, TIP_KEYS, type Guide, type GuideBody, type SituationDef } from "./types";
import { validateGuide, type Report } from "./validate";

const MODEL = process.env.ARAM_MODEL ?? "opus";
const PARALLEL = Number(process.env.ARAM_PARALLEL ?? 3);
const TIMEOUT_MS = 20 * 60_000;
// An empty working directory: the agent sees no repository files, no CLAUDE.md and no skills.
const AGENT_CWD = join(CACHE, "agent-cwd");
const SKILL_PATH = join(ROOT, ".claude/skills/aram-guide/SKILL.md");

const str = { type: "string" } as const;
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["spells", "start", "build", "situations", "skills", "combo", "abilities", "tips", "sources"],
  properties: {
    spells: { type: "array", items: str, minItems: 2, maxItems: 2 },
    start: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "count"],
        properties: { item: { type: "integer" }, count: { type: "integer" } },
      },
    },
    build: { type: "array", items: { type: "integer" }, minItems: 6, maxItems: 6 },
    situations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["changes"],
        properties: {
          key: str,
          name: str,
          when: str,
          changes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { replace: { type: "integer" }, with: { type: "integer" }, move: { type: "integer" }, to: { type: "integer" } },
            },
          },
        },
      },
    },
    skills: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "order", "note"],
      properties: {
        mode: { enum: ["max", "turn", "special"] },
        order: { type: "array", items: { enum: ["Q", "W", "E"] }, minItems: 3, maxItems: 3 },
        note: { type: ["string", "null"] },
      },
    },
    combo: { type: "array", items: str },
    abilities: { type: "object", additionalProperties: false, required: [...ABILITY_KEYS], properties: Object.fromEntries(ABILITY_KEYS.map((k) => [k, str])) },
    tips: { type: "object", additionalProperties: false, required: [...TIP_KEYS], properties: Object.fromEntries(TIP_KEYS.map((k) => [k, str])) },
    sources: { type: "array", items: str },
  },
};

const stripSkillHeader = (s: string) => s.replace(/^---[\s\S]*?---\s*/, "");

function itemLine(id: string, data: DDData): string {
  const it = data.items[id];
  const stats = plain(it.description.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] ?? "").replace(/\n+/g, ", ");
  const effects = [...it.description.matchAll(/<(passive|active)>([^<]+)<\/\1>/g)].map((m) => `${m[1] === "active" ? "активное" : "пассивное"} «${m[2]}»`);
  const kind = it.consumed ? "расходник" : it.tags?.includes("Boots") ? "сапоги" : "";
  return [`${id} ${it.name}`, String(it.gold.total), [stats, ...effects].filter(Boolean).join("; "), kind].filter(Boolean).join(" — ");
}

export function buildFacts(champion: string, data: DDData, mode: ModeConfig, dict: SituationDef[], prev: Guide | null): string {
  const c = data.champions[champion];
  const en = data.championsEn[champion]?.name ?? champion;
  const keys = ["Q", "W", "E", "R"];
  const abilities = [
    `{P} ${c.passive.name}: ${plain(c.passive.description)}`,
    ...c.spells.map((s, i) => `{${keys[i]}} ${s.name}: ${plain(s.description)}`),
  ];
  const items = Object.keys(eligibleItems(data, mode).items).sort((a, b) => data.items[a].gold.total - data.items[b].gold.total);
  const out = [
    `# Входные данные (Data Dragon ${data.version}, патч ${patchLabel(data.version)}, режим ${mode.name})`,
    `Чемпион: ${c.name} (${en}), «${c.title}». Роли по Riot: ${c.tags.join(", ")}.`,
    "",
    "## Умения (официальные русские названия и описания)",
    ...abilities,
    "",
    "## Официальные имена чемпионов (пиши именно так, склоняя как обычно)",
    Object.values(data.champions).map((x) => x.name).sort((a, b) => a.localeCompare(b, "ru")).join(", "),
    "",
    "## Заклинания режима (id — название)",
    ...modeSpells(data, mode).map((s) => `${s.id} — ${s.name}`),
    "",
    `## Стартовое золото: ${mode.startGold}`,
    "",
    "## Предметы режима (id название — цена — характеристики — пометка)",
    ...items.map((id) => itemLine(id, data)),
    "",
    "## Словарь ситуаций (key — название — когда выбирать)",
    ...(dict.length ? dict.map((d) => `${d.key} — ${d.name} — ${d.when}`) : ["(пока пуст: называй ситуации сам через name и when)"]),
    "",
    "## Прошлый гайд",
    prev ? JSON.stringify(stripMeta(prev)) : "(нет)",
  ];
  return out.join("\n");
}

function stripMeta(g: Guide): GuideBody {
  const { schema: _s, champion: _c, ddragon: _d, ...body } = g;
  return body;
}

export interface AgentRun {
  body?: unknown;
  sessionId?: string;
  cost: number;
  durationMs?: number;
  turns?: number;
  error?: string;
  limit?: boolean;
}

export interface AgentOptions {
  schema: object;
  /** Built-in tools the agent may use; empty for none. */
  tools: string[];
  resume?: string;
}

export async function runAgent(prompt: string, opts: AgentOptions): Promise<AgentRun> {
  mkdirSync(AGENT_CWD, { recursive: true });
  const tools = opts.tools.join(",");
  const args = [
    "claude", "-p", prompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(opts.schema),
    // --tools limits the set of tools; --allowedTools only pre-approves them for a headless run.
    "--tools", tools,
    ...(tools ? ["--allowedTools", tools] : []),
    "--strict-mcp-config",
    "--setting-sources", "project",
    "--disable-slash-commands",
    "--model", MODEL,
  ];
  if (opts.resume) args.push("--resume", opts.resume);
  const proc = Bun.spawn(args, { cwd: AGENT_CWD, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  clearTimeout(timer);
  let d: Record<string, any>;
  try {
    d = JSON.parse(out);
  } catch {
    const msg = (out + err).trim().slice(-500) || `агент завершился с кодом ${proc.exitCode}`;
    return { cost: 0, error: msg, limit: /limit|quota|usage/i.test(msg) };
  }
  const cost = Number(d.total_cost_usd ?? 0);
  const stats = { durationMs: d.duration_ms, turns: d.num_turns };
  if (d.is_error || d.subtype !== "success") {
    const msg = String(d.result ?? d.subtype ?? "ошибка агента").slice(0, 500);
    return { cost, ...stats, sessionId: d.session_id, error: msg, limit: /limit|quota|usage/i.test(msg) };
  }
  let body = d.structured_output;
  if (body === undefined) {
    try {
      body = JSON.parse(d.result);
    } catch {
      return { cost, ...stats, sessionId: d.session_id, error: "агент не вернул JSON по схеме" };
    }
  }
  return { body, sessionId: d.session_id, cost, ...stats };
}

/** Keeps only known fields in a fixed order, so guide files diff cleanly between patches. */
export function normalize(body: any, dict: SituationDef[]): GuideBody {
  const keys = new Set(dict.map((d) => d.key));
  return {
    spells: body.spells,
    start: body.start,
    build: body.build,
    situations: (body.situations ?? []).map((s: any) =>
      typeof s.key === "string" && (keys.has(s.key) || s.name === undefined)
        ? { key: s.key, changes: s.changes }
        : { name: s.name, when: s.when, changes: s.changes },
    ),
    skills: { mode: body.skills?.mode, order: body.skills?.order, note: body.skills?.note?.trim() ? body.skills.note.trim() : null },
    combo: body.combo,
    abilities: body.abilities,
    tips: body.tips,
    sources: body.sources,
  };
}

export class LimitReached extends Error {}

interface Outcome {
  champion: string;
  ok: boolean;
  cost: number;
  report: Report;
  note?: string;
}

async function generateOne(champion: string, ctx: Ctx): Promise<Outcome> {
  const prev = loadGuide(champion);
  const facts = buildFacts(champion, ctx.data, ctx.mode, ctx.dict, prev);
  const prompt = `${ctx.skill}\n\n${facts}\n\nСоставь гайд для чемпиона ${ctx.data.champions[champion].name} и верни его JSON по схеме.`;
  const log: Record<string, unknown> = { champion, model: MODEL, ddragon: ctx.data.version };
  let cost = 0;
  const finish = (o: Outcome) => {
    writeFileSync(join(ctx.runDir, `${champion}.json`), JSON.stringify({ ...log, outcome: o }, null, 2));
    return o;
  };

  const web = { schema: OUTPUT_SCHEMA, tools: ["WebSearch", "WebFetch"] };
  const first = await runAgent(prompt, web);
  cost += first.cost;
  log.first = first;
  if (first.limit) throw new LimitReached(first.error);
  if (first.error) return finish({ champion, ok: false, cost, report: { errors: [first.error], warnings: [] } });

  let body = normalize(first.body, ctx.dict);
  let report = validateGuide(body, champion, ctx.data, ctx.mode, ctx.dict);
  // Warnings get one retry too: in the trial run every misspelt-name warning was real («Аатрокс», «Малфит»).
  if (report.errors.length || report.warnings.length) {
    const fix = [
      "Проверка гайда нашла проблемы. Исправь их и верни гайд целиком по той же схеме.",
      ...report.errors.map((e) => `Ошибка: ${e}`),
      ...report.warnings.map((w) => `Предупреждение: ${w}. Если название написано верно (например, это обычное слово), оставь как есть.`),
    ].join("\n");
    const second = await runAgent(fix, { ...web, resume: first.sessionId });
    cost += second.cost;
    log.second = second;
    if (second.limit) throw new LimitReached(second.error);
    if (second.error) return finish({ champion, ok: false, cost, report: { errors: [second.error], warnings: [] } });
    body = normalize(second.body, ctx.dict);
    report = validateGuide(body, champion, ctx.data, ctx.mode, ctx.dict);
    if (report.errors.length) return finish({ champion, ok: false, cost, report, note: prev ? "остался старый гайд" : "гайда нет" });
  }
  saveGuide({ schema: GUIDE_SCHEMA, champion, ddragon: ctx.data.version, ...body });
  return finish({ champion, ok: true, cost, report });
}

interface Ctx {
  data: DDData;
  mode: ModeConfig;
  dict: SituationDef[];
  skill: string;
  runDir: string;
}

export interface GenerateOptions {
  only?: string[];
  force?: boolean;
  limit?: number;
}

export async function generate(opts: GenerateOptions = {}, log = console.log) {
  const version = currentVersion();
  const data = loadData(version);
  const ctx: Ctx = {
    data,
    mode: loadMode(),
    dict: loadDictionary(),
    skill: stripSkillHeader(readFileSync(SKILL_PATH, "utf8")),
    runDir: join(CACHE, "runs", new Date().toISOString().replace(/[:.]/g, "-")),
  };
  mkdirSync(ctx.runDir, { recursive: true });

  const current = new Map(listGuides().map((g) => [g.champion, g.ddragon]));
  let todo = opts.only ?? Object.keys(data.champions).sort();
  for (const c of todo) if (!data.champions[c]) throw new Error(`Нет чемпиона «${c}» в патче ${version}. Имена — как в Data Dragon: Ahri, MissFortune, KogMaw.`);
  if (!opts.force) todo = todo.filter((c) => current.get(c) !== version);
  if (opts.limit) todo = todo.slice(0, opts.limit);
  if (!todo.length) {
    log(`Все гайды уже на версии ${version}.`);
    return { ok: [], failed: [] };
  }
  log(`Генерирую ${todo.length} гайд(ов), модель ${MODEL}, по ${PARALLEL} параллельно. Журнал: ${ctx.runDir}`);

  const outcomes: Outcome[] = [];
  let stop: string | undefined;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, todo.length) }, async () => {
      while (!stop && i < todo.length) {
        const champion = todo[i++];
        try {
          const o = await generateOne(champion, ctx);
          outcomes.push(o);
          const warn = o.report.warnings.length ? `, предупреждений: ${o.report.warnings.length}` : "";
          log(`${o.ok ? "✓" : "✗"} ${champion} ($${o.cost.toFixed(2)}${warn})${o.ok ? "" : `: ${o.report.errors.slice(0, 3).join("; ")}${o.note ? ` — ${o.note}` : ""}`}`);
        } catch (e) {
          if (e instanceof LimitReached) stop = e.message;
          else outcomes.push({ champion, ok: false, cost: 0, report: { errors: [String(e)], warnings: [] } });
        }
      }
    }),
  );
  const ok = outcomes.filter((o) => o.ok).map((o) => o.champion);
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.champion);
  const total = outcomes.reduce((s, o) => s + o.cost, 0);
  log(`Готово: ${ok.length}, не вышло: ${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}. Расход по ценам API: $${total.toFixed(2)}.`);
  if (stop) log(`Остановлено: лимит подписки (${stop.slice(0, 200)}). Запустите команду позже — готовые гайды пропускаются.`);
  return { ok, failed, stopped: stop };
}
