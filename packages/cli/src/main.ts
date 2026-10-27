#!/usr/bin/env bun

import { hasDaemonLaunchEnvironment } from "@lorelum/backend/config";
import { sessionRefSchema } from "@lorelum/backend/client";
import { createProgram, type CliRuntime } from "./create-program.js";
import {
  createHookEndpoint,
  hookStartEvents,
  parseHookInvocation,
  type HookServiceOverrides,
} from "./hook/command.js";
import { runHook } from "./hook/runner.js";
import type { TextInput } from "./hook/types.js";
import { resolveOutputFormat } from "./output/format-selection.js";
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
import { configurationFailureFrom } from "./runtime/config-failure.js";
import { createProcessLogRuntime } from "./log/runtime.js";
import { createTraceId, noopEmitter, type TraceId } from "@lorelum/log";
import { toolVersion } from "./output/protocol.js";
import {
  createAutoUpdateService,
  runAutoUpdateWorker,
  type AutoUpdateService,
} from "./update/auto-check.js";

export interface RunOptions {
  /** Complete registry replacement; omit to use the immutable built-in `commandRegistry`. */
  registry?: readonly CommandDefinition[];
  /** Prebuilt runtime override; omit to use the process stderr-backed runtime. */
  runtime?: CliRuntime;
  /** Override the raw Hook input stream in source-level tests. */
  stdin?: TextInput;
  /** Override shared dependencies at the Hook composition boundary. */
  hookServices?: Partial<HookServiceOverrides>;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
  /** Source-test override; production calls always create a fresh invocation trace. */
  traceId?: TraceId;
  /** Source-test override for a private, disposable managed log root. */
  logDirectory?: string;
  /** Local update sidecar override; no network request runs in this process. */
  autoUpdate?: AutoUpdateService;
  /** Source-test override for command-local Agent session association. */
  environment?: Readonly<Record<string, string | undefined>>;
}

/** Executes one argv invocation and owns its single protocol response and exit code. */
export async function run(arguments_: string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const traceId = options.traceId ?? createTraceId();
  const hook = parseHookInvocation(arguments_);
  if (hook !== undefined) {
    const runtime = await createProcessLogRuntime(stderr, traceId, {
      debug: hook.debug ?? false,
      source: "hook",
      host: hook.host,
      ...(options.logDirectory === undefined ? {} : { rootDirectory: options.logDirectory }),
      persist:
        (options.stdout === undefined && options.stderr === undefined) ||
        options.logDirectory !== undefined,
    });
    try {
      runtime.log.info("hook.started", { event: hookStartEvents[hook.host] });
      return await runHook(
        createHookEndpoint(hook.host, options.hookServices, hook.storeRoot, runtime.log),
        {
          host: hook.host,
          stdin: options.stdin ?? standardInput,
          stdout,
          stderr,
          log: runtime.log,
        },
      );
    } finally {
      await runtime.flush();
    }
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
          persist:
            (options.stdout === undefined && options.stderr === undefined) ||
            options.logDirectory !== undefined,
        })
      : undefined;
  const runtime = options.runtime ?? processRuntime;
  if (runtime === undefined) throw new Error("CLI runtime was not constructed.");
  const diagnostics = runtime.diagnostics ?? noopEmitter;
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
        diagnostics: { traceId },
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
        async updateNotice(name, format, commandOptions) {
          if (!agentUpdateCommands.has(name)) return undefined;
          // Use the parsed option so keyword never enters the automatic sidecar.
          if (name === "query" && commandOptions.mode === "keyword") return undefined;
          const environment = options.environment ?? process.env;
          const session = sessionRefSchema.safeParse({
            hostKey: environment.LORELUM_HOST_KEY,
            sessionId: environment.LORELUM_HOST_SESSION_ID,
          });
          if (!session.success) return undefined;
          return (
            options.autoUpdate ??
            createAutoUpdateService(
              runtime.readConfig === undefined ? {} : { readConfig: runtime.readConfig },
            )
          ).poll(format === "text");
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
    await processRuntime?.flush();
    return commandExitCode;
  } catch (error) {
    const cliError = toVisibleCliError(error, visibleErrorCodes, command);
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
    await processRuntime?.flush({
      terminalConfigFailure:
        cliError.code === "runtime.unexpected" ? undefined : configurationFailureFrom(error),
    });
    renderResult(outputFormat === "json" ? stdout : stderr, outputFormat, {
      kind: "failure",
      command,
      code: cliError.code,
      message: cliError.message,
      ...(cliError.resource === undefined ? {} : { resource: cliError.resource }),
      diagnostics: { traceId },
    });
    return cliError.exitCode;
  }
}

const standardInput: TextInput = {
  text: () => Bun.stdin.text(),
};

const agentUpdateCommands: ReadonlySet<string> = new Set(["query", "get", "list", "pack.list"]);

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (await runAutoUpdateWorker(args)) {
    // The private, finite worker owns its own network deadline and has no output.
  } else if (isInternalBackendDaemonLaunch(args)) {
    const { currentBuildInfo } = await import("@lorelum/backend/control");
    const { runBackendDaemon } = await import("@lorelum/backend/daemon");
    await runBackendDaemon({ build: await currentBuildInfo(import.meta.path, toolVersion) });
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
