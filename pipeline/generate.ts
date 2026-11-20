import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CACHE, GUIDE_SCHEMA, ROOT, patchLabel } from "./config";
import { eligibleItems, loadMode, modeSpells, plain, type ModeConfig } from "./catalog";
import { listGuides, loadDictionary, loadGuide, saveGuide } from "./content";
import { currentVersion, loadData, type DDData } from "./ddragon";
import { ABILITY_KEYS, TIP_KEYS, type Guide, type GuideBody, type SituationDef } from "./types";
import { validateGuide, type Report } from "./validate";

// Codex model. gpt-6.2-sol is not offered to ChatGPT logins yet; switch here when it is.
const MODEL = process.env.ARAM_MODEL ?? "gpt-6.1-sol";
const PARALLEL = Number(process.env.ARAM_PARALLEL ?? 3);
const TIMEOUT_MS = 20 * 60_000;
// An empty working directory: the agent sees no repository files and no project AGENTS.md.
const AGENT_CWD = join(CACHE, "agent-cwd");
// Codex also loads AGENTS.md from its home. A separate home (its own `codex login`) keeps
// personal instructions out of the agent's context; without it the default home is used.
const CODEX_HOME = process.env.ARAM_CODEX_HOME;
// `bun run` puts every parent's node_modules/.bin on PATH, where an old npm build of codex
// may shadow the installed CLI; look it up on the PATH without those directories.
const CODEX_BIN =
  process.env.ARAM_CODEX ??
  Bun.which("codex", { PATH: (process.env.PATH ?? "").split(":").filter((d) => !d.includes("node_modules/.bin")).join(":") }) ??
  "codex";
const SKILL_PATH = join(ROOT, ".claude/skills/aram-guide/SKILL.md");

const str = { type: "string" } as const;
const strOrNull = { type: ["string", "null"] } as const;
// Codex sends the schema in strict mode: every property is required, absent values are null.
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["spells", "start", "build", "situations", "skills", "combo", "abilities", "tips", "sources"],
  properties: {
    spells: { type: "array", items: str },
    start: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "count"],
        properties: { item: { type: "integer" }, count: { type: "integer" } },
      },
    },
    build: { type: "array", items: { type: "integer" } },
    situations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "name", "when", "changes"],
        properties: {
          key: strOrNull,
          name: strOrNull,
          when: strOrNull,
          changes: {
            type: "array",
            items: {
              anyOf: [
                { type: "object", additionalProperties: false, required: ["replace", "with"], properties: { replace: { type: "integer" }, with: { type: "integer" } } },
                { type: "object", additionalProperties: false, required: ["move", "to"], properties: { move: { type: "integer" }, to: { type: "integer" } } },
              ],
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
        order: { type: "array", items: { enum: ["Q", "W", "E"] } },
        note: strOrNull,
      },
    },
    combo: { type: "array", items: str },
    abilities: { type: "object", additionalProperties: false, required: [...ABILITY_KEYS], properties: Object.fromEntries(ABILITY_KEYS.map((k) => [k, str])) },
    tips: {
      type: "object",
      additionalProperties: false,
      required: [...TIP_KEYS],
      properties: Object.fromEntries(
        TIP_KEYS.map((k) => [
          k,
          { type: "object", additionalProperties: false, required: ["intro", "points"], properties: { intro: strOrNull, points: { type: "array", items: str } } },
        ]),
      ),
    },
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

export interface Usage {
  input: number;
  cached: number;
  output: number;
}

export interface AgentRun {
  body?: unknown;
  sessionId?: string;
  usage: Usage;
  durationMs: number;
  error?: string;
  limit?: boolean;
}

export interface AgentOptions {
  schema: object;
  /** Lets the agent search and read the web. */
  web: boolean;
  /** Continues an earlier run of the same agent, with its context. */
  resume?: string;
}

const LIMIT_RE = /usage limit|rate.?limit|quota|too many requests/i;

export const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output });
export const formatUsage = (u: Usage) => `${Math.round(u.input / 1000)}k вход (${Math.round(u.cached / 1000)}k из кэша), ${Math.round(u.output / 1000)}k выход`;

/** Codex features that reach the local machine beyond web search; all are turned off for guide runs. */
const HOST_TOOLS = ["shell_tool", "unified_exec", "browser_use", "browser_use_external", "in_app_browser", "computer_use", "apps", "view_image"];
/** Event items that mean the agent touched the machine anyway, e.g. after a Codex update adds a tool. */
const HOST_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call"]);

/** Reads `codex exec --json` output: session id, token usage, the failure if the run failed, and Codex's last error notice. */
export function readEvents(out: string): { sessionId?: string; usage: Usage; error?: string; notice?: string } {
  const usage: Usage = { input: 0, cached: 0, output: 0 };
  let sessionId: string | undefined;
  let failed: string | undefined;
  let notice: string | undefined;
  let host: string | undefined;
  for (const line of out.split("\n")) {
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "thread.started") sessionId = e.thread_id;
    if (e.type === "turn.completed" && e.usage)
      Object.assign(usage, addUsage(usage, { input: e.usage.input_tokens ?? 0, cached: e.usage.cached_input_tokens ?? 0, output: e.usage.output_tokens ?? 0 }));
    if (e.type === "turn.failed") failed ??= String(e.error?.message ?? "");
    // Codex also reports errors it is still retrying («Reconnecting… 1/5»); only a failed turn fails the run.
    if (e.type === "error") notice = String(e.message ?? e.error?.message ?? "");
    if (e.type?.startsWith("item.") && HOST_ITEMS.has(e.item?.type))
      host ??= `агент обратился к компьютеру (${e.item.type}), ответ отброшен`;
  }
  const error = host ?? (failed === undefined ? undefined : failed || notice || "ошибка агента");
  return { sessionId, usage, error, notice };
}

/** One `codex exec` run in a read-only sandbox, answering with JSON that matches the schema. */
export async function runAgent(prompt: string, opts: AgentOptions): Promise<AgentRun> {
  mkdirSync(AGENT_CWD, { recursive: true });
  const dir = join(tmpdir(), `aram-agent-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const schemaFile = join(dir, "schema.json");
  const outFile = join(dir, "out.json");
  writeFileSync(schemaFile, JSON.stringify(opts.schema));
  const flags = [
    "-m", MODEL,
    "--ignore-user-config",
    "-c", 'sandbox_mode="read-only"',
    "-c", 'approval_policy="never"',
    // Live search: the default cached index can predate the patch the guide is written for.
    "-c", `web_search="${opts.web ? "live" : "disabled"}"`,
    "-c", 'model_reasoning_effort="high"',
    "-c", "project_doc_max_bytes=0",
    // The agent reads untrusted web pages, so it gets no way to read local files: read-only mode
    // still lets shell commands read the whole disk. Web search runs through the code-mode host,
    // which must stay on.
    ...HOST_TOOLS.flatMap((f) => ["--disable", f]),
    "--skip-git-repo-check",
    "--json",
    "--output-schema", schemaFile,
    "-o", outFile,
  ];
  // Sol models get sub-agent tools from the server whatever the feature flags say, and a global
  // AGENTS.md may ask for them; runs that waited on sub-agents went past the timeout.
  const input = `${prompt}\n\nРаботай сам: не запускай под-агентов.`;
  const args = opts.resume ? [CODEX_BIN, "exec", "resume", ...flags, opts.resume, input] : [CODEX_BIN, "exec", ...flags, input];
  const started = Date.now();
  const env = CODEX_HOME ? { ...process.env, CODEX_HOME } : process.env;
  // stdin must be closed: codex exec otherwise waits for more prompt text on it.
  const proc = Bun.spawn(args, { cwd: AGENT_CWD, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  clearTimeout(timer);

  const events = readEvents(out);
  const { usage } = events;
  const sessionId = events.sessionId ?? opts.resume;
  let error = events.error;
  const durationMs = Date.now() - started;
  const text = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  if (timedOut) error = `агент не уложился в ${TIMEOUT_MS / 60_000} мин`;
  else if (!error && proc.exitCode !== 0) error = events.notice || err.trim().slice(-500) || `codex завершился с кодом ${proc.exitCode}`;
  if (error) return { sessionId, usage, durationMs, error: error.slice(0, 500), limit: LIMIT_RE.test(error) };
  try {
    return { body: JSON.parse(text), sessionId, usage, durationMs };
  } catch {
    return { sessionId, usage, durationMs, error: `агент не вернул JSON по схеме (код ${proc.exitCode}): ${(err + out).trim().slice(-300)}` };
  }
}

/** Keeps only known fields in a fixed order, so guide files diff cleanly between patches. */
export function normalize(body: any, dict: SituationDef[]): GuideBody {
  const keys = new Set(dict.map((d) => d.key));
  return {
    spells: body.spells,
    start: body.start,
    build: body.build,
    situations: (body.situations ?? []).map((s: any) =>
      typeof s.key === "string" && (keys.has(s.key) || typeof s.name !== "string")
        ? { key: s.key, changes: s.changes }
        : { name: s.name, when: s.when, changes: s.changes },
    ),
    skills: { mode: body.skills?.mode, order: body.skills?.order, note: body.skills?.note?.trim() ? body.skills.note.trim() : null },
    combo: body.combo,
    abilities: body.abilities,
    tips: Object.fromEntries(
      TIP_KEYS.map((k) => {
        const t = body.tips?.[k];
        const intro = typeof t?.intro === "string" && t.intro.trim() ? t.intro.trim() : null;
        return [k, { intro, points: Array.isArray(t?.points) ? t.points.map((p: unknown) => (typeof p === "string" ? p.trim() : p)) : t?.points }];
      }),
    ) as GuideBody["tips"],
    sources: body.sources,
  };
}

export class LimitReached extends Error {}

interface Outcome {
  champion: string;
  ok: boolean;
  usage: Usage;
  report: Report;
  note?: string;
}

async function generateOne(champion: string, ctx: Ctx): Promise<Outcome> {
  // A forced run writes the guide afresh instead of updating the old one.
  const prev = ctx.fresh ? null : loadGuide(champion);
  const facts = buildFacts(champion, ctx.data, ctx.mode, ctx.dict, prev);
  const prompt = `${ctx.skill}\n\n${facts}\n\nСоставь гайд для чемпиона ${ctx.data.champions[champion].name} и верни его JSON по схеме.`;
  const log: Record<string, unknown> = { champion, model: MODEL, ddragon: ctx.data.version };
  let usage: Usage = { input: 0, cached: 0, output: 0 };
  const finish = (o: Outcome) => {
    writeFileSync(join(ctx.runDir, `${champion}.json`), JSON.stringify({ ...log, outcome: o }, null, 2));
    return o;
  };

  const web = { schema: OUTPUT_SCHEMA, web: true };
  const first = await runAgent(prompt, web);
  usage = addUsage(usage, first.usage);
  log.first = first;
  if (first.limit) throw new LimitReached(first.error);
  if (first.error) return finish({ champion, ok: false, usage, report: { errors: [first.error], warnings: [] } });

  let body = normalize(first.body, ctx.dict);
  let report = validateGuide(body, champion, ctx.data, ctx.mode, ctx.dict);
  // Warnings get one retry too: in the trial run every misspelt-name warning was real («Аатрокс», «Малфит»).
  if (report.errors.length || report.warnings.length) {
    // An answer with only warnings is a valid guide: it is kept if the retry goes wrong.
    const fallback = report.errors.length === 0;
    const fix = [
      "Проверка гайда нашла проблемы. Исправь их и верни гайд целиком по той же схеме.",
      ...report.errors.map((e) => `Ошибка: ${e}`),
      ...report.warnings.map((w) => `Предупреждение: ${w}.`),
    ].join("\n");
    const second = await runAgent(fix, { ...web, resume: first.sessionId });
    // A resumed run reports usage for the whole thread, the first run included.
    if (second.usage.output) usage = second.usage;
    log.second = second;
    const retryBody = second.error ? null : normalize(second.body, ctx.dict);
    const retryReport = retryBody && validateGuide(retryBody, champion, ctx.data, ctx.mode, ctx.dict);
    if (retryBody && retryReport && !retryReport.errors.length) {
      body = retryBody;
      report = retryReport;
    } else if (!fallback) {
      if (second.limit) throw new LimitReached(second.error);
      const failed = retryReport ?? { errors: [second.error ?? "пустой ответ"], warnings: [] };
      return finish({ champion, ok: false, usage, report: failed, note: prev ? "остался старый гайд" : "гайда нет" });
    }
  }
  saveGuide({ schema: GUIDE_SCHEMA, champion, ddragon: ctx.data.version, ...body });
  return finish({ champion, ok: true, usage, report });
}

interface Ctx {
  data: DDData;
  mode: ModeConfig;
  dict: SituationDef[];
  skill: string;
  runDir: string;
  fresh: boolean;
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
    fresh: Boolean(opts.force),
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
          log(`${o.ok ? "✓" : "✗"} ${champion} (${formatUsage(o.usage)}${warn})${o.ok ? "" : `: ${o.report.errors.slice(0, 3).join("; ")}${o.note ? ` — ${o.note}` : ""}`}`);
        } catch (e) {
          if (e instanceof LimitReached) stop = e.message;
          else outcomes.push({ champion, ok: false, usage: { input: 0, cached: 0, output: 0 }, report: { errors: [String(e)], warnings: [] } });
        }
      }
    }),
  );
  const ok = outcomes.filter((o) => o.ok).map((o) => o.champion);
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.champion);
  const total = outcomes.reduce((s, o) => addUsage(s, o.usage), { input: 0, cached: 0, output: 0 });
  log(`Готово: ${ok.length}, не вышло: ${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}. Токены: ${formatUsage(total)}.`);
  if (stop) log(`Остановлено: лимит подписки (${stop.slice(0, 200)}). Запустите команду позже — готовые гайды пропускаются.`);
  return { ok, failed, stopped: stop };
}
