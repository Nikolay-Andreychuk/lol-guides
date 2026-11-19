import { patchLabel } from "./config";
import { describeVersion, downloadVersion, hasData, latestVersion, loadData } from "./ddragon";
import { eligibleItems, iconList, loadMode } from "./catalog";

export async function sync(log = console.log): Promise<{ version: string; changed: boolean }> {
  const latest = await latestVersion();
  patchLabel(latest); // stops on an unknown major version before anything is downloaded
  const mode = loadMode();
  if (hasData(latest)) {
    log(`Данные Riot ${describeVersion(latest)} уже скачаны.`);
    warnUnreviewed(latest, log);
    return { version: latest, changed: false };
  }
  log(`Скачиваю данные Riot ${describeVersion(latest)}…`);
  await downloadVersion(latest, (d) => iconList(d, mode), log);
  log(`Готово: ${describeVersion(latest)}.`);
  warnUnreviewed(latest, log);
  return { version: latest, changed: true };
}

function warnUnreviewed(version: string, log: (s: string) => void) {
  const data = loadData(version);
  const { unreviewed } = eligibleItems(data, loadMode());
  if (unreviewed.length === 0) return;
  log("Внимание: новые предметы, которые есть только на карте режима. Пока они не предлагаются агенту.");
  for (const id of unreviewed) log(`  ${id} ${data.items[id].name}`);
  log("Проверьте их и добавьте в itemReview в content/aram/mode.json (\"include: …\" или \"exclude: …\").");
}
