#!/usr/bin/env bun

import { hasDaemonLaunchEnvironment } from "@lorelum/backend/config";
import { createProgram, type CliRuntime } from "./create-program.js";
import { renderFailure, type OutputWriter } from "./output/protocol.js";
import { rootCommand, type CommandDefinition, type KnownCommand } from "./registry.js";
import { toVisibleCliError } from "./runtime/errors.js";
import { Logger } from "./runtime/logger.js";

export interface RunOptions {
  /** Complete registry replacement; omit to use the immutable built-in `commandRegistry`. */
  registry?: readonly CommandDefinition[];
  /** Prebuilt runtime override; omit to use the process stderr-backed runtime. */
  runtime?: CliRuntime;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

/** Executes one argv invocation and owns its single protocol response and exit code. */
export async function run(arguments_: string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let command: KnownCommand | "unknown" = "unknown";
  let commandExitCode: 0 | 1 = 0;
  let visibleErrorCodes = rootCommand.errorCodes;

  try {
    const runtime = options.runtime ?? { logger: new Logger(stderr) };
    const program = createProgram(
      runtime,
      stdout,
      {
        selectCommand(definition) {
          command = definition.name as KnownCommand;
          visibleErrorCodes = definition.errorCodes;
        },
        setExitCode(exitCode) {
          commandExitCode = exitCode;
        },
      },
      options.registry,
    );
    await program.parseAsync(arguments_, { from: "user" });
    return commandExitCode;
  } catch (error) {
    const cliError = toVisibleCliError(error, visibleErrorCodes);
    renderFailure(stdout, command, cliError.code, cliError.message);
    return cliError.exitCode;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (isInternalBackendDaemonLaunch(args)) {
    const { currentBuildIdentity } = await import("@lorelum/backend/control");
    const { runBackendDaemon } = await import("@lorelum/backend/daemon");
    await runBackendDaemon({ buildIdentity: await currentBuildIdentity(import.meta.path) });
  } else {
    process.exitCode = await run(args);
  }
}

export function isInternalBackendServeInvocation(args: readonly string[]): boolean {
  return args.length === 1 && args[0] === "--internal-backend-serve";
}
export function isInternalBackendDaemonLaunch(
  args: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
): boolean {
  return isInternalBackendServeInvocation(args) && hasDaemonLaunchEnvironment(environment);
}
