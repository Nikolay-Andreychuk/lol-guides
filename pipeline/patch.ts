import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIST, LANG, MODE } from "./config";
import { dictionaryPath, guidesDir, listGuides } from "./content";
import { loadData } from "./ddragon";
import { generate } from "./generate";
import { latestName, pack } from "./pack";
import { publish, publishedVersion } from "./publish";
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

/** True when the release names the newest local pack and no guide changed after that pack was built. */
async function published(): Promise<boolean> {
  const latestPath = join(DIST, MODE, LANG, latestName());
  if (!existsSync(latestPath)) return false;
  const builtAt = statSync(latestPath).mtimeMs;
  const sources = [dictionaryPath(), ...readdirSync(guidesDir()).map((f) => join(guidesDir(), f))];
  if (sources.some((p) => statSync(p).mtimeMs > builtAt)) return false;
  return (await publishedVersion()) === JSON.parse(readFileSync(latestPath, "utf8")).version;
}

/** The one command after a patch: new Riot data, early stale labels, new guides, final pack. */
export async function patch(log = console.log) {
  const { version, changed } = await sync(log);
  // Champions without a guide for this version, the same set `generate` works through.
  const current = new Map(listGuides().map((g) => [g.champion, g.ddragon]));
  const todo = Object.keys(loadData(version).champions).filter((c) => current.get(c) !== version).length;
  if (!changed && todo === 0) {
    if (await published()) {
      log("Новых данных Riot нет, все гайды актуальны и опубликованы. Если патч уже вышел, Data Dragon может отставать до пары дней.");
      return;
    }
    // An earlier run generated guides but its final upload failed or never ran.
    log("Гайды актуальны, но последний пакет не опубликован. Собираю и публикую.");
    await packAndPublish(log);
    return;
  }
  // Publishing right after sync lets phones show «Гайд для …» and removed items while generation runs.
  if (changed) await packAndPublish(log);
  const r = await generate({}, log);
  if (listGuides().some((g) => g.situations.some((s) => "name" in s))) await situations(log);
  await packAndPublish(log);
  if (r.stopped) log("Генерация остановилась на лимите подписки. Запустите `bun pipeline patch` позже — она продолжит.");
}
