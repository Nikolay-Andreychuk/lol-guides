import type { Change, Slot } from "./types";

/**
 * Applies a situation's explicit changes to the base build. The only home of this
 * rule: validation uses it to check guides, `pack` uses it to ship ready builds.
 */
export function applyChanges(base: number[], changes: Change[]): { slots: Slot[]; errors: string[] } {
  const slots: Slot[] = base.map((item) => ({ item }));
  const errors: string[] = [];
  const moved = new Set<number>();
  for (const ch of changes) {
    if ("replace" in ch) {
      const i = slots.findIndex((s) => s.item === ch.replace);
      if (i < 0) {
        errors.push(`замена ${ch.replace} → ${ch.with}: предмета ${ch.replace} нет в сборке`);
        continue;
      }
      if (slots.some((s) => s.item === ch.with)) {
        errors.push(`замена ${ch.replace} → ${ch.with}: предмет ${ch.with} уже есть в сборке`);
        continue;
      }
      // A replacement of a replacement still says which base item left the slot.
      const original = slots[i].replaced ?? (base.includes(slots[i].item) ? slots[i].item : undefined);
      slots[i] = original === undefined ? { item: ch.with } : { item: ch.with, replaced: original };
    } else {
      const i = slots.findIndex((s) => s.item === ch.move);
      if (i < 0) {
        errors.push(`перенос ${ch.move}: предмета нет в сборке`);
        continue;
      }
      if (!Number.isInteger(ch.to) || ch.to < 1 || ch.to > slots.length) {
        errors.push(`перенос ${ch.move}: позиция ${ch.to} вне 1–${slots.length}`);
        continue;
      }
      const [s] = slots.splice(i, 1);
      slots.splice(ch.to - 1, 0, s);
      moved.add(ch.move);
    }
  }
  slots.forEach((s, i) => {
    if (s.replaced !== undefined || !moved.has(s.item)) return;
    const was = base.indexOf(s.item) + 1;
    if (was > 0 && was !== i + 1) s.usually = was;
  });
  return { slots, errors };
}
