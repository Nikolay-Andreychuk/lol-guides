import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyChanges } from "../apply";
import { eligibleItems, plain, type ModeConfig } from "../catalog";
import { patchLabel } from "../config";
import type { DDData } from "../ddragon";
import { normalize } from "../generate";
import { resolveBuilds } from "../pack";
import type { Guide, GuideBody, SituationDef } from "../types";
import { nearMisses, officialNames, validateGuide } from "../validate";

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
    ["markup", (b) => (b.tips.early = "**Важно**: " + b.tips.early), /разметка/],
    ["link in text", (b) => (b.tips.mid += " https://example.com"), /ссылки/],
    ["runes", (b) => (b.tips.late += " Руны не важны."), /руны/],
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
    b.tips.versus = "Против Аатрокса держитесь дальше. Против Сораки бейте лекаря. Мисс Фортуне не стойте в линию.";
    const w = check(b).warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Аатрокса.*Атрокс/);
  });
});

describe("nearMisses", () => {
  const names = officialNames(data);
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

describe("misc", () => {
  test("patch label uses the table and refuses unknown majors", () => {
    expect(patchLabel("16.23.1")).toBe("26.23");
    expect(() => patchLabel("17.1.1")).toThrow(/PATCH_MAJOR/);
  });
  test("plain strips Riot markup", () => {
    expect(plain("<mainText><stats><attention>12</attention> брони<br>5 ед.</stats></mainText>&nbsp;x")).toBe("12 брони\n5 ед. x");
  });
});
