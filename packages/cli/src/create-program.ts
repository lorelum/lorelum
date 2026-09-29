import { Argument, Command, Option } from "commander";

import { renderHelpText } from "./output/presentation.js";
import { renderResult, type OutputFormat } from "./output/render.js";
import type { OutputWriter } from "./output/protocol.js";
import {
  commandOptionAppliesTo,
  commandOptionKey,
  commandOptionDeclaration,
  commandRegistry,
  describeCommand,
  discoveryCommandName,
  positionalValues,
  requireCommandDescription,
  type CommandOption,
  type CommandDefinition,
  type DescribeCommand,
  rootCommand,
  snapshotCommandDefinitions,
} from "./registry.js";
import { invalidInvocationError } from "./runtime/errors.js";
import { Logger, logLevels, type LogLevel } from "./runtime/logger.js";
import {
  createTraceId,
  type LogEmitter,
  type Logger as LocalLogger,
  type TraceId,
} from "@lorelum/log";

export interface CliRuntime {
  /** Runtime capabilities are constructed before Commander parses an invocation. */
  readonly logger: Logger;
  /** Persistent generic local logger; stderr presentation stays on `logger`. */
  readonly log?: LocalLogger;
  readonly diagnostics?: LogEmitter;
  readonly logDirectory?: string;
}

/** Internal callbacks that let `run` own selected-command and process-exit state. */
export interface ProgramLifecycle {
  selectCommand(definition: CommandDefinition): void;
  setExitCode(code: 1): void;
}

/** Builds a parser from one complete registry snapshot; `run` owns failure rendering. */
export function createProgram(
  runtime: CliRuntime,
  output: OutputWriter,
  lifecycle: ProgramLifecycle,
  registryDefinitions: readonly CommandDefinition[] = commandRegistry,
  outputFormat: OutputFormat = "text",
  traceId: TraceId = createTraceId(),
): Command {
  const registry = snapshotCommandDefinitions(registryDefinitions);
  const describeFromRegistry: DescribeCommand = (command) => describeCommand(command, registry);
  const program = new Command();

  program
    .name(rootCommand.name)
    .description(rootCommand.summary)
    .helpOption(false)
    .helpCommand(false)
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .exitOverride()
    .hook("preAction", () => {
      runtime.logger.setLevel(parsedLogLevel(program));
    })
    .action(() =>
      executeCommand(
        rootCommand,
        program,
        [],
        output,
        lifecycle,
        describeFromRegistry,
        discoveryCommandName,
        outputFormat,
        traceId,
        runtime.diagnostics,
        runtime.log,
        runtime.logDirectory,
      ),
    );

  for (const option of rootCommand.options) {
    program.addOption(toCommanderOption(option, rootCommand.name));
  }

  const commands = new Map<string, Command>();
  for (const definition of registry) {
    const command = commandForDefinition(program, commands, definition);
    command.description(definition.summary);
    for (const positional of definition.positionals) {
      const argument = new Argument(
        positional.required ? `<${positional.name}>` : `[${positional.name}]`,
      );
      const values = positionalValues(definition, positional, registry);
      if (values !== undefined) {
        argument.choices([...values]).argParser((value: string) => {
          if (!values.includes(value))
            throw invalidChoiceError(`<${positional.name}>`, values, definition.name);
          return value;
        });
      }
      command.addArgument(argument);
    }
    for (const option of definition.options) {
      command.addOption(toCommanderOption(option, definition.name));
    }
    command.action(async (...arguments_: unknown[]) => {
      const commandInstance = arguments_.at(-1);
      if (!(commandInstance instanceof Command)) {
        throw new Error("Commander did not provide the command context.");
      }
      await executeCommand(
        definition,
        commandInstance,
        arguments_
          .slice(0, -1)
          .filter((argument): argument is string => typeof argument === "string"),
        output,
        lifecycle,
        describeFromRegistry,
        definition.name,
        outputFormat,
        traceId,
        runtime.diagnostics,
        runtime.log,
        runtime.logDirectory,
      );
    });
  }

  return program;
}

async function executeCommand(
  definition: CommandDefinition,
  command: Command,
  positionals: string[],
  output: OutputWriter,
  lifecycle: ProgramLifecycle,
  describeFromRegistry: DescribeCommand,
  responseCommand: string,
  outputFormat: OutputFormat,
  traceId: TraceId,
  diagnostics: LogEmitter | undefined,
  log: LocalLogger | undefined,
  logDirectory: string | undefined,
): Promise<void> {
  lifecycle.selectCommand(definition);
  const helpOption = enabledFrameworkOption(command, definition, "help");
  const versionOption = enabledFrameworkOption(command, definition, "version");

  if (helpOption !== undefined && versionOption !== undefined) {
    throw invalidInvocationError("Use --help or --version, not both.");
  }
  if (versionOption !== undefined) {
    const response = versionOption.response;
    if (response === undefined) throw new Error("The version registry response is missing.");
    renderResult(output, outputFormat, {
      kind: "success",
      command: response.command,
      data: response.data,
      ...(response.textRenderer === undefined ? {} : { textRenderer: response.textRenderer }),
      diagnostics: { traceId },
    });
    return;
  }
  if (helpOption !== undefined) {
    renderResult(output, outputFormat, {
      kind: "success",
      command: discoveryCommandName,
      data: requireCommandDescription(describeFromRegistry, definition.name),
      textRenderer: renderHelpText,
      diagnostics: { traceId },
    });
    return;
  }
  assertApplicableFrameworkOptions(command, definition);
  for (const option of definition.options) {
    if (option.optionRequired && !hasParsedOption(command, option)) {
      throw invalidInvocationError(
        `${option.longFlag} is required for lore ${definition.name.replaceAll(".", " ")}.`,
      );
    }
  }

  const result = await definition.handler({
    options: command.optsWithGlobals(),
    positionals,
    describeCommand: describeFromRegistry,
    traceId,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(log === undefined ? {} : { log }),
    ...(logDirectory === undefined ? {} : { logDirectory }),
  });
  const exitCode = result.exitCode ?? 0;
  if (!definition.exitCodes.includes(exitCode)) {
    throw new Error(`Command "${definition.name}" returned undeclared exit code ${exitCode}.`);
  }
  renderResult(output, outputFormat, {
    kind: "success",
    command: responseCommand,
    data: result.data,
    ...(definition.textRenderer === undefined ? {} : { textRenderer: definition.textRenderer }),
    diagnostics: { traceId },
  });
  if (exitCode === 1) lifecycle.setExitCode(1);
}

function assertApplicableFrameworkOptions(command: Command, definition: CommandDefinition): void {
  for (const option of rootCommand.options) {
    if (
      option.scope !== "global" ||
      command.optsWithGlobals()[commandOptionKey(option)] === undefined
    ) {
      continue;
    }
    if (!commandOptionAppliesTo(option, definition))
      throw invalidInvocationError(
        `${option.longFlag} is not available for lore ${definition.name.replaceAll(".", " ")}.`,
      );
  }
}

function commandForDefinition(
  program: Command,
  commands: Map<string, Command>,
  definition: CommandDefinition,
): Command {
  const segments = definition.name.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Invalid command name: ${definition.name}`);
  }

  let parent = program;
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join(".");
    let command = commands.get(path);
    if (command === undefined) {
      command = parent.command(segments[index]!).helpOption(false).helpCommand(false);
      commands.set(path, command);
    }
    parent = command;
  }
  return parent;
}

function hasParsedOption(command: Command, option: CommandDefinition["options"][number]): boolean {
  const key = commandOptionKey(option);
  return command.optsWithGlobals()[key] !== undefined;
}

function toCommanderOption(option: CommandDefinition["options"][number], command: string): Option {
  const commanderOption = new Option(commandOptionDeclaration(option), option.description);
  if (option.values !== undefined) {
    const values = option.values;
    commanderOption.choices([...values]).argParser((value: string) => {
      if (!values.includes(value)) throw invalidChoiceError(option.longFlag, values, command);
      return value;
    });
  }
  if (option.defaultValue !== undefined) commanderOption.default(option.defaultValue);
  return commanderOption;
}

function invalidChoiceError(subject: string, values: readonly string[], command: string) {
  const choices = values.join(", ");
  if (choices.length <= 180)
    return invalidInvocationError(`${subject} must be one of: ${choices}.`);
  const help =
    command === rootCommand.name ? "lore --help" : `lore ${command.replaceAll(".", " ")} --help`;
  return invalidInvocationError(
    `${subject} must be an allowed value. Run ${help} to see valid choices.`,
  );
}

function frameworkOption(behavior: NonNullable<CommandOption["behavior"]>): CommandOption {
  const option = rootCommand.options.find((candidate) => candidate.behavior === behavior);
  if (option === undefined) throw new Error(`The ${behavior} registry option is missing.`);
  return option;
}

function enabledFrameworkOption(
  command: Command,
  definition: CommandDefinition,
  behavior: NonNullable<CommandOption["behavior"]>,
): CommandOption | undefined {
  const option = frameworkOption(behavior);
  if (command.optsWithGlobals()[commandOptionKey(option)] !== true) return undefined;
  if (!commandOptionAppliesTo(option, definition))
    throw invalidInvocationError(
      `${option.longFlag} is not available for lore ${definition.name.replaceAll(".", " ")}.`,
    );
  return option;
}

function parsedLogLevel(command: Command): LogLevel {
  const option = frameworkOption("log-level");
  const value = command.optsWithGlobals()[commandOptionKey(option)];
  if (typeof value !== "string" || !logLevels.includes(value as LogLevel)) {
    throw new Error("The log-level registry option is missing or invalid.");
  }
  return value as LogLevel;
}
