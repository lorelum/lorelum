#!/usr/bin/env bun

import { hasDaemonLaunchEnvironment } from "@lorelum/backend/config";
import type { LoadConfigOptions } from "@lorelum/config";
import { createProgram, type CliRuntime } from "./create-program.js";
import {
  parseCodexHookInvocation,
  runCodexHook,
  type CodexHookServices,
  type TextInput,
} from "./hook/codex.js";
import {
  parseCursorHookInvocation,
  runCursorHook,
  type CursorHookServices,
} from "./hook/cursor.js";
import {
  parseWorkbuddyHookInvocation,
  runWorkbuddyHook,
  type WorkbuddyHookServices,
} from "./hook/workbuddy.js";
import { parseZcodeHookInvocation, runZcodeHook, type ZcodeHookServices } from "./hook/zcode.js";
import { resolveOutputFormat } from "./output/format-selection.js";
import { composeDiagnostics } from "./output/notices.js";
import { renderHelpText } from "./output/presentation.js";
import { renderResult, type OutputFormat } from "./output/render.js";
import type { OutputWriter } from "./output/protocol.js";
import {
  commandRegistry,
  describeCommand,
  rootCommand,
  snapshotCommandDefinitions,
  type CommandDefinition,
  type KnownCommand,
} from "./registry.js";
import { toVisibleCliError } from "./runtime/errors.js";
import { createProcessLogRuntime } from "./log/runtime.js";
import { createTraceId, noopEmitter, type TraceId } from "@lorelum/log";

export interface RunOptions {
  /** Complete registry replacement; omit to use the immutable built-in `commandRegistry`. */
  registry?: readonly CommandDefinition[];
  /** Prebuilt runtime override; omit to use the process stderr-backed runtime. */
  runtime?: CliRuntime;
  /** Override the raw Codex Hook input stream in source-level tests. */
  stdin?: TextInput;
  /** Override the raw Codex Hook Store adapter in source-level tests. */
  codexHookServices?: CodexHookServices;
  /** Override the raw ZCode Hook Store adapter in source-level tests. */
  zcodeHookServices?: ZcodeHookServices;
  /** Override the raw Cursor Hook Store adapter in source-level tests. */
  cursorHookServices?: CursorHookServices;
  /** Override the raw WorkBuddy Hook Store adapter in source-level tests. */
  workbuddyHookServices?: WorkbuddyHookServices;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
  /** Source-test override; production calls always create a fresh invocation trace. */
  traceId?: TraceId;
  /** Source-test override for a private, disposable managed log root. */
  logDirectory?: string;
  /** Source-test override for the persistent config location; production reads the real home. */
  configOptions?: LoadConfigOptions;
}

/** Executes one argv invocation and owns its single protocol response and exit code. */
export async function run(arguments_: string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const traceId = options.traceId ?? createTraceId();
  const codexHook = parseCodexHookInvocation(arguments_);
  if (codexHook !== undefined) {
    const runtime = await createProcessLogRuntime(stderr, traceId, {
      debug: codexHook.debug ?? false,
      source: "hook",
      host: "codex",
      ...(options.logDirectory === undefined ? {} : { rootDirectory: options.logDirectory }),
      ...(options.configOptions === undefined ? {} : { configOptions: options.configOptions }),
      persist:
        (options.stdout === undefined && options.stderr === undefined) ||
        options.logDirectory !== undefined,
    });
    runtime.log.info("hook.started", { event: "SessionStart" });
    const exitCode = await runCodexHook({
      stdin: options.stdin ?? standardInput,
      stdout,
      stderr,
      ...(options.codexHookServices === undefined ? {} : { services: options.codexHookServices }),
      ...(codexHook.storeRoot === undefined ? {} : { storeRoot: codexHook.storeRoot }),
      log: runtime.log,
    });
    await runtime.flush();
    return exitCode;
  }
  const zcodeHook = parseZcodeHookInvocation(arguments_);
  if (zcodeHook !== undefined) {
    const runtime = await createProcessLogRuntime(stderr, traceId, {
      debug: zcodeHook.debug ?? false,
      source: "hook",
      host: "zcode",
      ...(options.logDirectory === undefined ? {} : { rootDirectory: options.logDirectory }),
      ...(options.configOptions === undefined ? {} : { configOptions: options.configOptions }),
      persist:
        (options.stdout === undefined && options.stderr === undefined) ||
        options.logDirectory !== undefined,
    });
    runtime.log.info("hook.started", { event: "SessionStart" });
    const exitCode = await runZcodeHook({
      stdin: options.stdin ?? standardInput,
      stdout,
      stderr,
      ...(options.zcodeHookServices === undefined ? {} : { services: options.zcodeHookServices }),
      ...(zcodeHook.storeRoot === undefined ? {} : { storeRoot: zcodeHook.storeRoot }),
      log: runtime.log,
    });
    await runtime.flush();
    return exitCode;
  }
  const cursorHook = parseCursorHookInvocation(arguments_);
  if (cursorHook !== undefined) {
    const runtime = await createProcessLogRuntime(stderr, traceId, {
      debug: cursorHook.debug ?? false,
      source: "hook",
      host: "cursor",
      ...(options.logDirectory === undefined ? {} : { rootDirectory: options.logDirectory }),
      ...(options.configOptions === undefined ? {} : { configOptions: options.configOptions }),
      persist:
        (options.stdout === undefined && options.stderr === undefined) ||
        options.logDirectory !== undefined,
    });
    runtime.log.info("hook.started", { event: "sessionStart" });
    const exitCode = await runCursorHook({
      stdin: options.stdin ?? standardInput,
      stdout,
      stderr,
      ...(options.cursorHookServices === undefined ? {} : { services: options.cursorHookServices }),
      ...(cursorHook.storeRoot === undefined ? {} : { storeRoot: cursorHook.storeRoot }),
      log: runtime.log,
    });
    await runtime.flush();
    return exitCode;
  }
  const workbuddyHook = parseWorkbuddyHookInvocation(arguments_);
  if (workbuddyHook !== undefined) {
    const runtime = await createProcessLogRuntime(stderr, traceId, {
      debug: workbuddyHook.debug ?? false,
      source: "hook",
      host: "workbuddy",
      ...(options.logDirectory === undefined ? {} : { rootDirectory: options.logDirectory }),
      ...(options.configOptions === undefined ? {} : { configOptions: options.configOptions }),
      persist:
        (options.stdout === undefined && options.stderr === undefined) ||
        options.logDirectory !== undefined,
    });
    runtime.log.info("hook.started", { event: "SessionStart" });
    const exitCode = await runWorkbuddyHook({
      stdin: options.stdin ?? standardInput,
      stdout,
      stderr,
      ...(options.workbuddyHookServices === undefined
        ? {}
        : { services: options.workbuddyHookServices }),
      ...(workbuddyHook.storeRoot === undefined ? {} : { storeRoot: workbuddyHook.storeRoot }),
      log: runtime.log,
    });
    await runtime.flush();
    return exitCode;
  }
  const invocationId = crypto.randomUUID();
  const startedAt = Date.now();
  let command: KnownCommand | "unknown" = "unknown";
  let commandExitCode: 0 | 1 = 0;
  let outputFormat: OutputFormat = "text";
  let visibleErrorCodes = rootCommand.errorCodes;

  const processRuntime =
    options.runtime === undefined
      ? await createProcessLogRuntime(stderr, traceId, {
          debug: arguments_.includes("--debug"),
          ...(options.logDirectory === undefined ? {} : { rootDirectory: options.logDirectory }),
          ...(options.configOptions === undefined ? {} : { configOptions: options.configOptions }),
          persist:
            (options.stdout === undefined && options.stderr === undefined) ||
            options.logDirectory !== undefined,
        })
      : undefined;
  const runtime = options.runtime ?? processRuntime;
  if (runtime === undefined) throw new Error("CLI runtime was not constructed.");
  const diagnostics = runtime.diagnostics ?? noopEmitter;
  runtime.log?.info("command.started", { invocationId });
  if (arguments_.includes("--debug")) runtime.log?.debug("command.debug-enabled", { invocationId });
  diagnostics.emit({
    time: new Date().toISOString(),
    level: "info",
    component: "cli",
    event: "cli.command.started",
    traceId,
    invocationId,
  });
  try {
    const definitions = snapshotCommandDefinitions(options.registry ?? commandRegistry);
    const selection = resolveOutputFormat(arguments_, definitions);
    if (selection.definition !== rootCommand || selection.response !== undefined) {
      command = selection.commandName as KnownCommand | "unknown";
    }
    outputFormat = selection.format;
    visibleErrorCodes = selection.definition?.errorCodes ?? rootCommand.errorCodes;
    if (
      selection.helpRequested &&
      selection.helpCanBypassArgumentValidation &&
      selection.response === undefined &&
      selection.definition !== undefined
    ) {
      const data = describeCommand(selection.definition.name, definitions);
      if (data === undefined) throw new Error("Selected command description is missing.");
      renderResult(stdout, outputFormat, {
        kind: "success",
        command: "describe",
        data,
        textRenderer: renderHelpText,
        diagnostics: composeDiagnostics(traceId, runtime.notices),
      });
      diagnostics.emit({
        time: new Date().toISOString(),
        level: "info",
        component: "cli",
        event: "cli.command.completed",
        traceId,
        invocationId,
        command,
        durationMs: Date.now() - startedAt,
        exitCode: 0,
      });
      runtime.log?.info("command.completed", {
        invocationId,
        command,
        durationMs: Date.now() - startedAt,
        exitCode: 0,
      });
      await processRuntime?.flush();
      return 0;
    }
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
      definitions,
      outputFormat,
      traceId,
    );
    await program.parseAsync(arguments_, { from: "user" });
    diagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "cli",
      event: "cli.command.completed",
      traceId,
      invocationId,
      command,
      durationMs: Date.now() - startedAt,
      exitCode: commandExitCode,
    });
    runtime.log?.info("command.completed", {
      invocationId,
      command,
      durationMs: Date.now() - startedAt,
      exitCode: commandExitCode,
    });
    await processRuntime?.flush();
    return commandExitCode;
  } catch (error) {
    const cliError = toVisibleCliError(error, visibleErrorCodes);
    diagnostics.emit({
      time: new Date().toISOString(),
      level: "info",
      component: "cli",
      event: "cli.command.completed",
      traceId,
      invocationId,
      command,
      durationMs: Date.now() - startedAt,
      exitCode: cliError.exitCode,
      code: cliError.code,
    });
    runtime.log?.error(
      "command.failed",
      {
        invocationId,
        command,
        durationMs: Date.now() - startedAt,
        exitCode: cliError.exitCode,
        code: cliError.code,
      },
      error,
    );
    await processRuntime?.flush();
    renderResult(outputFormat === "json" ? stdout : stderr, outputFormat, {
      kind: "failure",
      command,
      code: cliError.code,
      message: cliError.message,
      ...(cliError.recovery === undefined ? {} : { recovery: cliError.recovery }),
      diagnostics: composeDiagnostics(traceId, runtime.notices),
    });
    return cliError.exitCode;
  }
}

const standardInput: TextInput = {
  text: () => Bun.stdin.text(),
};

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
