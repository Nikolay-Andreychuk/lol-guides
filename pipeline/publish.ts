import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIST, LANG, MODE } from "./config";
import { latestName } from "./pack";

export const RELEASE_TAG = "content";

async function gh(args: string[], allowFail = false): Promise<string> {
  const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0 && !allowFail) throw new Error(`gh ${args.slice(0, 3).join(" ")}: ${err.trim().slice(0, 300)}`);
  return code === 0 ? out : "";
}

/**
 * Uploads the newest pack, then replaces the pointer file, so the app never sees a
 * pointer to a pack that is not there yet. The previous pack stays for rollback.
 */
export async function publish(log = console.log) {
  const dir = join(DIST, MODE, LANG);
  const latestPath = join(dir, latestName());
  if (!existsSync(latestPath)) throw new Error("Нет собранного пакета. Сначала `bun pipeline pack`.");
  const latest = JSON.parse(readFileSync(latestPath, "utf8")) as { file: string; version: number };
  const zip = join(dir, latest.file);

  const repo = (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], true)).trim();
  if (!repo) throw new Error("Репозиторий GitHub не настроен (gh repo view не нашёл его). Публикация пропущена.");
  if (!(await gh(["release", "view", RELEASE_TAG, "--json", "tagName"], true))) {
    await gh(["release", "create", RELEASE_TAG, "--title", "Гайды (данные)", "--notes", "Пакеты гайдов для приложения. Обновляются после патчей.", "--latest=false"]);
  }
  log(`Загружаю ${latest.file}…`);
  await gh(["release", "upload", RELEASE_TAG, zip, "--clobber"]);
  await gh(["release", "upload", RELEASE_TAG, latestPath, "--clobber"]);

  // Keep the current pack and the one before it; older ones only take space.
  const assets = (await gh(["release", "view", RELEASE_TAG, "--json", "assets", "--jq", ".assets[].name"])).split("\n").filter(Boolean);
  const packs = assets.filter((a) => a.startsWith(`pack-${MODE}-${LANG}-`) && a.endsWith(".zip")).sort();
  for (const old of packs.slice(0, Math.max(0, packs.length - 2))) await gh(["release", "delete-asset", RELEASE_TAG, old, "--yes"]);

  log(`Опубликовано: ${latest.file} (версия ${latest.version}) в ${repo}, выпуск «${RELEASE_TAG}».`);
}

/** Version named by the release's pointer file, or null when nothing is published or gh fails. */
export async function publishedVersion(): Promise<number | null> {
  const out = await gh(["release", "download", RELEASE_TAG, "-p", latestName(), "-O", "-"], true);
  try {
    return Number(JSON.parse(out).version) || null;
  } catch {
    return null;
  }
}
