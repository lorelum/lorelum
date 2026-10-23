import { fileURLToPath } from "node:url";
import { synchronizeGuidance, type GuidanceMode } from "./artifacts.ts";

const usage = "Usage: bun run skills:generate | bun run skills:check";

export function parseGuidanceMode(args: readonly string[]): GuidanceMode {
  if (args.length !== 1) {
    throw new Error(`${usage}\nChoose exactly one of --write or --check.`);
  }
  if (args[0] === "--write") return "write";
  if (args[0] === "--check") return "check";
  throw new Error(`${usage}\nUnknown argument: ${args[0] ?? ""}.`);
}

export async function runGenerateCommand(args: readonly string[]): Promise<number> {
  let mode: GuidanceMode;
  try {
    mode = parseGuidanceMode(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  try {
    const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
    const paths = await synchronizeGuidance({ repositoryRoot, mode });
    if (mode === "check") {
      if (paths.length > 0) {
        console.error(paths.join("\n"));
        console.error("Run `bun run skills:generate` and commit the generated artifacts.");
        return 1;
      }
      console.info("Skill guidance artifacts are up to date.");
      return 0;
    }

    console.info(`Generated ${paths.length} Skill guidance files.`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await runGenerateCommand(process.argv.slice(2));
}
