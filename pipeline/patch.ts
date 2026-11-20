import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIST, LANG, MODE } from "./config";
import { dictionaryPath, guidesDir, listGuides } from "./content";
import { COMPLETE, ddragonDir, loadData } from "./ddragon";
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

/** True when the release names the newest local pack and neither Riot data nor a guide changed after that pack was built. */
async function published(version: string): Promise<boolean> {
  const latestPath = join(DIST, MODE, LANG, latestName());
  if (!existsSync(latestPath)) return false;
  const builtAt = statSync(latestPath).mtimeMs;
  const sources = [join(ddragonDir(version), COMPLETE), dictionaryPath(), ...readdirSync(guidesDir()).map((f) => join(guidesDir(), f))];
  if (sources.some((p) => statSync(p).mtimeMs > builtAt)) return false;
  return (await publishedVersion()) === JSON.parse(readFileSync(latestPath, "utf8")).version;
}

/** The one command after a patch: new Riot data, early stale labels, new guides, final pack. */
export async function patch(log = console.log) {
  const { version, changed } = await sync(log);
  // Champions without a guide for this version, the same set `generate` works through.
  const current = new Map(listGuides().map((g) => [g.champion, g.ddragon]));
  const todo = Object.keys(loadData(version).champions).filter((c) => current.get(c) !== version).length;
  const named = () => listGuides().some((g) => g.situations.some((s) => "name" in s));
  let stopped = false;
  if (!changed && todo === 0) {
    if (!named() && (await published(version))) {
      log("Новых данных Riot нет, все гайды актуальны и опубликованы. Если патч уже вышел, Data Dragon может отставать до пары дней.");
      return;
    }
    // An earlier run generated guides but stopped before the dictionary or the upload.
    log("Гайды актуальны, но последний пакет не собран или не опубликован. Доделываю.");
  } else {
    // Publishing before generation lets phones show «Гайд для …» and removed items while it runs.
    // A run that stopped after sync but before this upload, or a separate `sync`, gets it here too.
    if (changed || !(await published(version))) await packAndPublish(log);
    stopped = Boolean((await generate({}, log)).stopped);
  }
  // After a limit stop the dictionary agent would hit the same limit; named situations pack as they are.
  if (!stopped && named()) await situations(log);
  await packAndPublish(log);
  if (stopped) log("Генерация остановилась на лимите подписки. Запустите `bun pipeline patch` позже — она продолжит.");
}
