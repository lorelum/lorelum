import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

export const workspaceTypecheckConfigs = [
  "packages/backend/tsconfig.json",
  "packages/cli/tsconfig.json",
  "packages/config/tsconfig.json",
  "packages/engine/tsconfig.json",
  "packages/format/tsconfig.json",
  "packages/log/tsconfig.json",
  "packages/mcp/tsconfig.json",
  "packages/shared/tsconfig.json",
  "packages/ui/tsconfig.json",
  "apps/site/tsconfig.json",
  "plugins/pi/lorelum/tsconfig.json",
] as const;

export const releaseTypecheckConfig = "scripts/release/tsconfig.json";

type CommandRunner = (command: readonly string[]) => Promise<number>;

interface TypecheckOptions {
  readonly maxWorkers?: number;
  readonly repositoryRoot?: string;
  readonly runCommand?: CommandRunner;
}

export function resolveTypecheckWorkers(value: string | undefined): number {
  if (value === undefined || value === "") return workspaceTypecheckConfigs.length;

  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1)
    throw new Error("LORELUM_TYPECHECK_WORKERS must be a positive integer");

  return Math.min(workers, workspaceTypecheckConfigs.length);
}

export function typecheckCommand(
  config: string,
  root = repositoryRoot,
): readonly [string, "--noEmit", "-p", string] {
  return [join(root, "node_modules", ".bin", "tsc"), "--noEmit", "-p", config];
}

async function runNativeTsc(command: readonly string[]): Promise<number> {
  try {
    const child = Bun.spawn([...command], {
      cwd: repositoryRoot,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await child.exited;
  } catch (error) {
    console.error(error);
    return 1;
  }
}

/**
 * Run every CI typecheck config with the root native tsc, never a workspace-local binary.
 *
 * The default preserves the current workspace fan-out. `LORELUM_TYPECHECK_WORKERS` exists
 * solely for controlled benchmark runs until GitHub timing evidence selects a production cap.
 */
export async function runTypecheck(options: TypecheckOptions = {}): Promise<number> {
  const root = options.repositoryRoot ?? repositoryRoot;
  const runCommand = options.runCommand ?? runNativeTsc;
  const maxWorkers =
    options.maxWorkers ?? resolveTypecheckWorkers(process.env.LORELUM_TYPECHECK_WORKERS);
  let nextConfig = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const config = workspaceTypecheckConfigs[nextConfig++];
      if (config === undefined) return;
      // eslint-disable-next-line no-await-in-loop -- a worker must wait for its assigned compiler before taking another config.
      if ((await runCommand(typecheckCommand(config, root))) !== 0) failed = true;
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, worker));
  if (failed) return 1;
  return runCommand(typecheckCommand(releaseTypecheckConfig, root));
}

if (import.meta.main) process.exit(await runTypecheck());
