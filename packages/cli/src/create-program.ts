import { Argument, Command, Option } from "commander";

import { renderSuccess, type OutputWriter } from "./output/protocol.js";
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

export interface CliRuntime {
  /** Runtime capabilities are constructed before Commander parses an invocation. */
  readonly logger: Logger;
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
      ),
    );

  for (const option of rootCommand.options) {
    program.addOption(toCommanderOption(option));
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
      if (values !== undefined) argument.choices([...values]);
      command.addArgument(argument);
    }
    for (const option of definition.options) {
      command.addOption(toCommanderOption(option));
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
): Promise<void> {
  lifecycle.selectCommand(definition);
  const helpOption = enabledFrameworkOption(command, definition, "help");
  const versionOption = enabledFrameworkOption(command, definition, "version");

  if (helpOption !== undefined && versionOption !== undefined) {
    throw invalidInvocationError();
  }
  if (versionOption !== undefined) {
    const response = versionOption.response;
    if (response === undefined) throw new Error("The version registry response is missing.");
    renderSuccess(output, response.command, response.data);
    return;
  }
  if (helpOption !== undefined) {
    renderSuccess(
      output,
      discoveryCommandName,
      requireCommandDescription(describeFromRegistry, definition.name),
    );
    return;
  }
  for (const option of definition.options) {
    if (option.optionRequired && !hasParsedOption(command, option)) {
      throw invalidInvocationError();
    }
  }

  const result = await definition.handler({
    options: command.optsWithGlobals(),
    positionals,
    describeCommand: describeFromRegistry,
  });
  const exitCode = result.exitCode ?? 0;
  if (!definition.exitCodes.includes(exitCode)) {
    throw new Error(`Command "${definition.name}" returned undeclared exit code ${exitCode}.`);
  }
  renderSuccess(output, responseCommand, result.data);
  if (exitCode === 1) lifecycle.setExitCode(1);
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

function toCommanderOption(option: CommandDefinition["options"][number]): Option {
  const commanderOption = new Option(commandOptionDeclaration(option), option.description);
  if (option.values !== undefined) commanderOption.choices([...option.values]);
  if (option.defaultValue !== undefined) commanderOption.default(option.defaultValue);
  return commanderOption;
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
  if (!commandOptionAppliesTo(option, definition)) throw invalidInvocationError();
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
