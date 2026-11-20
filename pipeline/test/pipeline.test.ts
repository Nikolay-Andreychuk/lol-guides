import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyChanges } from "../apply";
import { eligibleItems, plain, type ModeConfig } from "../catalog";
import { patchLabel } from "../config";
import type { DDData } from "../ddragon";
import { normalize, readEvents } from "../generate";
import { itemText, resolveBuilds } from "../pack";
import { renameVersus } from "../situations";
import type { Guide, GuideBody, SituationDef } from "../types";
import { knownWords, nearMisses, officialNames, validateGuide } from "../validate";

const fx = (f: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", f), "utf8"));
const data: DDData = fx("dd-16.23.1.json");
const ahri: Guide = fx("Ahri.json");
const mode: ModeConfig = { name: "ARAM", map: "12", spellMode: "ARAM", startGold: 1400, itemReview: { "3039": "exclude: Mayhem" } };
const dict: SituationDef[] = [];
const body = (): GuideBody => structuredClone(normalize(ahri, dict));
const check = (b: unknown, d = dict) => validateGuide(b, "Ahri", data, mode, d);

describe("applyChanges", () => {
  const base = [1, 2, 3, 4, 5, 6];
  test("replace keeps the slot and marks the base item", () => {
    const { slots, errors } = applyChanges(base, [{ replace: 3, with: 9 }]);
    expect(errors).toEqual([]);
    expect(slots[2]).toEqual({ item: 9, replaced: 3 });
  });
  test("move marks only the moved item with its usual position", () => {
    const { slots } = applyChanges(base, [{ move: 6, to: 2 }]);
    expect(slots.map((s) => s.item)).toEqual([1, 6, 2, 3, 4, 5]);
    expect(slots[1]).toEqual({ item: 6, usually: 6 });
    expect(slots[2]).toEqual({ item: 2 });
  });
  test("a replaced item can then be moved and keeps «вместо»", () => {
    const { slots } = applyChanges(base, [{ replace: 6, with: 9 }, { move: 9, to: 3 }]);
    expect(slots[2]).toEqual({ item: 9, replaced: 6 });
  });
  test("errors: unknown item, duplicate, bad position", () => {
    expect(applyChanges(base, [{ replace: 7, with: 8 }]).errors).toHaveLength(1);
    expect(applyChanges(base, [{ replace: 1, with: 2 }]).errors).toHaveLength(1);
    expect(applyChanges(base, [{ move: 1, to: 7 }]).errors).toHaveLength(1);
  });
});

describe("eligibleItems", () => {
  test("drops six-digit mode variants and reviewed exclusions", () => {
    const { items, unreviewed } = eligibleItems(data, mode);
    expect(items["3020"]).toBeDefined();
    expect(items["223084"]).toBeUndefined();
    expect(items["771001"]).toBeUndefined();
    expect(items["3039"]).toBeUndefined();
    expect(unreviewed).toEqual([]);
  });
  test("an unreviewed map-only item is reported and not offered", () => {
    const { items, unreviewed } = eligibleItems(data, { ...mode, itemReview: {} });
    expect(unreviewed).toEqual(["3039"]);
    expect(items["3039"]).toBeUndefined();
  });
});

describe("validateGuide", () => {
  test("the stored Ahri guide passes", () => {
    expect(check(body()).errors).toEqual([]);
  });

  const cases: Array<[string, (b: any) => void, RegExp]> = [
    ["unknown item", (b) => (b.build[0] = 999999), /нельзя купить/],
    ["Mayhem-only item", (b) => (b.build[0] = 3039), /нельзя купить/],
    ["duplicate build item", (b) => (b.build[1] = b.build[0]), /6 разных/],
    ["two boots", (b) => (b.build[0] = 1001), /больше одной пары сапог/],
    ["consumable in build", (b) => (b.build[0] = 2003), /расходник/],
    ["start over budget", (b) => (b.start = [{ item: 3802, count: 2 }]), /стартового золота/],
    ["spell not in mode", (b) => (b.spells = ["SummonerFlash", "SummonerSmite"]), /недоступно/],
    ["replace of an item not in the build", (b) => (b.situations[0].changes = [{ replace: 3047, with: 3111 }]), /нет в сборке/],
    ["move to position 7", (b) => (b.situations[0].changes = [{ move: b.build[0], to: 7 }]), /вне 1–6/],
    ["change that changes nothing", (b) => (b.situations[0].changes = [{ move: b.build[0], to: 1 }]), /не меняют/],
    ["unknown dictionary key", (b) => (b.situations[0] = { key: "nope", changes: b.situations[0].changes }), /нет в словаре/],
    ["bad token", (b) => (b.combo[0] = "{X} затем {Q}"), /токен \{X\}/],
    ["markup", (b) => (b.tips.early.points[0] = "**Важно**: " + b.tips.early.points[0]), /разметка/],
    ["link in text", (b) => (b.tips.mid.points[0] += " https://example.com"), /ссылки/],
    ["runes", (b) => (b.tips.late.points[0] += " Руны не важны."), /руны/],
    ["tips as plain text", (b) => (b.tips.early = "Держись позади союзников и бросай сферу через волну."), /tips\.early: нужен объект/],
    ["too few tip points", (b) => (b.tips.combos.points = b.tips.combos.points.slice(0, 2)), /tips\.combos\.points: от 3/],
    ["special without note", (b) => (b.skills = { mode: "special", order: ["Q", "W", "E"], note: null }), /нужна note/],
    ["order not a permutation", (b) => (b.skills.order = ["Q", "Q", "E"]), /перестановка/],
    ["too short ability text", (b) => (b.abilities.R = "Рывок."), /abilities\.R: длина/],
  ];
  for (const [name, mutate, msg] of cases)
    test(name, () => {
      const b = body();
      mutate(b);
      expect(check(b).errors.join("\n")).toMatch(msg);
    });

  test("a misspelt champion name is a warning, inflected names are not", () => {
    const b = body();
    b.tips.versus.points[0] = "Против Аатрокса держись дальше. Против Сораки бей лекаря. Мисс Фортуне не стой в линию.";
    const w = check(b).warnings.filter((x) => x.includes("похоже на"));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Аатрокса.*Атрокс/);
  });
});

describe("versus names", () => {
  const d: SituationDef[] = [{ key: "tanks", name: "Много танков", when: "Три танка" }];
  test("a dictionary name passes once; a synonym or a repeat is a warning", () => {
    const b = body();
    b.tips.versus.points = ["Много танков: бей по передней линии издалека.", "Много магов: бей по передней линии издалека.", "Много танков: держись за союзниками."];
    const w = check(b, d).warnings.filter((x) => x.startsWith("tips.versus"));
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/points\[2\].*Много магов/);
    expect(w[1]).toMatch(/points\[3\].*объедини/);
  });
});

describe("readEvents", () => {
  const line = (o: object) => JSON.stringify(o);
  test("counts usage and keeps the session id", () => {
    const r = readEvents([line({ type: "thread.started", thread_id: "t1" }), line({ type: "item.completed", item: { type: "web_search" } }), line({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } })].join("\n"));
    expect(r).toEqual({ sessionId: "t1", usage: { input: 10, cached: 4, output: 2 }, error: undefined, notice: undefined });
  });
  test("an error Codex retried past does not fail the run", () => {
    const r = readEvents([line({ type: "error", message: "Reconnecting... 1/5 (Too Many Requests)" }), line({ type: "turn.completed", usage: { output_tokens: 5 } })].join("\n"));
    expect(r.error).toBeUndefined();
  });
  test("a failed turn fails the run with Codex's message", () => {
    const r = readEvents([line({ type: "error", message: "usage limit reached" }), line({ type: "turn.failed", error: {} })].join("\n"));
    expect(r.error).toBe("usage limit reached");
  });
  test("a command run by the agent fails the run", () => {
    const r = readEvents([line({ type: "item.started", item: { type: "command_execution", command: "cat ~/.ssh/id_rsa" } }), line({ type: "turn.completed", usage: { input_tokens: 1 } })].join("\n"));
    expect(r.error).toMatch(/command_execution/);
  });
  test("an item type a guide run never produces fails the run", () => {
    const r = readEvents([line({ type: "item.started", item: { type: "collab_tool_call" } }), line({ type: "turn.completed", usage: { input_tokens: 1 } })].join("\n"));
    expect(r.error).toMatch(/collab_tool_call/);
  });
  test("web search and messages pass", () => {
    const r = readEvents([line({ type: "item.completed", item: { type: "web_search" } }), line({ type: "item.completed", item: { type: "agent_message" } }), line({ type: "turn.completed", usage: { input_tokens: 1 } })].join("\n"));
    expect(r.error).toBeUndefined();
  });
});

describe("renameVersus", () => {
  test("a merged situation name is renamed in versus headings only", () => {
    const points = ["Невидимки: держи метку.", "Много хила: Мореллономикон раньше.", "Без двоеточия Невидимки"];
    expect(renameVersus(points, new Map([["Невидимки", "Много невидимок"]]))).toEqual(["Много невидимок: держи метку.", "Много хила: Мореллономикон раньше.", "Без двоеточия Невидимки"]);
  });
  test("a rename that would break the length limit is skipped", () => {
    const long = `Маги: ${"а".repeat(335)}`;
    expect(long.length).toBeLessThanOrEqual(350);
    expect(renameVersus([long], new Map([["Маги", "Много магического урона"]]))).toEqual([long]);
  });
});

describe("nearMisses", () => {
  const names = officialNames(data);
  test("words from item names are not flagged", () => {
    const text = "Много танков: собирай Мучения Лиандри.";
    expect(nearMisses(text, ["Лиссандра"])).toHaveLength(1);
    expect(nearMisses(text, ["Лиссандра"], knownWords(data))).toEqual([]);
  });
  test("fleeting vowel and case endings are not flagged", () => {
    expect(nearMisses("После Атроксом и Сорака, Сораке.", names)).toEqual([]);
  });
});

describe("resolveBuilds", () => {
  test("dictionary order wins, unknown names go last, Обычно first", () => {
    const g: Guide = structuredClone(ahri);
    g.situations = [
      { name: "Своё", when: "когда-нибудь", changes: [{ move: g.build[5], to: 2 }] },
      { key: "tank", changes: [{ move: g.build[4], to: 3 }] },
      { key: "heal", changes: [{ replace: g.build[5], with: 3165 }] },
    ];
    const d: SituationDef[] = [
      { key: "heal", name: "Много хила", when: "Сорака, Юми" },
      { key: "tank", name: "Танки", when: "Три танка" },
    ];
    const b = resolveBuilds(g, d);
    expect(b.map((x) => x.name)).toEqual(["Обычно", "Много хила", "Танки", "Своё"]);
    expect(b[3].key).toBe("n:Своё");
    expect(b[1].items[5]).toEqual({ item: 3165, replaced: g.build[5] });
  });
});

describe("normalize", () => {
  test("strict-mode nulls pick the key or the named form of a situation", () => {
    const d: SituationDef[] = [{ key: "heal", name: "Много хила", when: "Сорака" }];
    const changes = [{ replace: 1, with: 2 }];
    const n = normalize(
      { ...ahri, situations: [{ key: "heal", name: null, when: null, changes }, { key: null, name: "Танки", when: "Три танка", changes }] },
      d,
    );
    expect(n.situations).toEqual([{ key: "heal", changes }, { name: "Танки", when: "Три танка", changes }]);
  });
  test("a blank intro becomes null and points are trimmed", () => {
    const tips = structuredClone(ahri.tips);
    tips.early = { intro: "  ", points: [" Пункт один. "] };
    expect(normalize({ ...ahri, tips }, dict).tips.early).toEqual({ intro: null, points: ["Пункт один."] });
  });
});

describe("misc", () => {
  test("patch label uses the table and refuses unknown majors", () => {
    expect(patchLabel("16.23.1")).toBe("26.23");
    expect(() => patchLabel("17.1.1")).toThrow(/PATCH_MAJOR/);
  });
  test("plain strips Riot markup", () => {
    expect(plain("<mainText><stats><attention>12</attention> брони<br>5 ед.</stats></mainText>&nbsp;x")).toBe("12 брони\n5 ед. x");
  });
  test("item text marks effect names for bold", () => {
    const html = "<mainText><stats><attention>60</attention> силы умений</stats><br><br><passive>Мучения</passive><br>Поджигает.<br><br><active><b>Рывок</b></active> вперёд.</mainText>";
    expect(itemText(html)).toBe("60 силы умений\n\n**Мучения**\nПоджигает.\n\n**Рывок** вперёд.");
  });
});
