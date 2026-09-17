import { rootCommand, type CommandDefinition, type CommandOption } from "../registry.js";
import type { OutputFormat } from "./render.js";

export interface OutputFormatSelection {
  readonly commandName: string | "unknown";
  readonly format: OutputFormat;
  readonly helpRequested: boolean;
  readonly helpCanBypassArgumentValidation: boolean;
  readonly definition?: CommandDefinition;
  readonly response?: NonNullable<CommandOption["response"]>;
}

interface ParsedOption {
  readonly flag: string;
  readonly hasInlineValue: boolean;
}

/** Resolves the one explicit JSON override before Commander can emit a usage error. */
export function resolveOutputFormat(
  arguments_: readonly string[],
  definitions: readonly CommandDefinition[],
): OutputFormatSelection {
  const childDefinition = findCommandDefinition(arguments_, definitions);
  const definition = childDefinition ?? (hasCommandWord(arguments_) ? undefined : rootCommand);
  const response = definition === rootCommand ? findRootResponse(arguments_) : undefined;
  return {
    commandName: response?.command ?? definition?.name ?? "unknown",
    format: hasJsonFlag(arguments_, definition) ? "json" : "text",
    helpRequested: hasFrameworkFlag(arguments_, definition, "help"),
    helpCanBypassArgumentValidation:
      definition !== undefined && hasOnlyCommandWords(arguments_, definition),
    ...(definition === undefined ? {} : { definition }),
    ...(response === undefined ? {} : { response }),
  };
}

function findRootResponse(arguments_: readonly string[]): CommandOption["response"] | undefined {
  const version = rootCommand.options.find((option) => option.behavior === "version");
  if (version?.response === undefined) return undefined;
  const versionFlags = new Set(commandOptionFlags(version));
  const flags = optionFlags(rootCommand.options);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (versionFlags.has(argument)) return version.response;
    const option = parseOption(argument);
    if (option !== undefined) {
      index = skipOptionValue(index, option, flags);
      continue;
    }
    return undefined;
  }
  return undefined;
}

function hasJsonFlag(
  arguments_: readonly string[],
  definition: CommandDefinition | undefined,
): boolean {
  const flags = optionFlags([...rootCommand.options, ...(definition?.options ?? [])]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (argument === "--json") return true;
    const option = parseOption(argument);
    if (option !== undefined) index = skipOptionValue(index, option, flags);
  }
  return false;
}

function hasFrameworkFlag(
  arguments_: readonly string[],
  definition: CommandDefinition | undefined,
  behavior: NonNullable<CommandOption["behavior"]>,
): boolean {
  const option = rootCommand.options.find((candidate) => candidate.behavior === behavior);
  if (option === undefined) return false;
  const selectedFlags = new Set(commandOptionFlags(option));
  const flags = optionFlags([...rootCommand.options, ...(definition?.options ?? [])]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (selectedFlags.has(argument)) return true;
    const parsed = parseOption(argument);
    if (parsed !== undefined) index = skipOptionValue(index, parsed, flags);
  }
  return false;
}

function findCommandDefinition(
  arguments_: readonly string[],
  definitions: readonly CommandDefinition[],
): CommandDefinition | undefined {
  const words: string[] = [];
  let matched: CommandDefinition | undefined;
  const globalFlags = optionFlags(rootCommand.options);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    const option = parseOption(argument);
    if (option !== undefined) {
      index = skipOptionValue(index, option, globalFlags);
      continue;
    }
    words.push(argument);
    const prefix = words.join(".");
    const definition = definitions.find((candidate) => candidate.name === prefix);
    const hasChildren = definitions.some((candidate) => candidate.name.startsWith(`${prefix}.`));
    if (definition !== undefined) {
      matched = definition;
      if (!hasChildren) return definition;
      continue;
    }
    if (!hasChildren) return matched;
  }
  return matched;
}

function hasCommandWord(arguments_: readonly string[]): boolean {
  const flags = optionFlags(rootCommand.options);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    const option = parseOption(argument);
    if (option !== undefined) {
      index = skipOptionValue(index, option, flags);
      continue;
    }
    return true;
  }
  return false;
}

function hasOnlyCommandWords(
  arguments_: readonly string[],
  definition: CommandDefinition,
): boolean {
  const flags = optionFlags([...rootCommand.options, ...definition.options]);
  let wordCount = 0;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    const option = parseOption(argument);
    if (option !== undefined) {
      index = skipOptionValue(index, option, flags);
      continue;
    }
    wordCount += 1;
  }
  return wordCount <= definition.name.split(".").length;
}

function optionFlags(options: readonly CommandOption[]): ReadonlyMap<string, boolean> {
  const flags = new Map<string, boolean>();
  for (const option of options) {
    for (const flag of commandOptionFlags(option)) flags.set(flag, option.value !== undefined);
  }
  return flags;
}

function commandOptionFlags(option: CommandOption): readonly string[] {
  return [option.longFlag, ...(option.shortFlag === undefined ? [] : [option.shortFlag])];
}

function parseOption(argument: string): ParsedOption | undefined {
  if (!argument.startsWith("-")) return undefined;
  const separator = argument.indexOf("=");
  return separator === -1
    ? { flag: argument, hasInlineValue: false }
    : { flag: argument.slice(0, separator), hasInlineValue: true };
}

function skipOptionValue(
  index: number,
  option: ParsedOption,
  flags: ReadonlyMap<string, boolean>,
): number {
  return !option.hasInlineValue && flags.get(option.flag) === true ? index + 1 : index;
}
