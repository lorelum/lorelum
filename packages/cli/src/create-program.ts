import { Command, Option } from "commander";

import type { OutputWriter } from "./output/protocol.js";
import { commandRegistry, rootCommand, type CommandDefinition } from "./registry.js";
import type { CliRuntime } from "./runtime/runtime.js";
import type { LogLevel } from "./runtime/logger.js";

export { type CliRuntime } from "./runtime/runtime.js";

export interface ProgramOptions {
  setExitCode?(code: 1): void;
}

export function createProgram(
  runtime: CliRuntime,
  output: OutputWriter,
  options: ProgramOptions = {},
): Command {
  const program = new Command();

  program
    .name("lore")
    .description("Engineering knowledge tooling for AI coding agents.")
    .helpOption(false)
    .helpCommand(false)
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .exitOverride()
    .hook("preAction", () => {
      runtime.logger.setLevel(program.opts<{ logLevel: LogLevel }>().logLevel);
    })
    .action(() => {
      return rootCommand.handler(output, {
        options: program.opts(),
        positionals: [],
        runtime,
        ...(options.setExitCode === undefined ? {} : { setExitCode: options.setExitCode }),
      });
    });

  for (const option of rootCommand.options) {
    const commanderOption = toCommanderOption(option);
    if (option.name.startsWith("--log-level")) commanderOption.default("error");
    program.addOption(commanderOption);
  }

  for (const definition of commandRegistry) {
    registerCommand(program, definition, runtime, output, options);
  }

  return program;
}

function registerCommand(
  program: Command,
  definition: CommandDefinition,
  runtime: CliRuntime,
  output: OutputWriter,
  options: ProgramOptions,
): void {
  let parent = program;
  const segments = definition.name.split(".");
  const usageSegments = definition.usage.split(" ");

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const existing = parent.commands.find((command) => command.name() === segment);
    if (existing !== undefined) {
      parent = existing;
      continue;
    }

    const usage = usageSegments.slice(index).join(" ");
    const command = parent.command(usage).description(definition.summary);
    if (index === segments.length - 1) {
      for (const option of commandSpecificOptions(definition)) {
        command.addOption(toCommanderOption(option));
      }
      command.action((...arguments_: unknown[]) => {
        const commandInstance = arguments_.at(-1);
        if (!(commandInstance instanceof Command)) {
          throw new Error("Commander did not provide the command context.");
        }
        return definition.handler(output, {
          options: { ...program.opts(), ...commandInstance.opts() },
          positionals: arguments_
            .slice(0, -1)
            .filter((argument): argument is string => typeof argument === "string"),
          runtime,
          ...(options.setExitCode === undefined ? {} : { setExitCode: options.setExitCode }),
        });
      });
    }
    parent = command;
  }
}

function commandSpecificOptions(definition: CommandDefinition) {
  const globalOptionNames = new Set(rootCommand.options.map((option) => option.name));
  return definition.options.filter((option) => !globalOptionNames.has(option.name));
}

function toCommanderOption(option: CommandDefinition["options"][number]): Option {
  const commanderOption = new Option(option.name, option.description);
  if (option.required) commanderOption.makeOptionMandatory();
  if (option.values !== undefined) commanderOption.choices([...option.values]);
  return commanderOption;
}
