import { generate } from "./generate";
import { pack } from "./pack";
import { sync } from "./sync";

const [cmd, ...args] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const has = (name: string) => args.includes(`--${name}`);

const commands: Record<string, () => Promise<unknown>> = {
  sync: () => sync(),
  generate: () =>
    generate({
      only: flag("only")?.split(",").map((s) => s.trim()).filter(Boolean),
      force: has("force"),
      limit: flag("limit") ? Number(flag("limit")) : undefined,
    }),
  pack: () => pack(),
};

const run = commands[cmd ?? ""];
if (!run) {
  console.log(`Команды: ${Object.keys(commands).join(", ")}`);
  process.exit(cmd ? 1 : 0);
}
try {
  await run();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
