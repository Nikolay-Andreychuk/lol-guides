import { listGuides } from "./content";
import { generate } from "./generate";
import { pack } from "./pack";
import { publish } from "./publish";
import { situations } from "./situations";
import { sync } from "./sync";

async function packAndPublish(log: (s: string) => void) {
  await pack(log);
  try {
    await publish(log);
  } catch (e) {
    log(`Публикация не удалась: ${e instanceof Error ? e.message : e}`);
  }
}

/** The one command after a patch: new Riot data, early stale labels, new guides, final pack. */
export async function patch(log = console.log) {
  const { version, changed } = await sync(log);
  const stale = listGuides().filter((g) => g.ddragon !== version).length;
  if (!changed && stale === 0) {
    log("Новых данных Riot нет, все гайды актуальны. Если патч уже вышел, Data Dragon может отставать до пары дней.");
    return;
  }
  // Publishing right after sync lets phones show «Гайд для …» and removed items while generation runs.
  if (changed) await packAndPublish(log);
  const r = await generate({}, log);
  if (listGuides().some((g) => g.situations.some((s) => "name" in s))) await situations(log);
  await packAndPublish(log);
  if (r.stopped) log("Генерация остановилась на лимите подписки. Запустите `bun pipeline patch` позже — она продолжит.");
}
