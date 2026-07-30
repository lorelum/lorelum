import {
  protocolVersion,
  toolVersion,
  type JsonSchema,
  type JsonValue,
} from "./output/protocol.js";
import { frameworkErrorCodes, invalidInvocationError } from "./runtime/errors.js";
import { logLevels } from "./runtime/logger.js";

export interface CommandOption {
  readonly longFlag: string;
  readonly shortFlag?: string;
  readonly description: string;
  /** Value syntax when the option is present; `required` selects `<value>` over `[value]`. */
  readonly value?: Readonly<{ name: string; required: boolean }>;
  /** Requires callers to provide the option; defaults are therefore not allowed. */
  readonly optionRequired: boolean;
  /** Reserved for framework-owned global options on the root command. */
  readonly behavior?: "help" | "log-level" | "version";
  /** Framework option availability; local command options omit this field. */
  readonly scope?: "global" | "root";
  /** Static framework response metadata, including its discoverable data contract. */
  readonly response?: Readonly<{
    command: string;
    data: JsonValue;
    resultSchema: JsonSchema;
  }>;
  readonly defaultValue?: string;
  readonly values?: readonly string[];
}

export interface PositionalArgument {
  readonly name: string;
  readonly required: boolean;
  readonly values?: readonly string[];
}

export interface CommandDefinition {
  /** Stable dotted command id; dots become nested Commander paths. */
  readonly name: string;
  readonly summary: string;
  readonly positionals: readonly PositionalArgument[];
  readonly options: readonly CommandOption[];
  /** Validates response `data`; the protocol envelope has its own exported schema. */
  readonly resultSchema: JsonSchema;
  /** Handler errors outside this allowlist are exposed as `runtime.unexpected`. */
  readonly errorCodes: readonly string[];
  /** Must contain framework exits 0 and 2; domain commands may additionally declare 1. */
  readonly exitCodes: readonly number[];
  readonly handler: CommandHandler;
}

export interface CommandInvocation {
  readonly options: Readonly<Record<string, unknown>>;
  readonly positionals: readonly string[];
  readonly describeCommand: DescribeCommand;
}

export type DescribeCommand = (command?: string) => JsonValue | undefined;

/** Domain result returned to the adapter, which performs the single stdout write. */
export interface CommandResult<T extends JsonValue = JsonValue> {
  readonly data: T;
  /** Defaults to 0. Exit 1 is valid only when declared by the command. */
  readonly exitCode?: 0 | 1;
}

export type CommandHandler = (
  invocation: CommandInvocation,
) => CommandResult | Promise<CommandResult>;

const frameworkExitCodes = [0, 2] as const;
export const discoveryCommandName = "describe";
const stringSchema: JsonSchema = { type: "string" };
const versionResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "toolVersion"],
  properties: {
    protocolVersion: { const: protocolVersion },
    toolVersion: stringSchema,
  },
};

const globalOptions: readonly CommandOption[] = [
  {
    longFlag: "--help",
    shortFlag: "-h",
    description: "Return machine-readable command capabilities.",
    optionRequired: false,
    behavior: "help",
    scope: "global",
  },
  {
    longFlag: "--version",
    shortFlag: "-V",
    description: "Return protocol and tool versions.",
    optionRequired: false,
    behavior: "version",
    scope: "root",
    response: {
      command: "version",
      data: { protocolVersion, toolVersion },
      resultSchema: versionResultSchema,
    },
  },
  {
    longFlag: "--log-level",
    description: "Set stderr log verbosity.",
    value: { name: "level", required: true },
    optionRequired: false,
    behavior: "log-level",
    scope: "global",
    defaultValue: "error",
    values: logLevels,
  },
] as const satisfies readonly CommandOption[];

const positionalDescriptionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "required"],
  properties: {
    name: stringSchema,
    required: { type: "boolean" },
    values: { type: "array", items: stringSchema },
  },
};
const optionResponseDescriptionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["command", "resultSchema"],
  properties: {
    command: stringSchema,
    resultSchema: { type: "object" },
  },
};
const optionDescriptionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "required", "scope"],
  properties: {
    name: stringSchema,
    description: stringSchema,
    required: { type: "boolean" },
    scope: { enum: ["command", "global", "root"] },
    behavior: { enum: ["help", "log-level", "version"] },
    response: optionResponseDescriptionSchema,
    defaultValue: stringSchema,
    values: { type: "array", items: stringSchema },
  },
};
const commandCapabilityProperties: Readonly<Record<string, JsonSchema>> = {
  usage: stringSchema,
  name: stringSchema,
  summary: stringSchema,
  positionals: { type: "array", items: positionalDescriptionSchema },
  options: { type: "array", items: optionDescriptionSchema },
  resultSchema: { type: "object" },
  errorCodes: { type: "array", items: stringSchema },
  exitCodes: { type: "array", items: { type: "integer" } },
};
const commandCapabilityRequired = [
  "usage",
  "name",
  "summary",
  "positionals",
  "options",
  "resultSchema",
  "errorCodes",
  "exitCodes",
] as const;
const commandCapabilitySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: commandCapabilityRequired,
  properties: commandCapabilityProperties,
};
const rootCapabilitySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [...commandCapabilityRequired, "commands"],
  properties: {
    ...commandCapabilityProperties,
    commands: { type: "array", items: commandCapabilitySchema },
  },
};
const discoveryResultSchema: JsonSchema = {
  oneOf: [rootCapabilitySchema, commandCapabilitySchema],
};

const builtInCommandDefinitions = [
  {
    name: discoveryCommandName,
    summary: "Return machine-readable command capabilities.",
    positionals: [{ name: "command", required: false }],
    options: [],
    resultSchema: discoveryResultSchema,
    errorCodes: frameworkErrorCodes,
    exitCodes: [0, 2],
    handler: (invocation) => ({
      data: requireCommandDescription(invocation.describeCommand, invocation.positionals[0]),
    }),
  },
] satisfies readonly CommandDefinition[];

/** Root parser metadata is separate because it is not an invokable child command. */
export const rootCommand = snapshotCommandDefinition({
  name: "lore",
  summary: "Engineering knowledge tooling for AI coding agents.",
  positionals: [],
  options: globalOptions,
  resultSchema: rootCapabilitySchema,
  errorCodes: frameworkErrorCodes,
  exitCodes: [0, 2],
  handler: (invocation) => ({ data: requireCommandDescription(invocation.describeCommand) }),
});

/** Immutable child-command registry used unless a complete replacement is supplied. */
export const commandRegistry = snapshotCommandDefinitions(builtInCommandDefinitions);

export type KnownCommand = "lore" | (typeof commandRegistry)[number]["name"];

export function describeCommand(
  command?: string,
  definitions: readonly CommandDefinition[] = commandRegistry,
): JsonValue | undefined {
  if (command === "lore" || command === undefined) {
    return {
      ...materializeCommandDefinition(rootCommand, definitions),
      commands: definitions.map((definition) =>
        materializeCommandDefinition(definition, definitions),
      ),
    };
  }

  const definition = definitions.find((candidate) => candidate.name === command);
  return definition === undefined
    ? undefined
    : materializeCommandDefinition(definition, definitions);
}

export function positionalValues(
  definition: CommandDefinition,
  positional: PositionalArgument,
  definitions: readonly CommandDefinition[] = commandRegistry,
): readonly string[] | undefined {
  return definition.name === discoveryCommandName && positional.name === "command"
    ? definitions.map((candidate) => candidate.name)
    : positional.values;
}

export function requireCommandDescription(describe: DescribeCommand, command?: string): JsonValue {
  const description = describe(command);
  if (description === undefined) throw invalidInvocationError();
  return description;
}

interface CommandOptionDescription {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly scope: "command" | "global" | "root";
  readonly behavior?: CommandOption["behavior"];
  readonly response?: Readonly<{ command: string; resultSchema: JsonSchema }>;
  readonly defaultValue?: string;
  readonly values?: readonly string[];
}

type CommandDescription = Omit<CommandDefinition, "handler" | "options"> & {
  usage: string;
  options: readonly CommandOptionDescription[];
};

function materializeCommandDefinition(
  definition: CommandDefinition,
  definitions: readonly CommandDefinition[],
): CommandDescription {
  const options =
    definition === rootCommand
      ? definition.options
      : [
          ...rootCommand.options.filter((option) => commandOptionAppliesTo(option, definition)),
          ...definition.options,
        ];
  return {
    usage: commandUsage(definition),
    name: definition.name,
    summary: definition.summary,
    positionals: definition.positionals.map((positional) => {
      const values = positionalValues(definition, positional, definitions);
      return { ...positional, ...(values === undefined ? {} : { values }) };
    }),
    options: options.map((option) => ({
      name: commandOptionDeclaration(option),
      description: option.description,
      required: option.optionRequired,
      scope: option.scope ?? "command",
      ...(option.behavior === undefined ? {} : { behavior: option.behavior }),
      ...(option.response === undefined
        ? {}
        : {
            response: {
              command: option.response.command,
              resultSchema: option.response.resultSchema,
            },
          }),
      ...(option.defaultValue === undefined ? {} : { defaultValue: option.defaultValue }),
      ...(option.values === undefined ? {} : { values: [...option.values] }),
    })),
    resultSchema: definition.resultSchema,
    errorCodes: [...definition.errorCodes],
    exitCodes: [...definition.exitCodes],
  };
}

export function snapshotCommandDefinitions(
  definitions: readonly CommandDefinition[],
): readonly CommandDefinition[] {
  assertRegistryMetadata(definitions);
  return Object.freeze(definitions.map(snapshotCommandDefinition));
}

export function commandOptionKey(option: CommandOption): string {
  const longName = option.longFlag.slice(2);
  return longName.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

export function commandOptionDeclaration(option: CommandOption): string {
  const flags =
    option.shortFlag === undefined ? option.longFlag : `${option.shortFlag}, ${option.longFlag}`;
  if (option.value === undefined) return flags;
  const value = option.value.required ? `<${option.value.name}>` : `[${option.value.name}]`;
  return `${flags} ${value}`;
}

export function commandOptionAppliesTo(
  option: CommandOption,
  definition: CommandDefinition,
): boolean {
  return option.scope !== "root" || definition === rootCommand;
}

function snapshotCommandDefinition(definition: CommandDefinition): CommandDefinition {
  assertFrameworkMetadata(definition);
  return Object.freeze({
    ...definition,
    positionals: Object.freeze(
      definition.positionals.map((positional) =>
        Object.freeze({
          ...positional,
          ...(positional.values === undefined
            ? {}
            : { values: Object.freeze([...positional.values]) }),
        }),
      ),
    ),
    options: Object.freeze(
      definition.options.map((option) =>
        Object.freeze({
          ...option,
          ...(option.value === undefined ? {} : { value: Object.freeze({ ...option.value }) }),
          ...(option.response === undefined
            ? {}
            : { response: deepFreeze(structuredClone(option.response)) }),
          ...(option.values === undefined ? {} : { values: Object.freeze([...option.values]) }),
        }),
      ),
    ),
    resultSchema: deepFreeze(structuredClone(definition.resultSchema)),
    errorCodes: Object.freeze([...definition.errorCodes]),
    exitCodes: Object.freeze([...definition.exitCodes]),
  });
}

function assertFrameworkMetadata(definition: CommandDefinition): void {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(definition.name)) {
    throw new Error(`Command name "${definition.name}" must be a dotted kebab-case id.`);
  }
  if (new Set(definition.errorCodes).size !== definition.errorCodes.length) {
    throw new Error(`Command "${definition.name}" declares duplicate error codes.`);
  }
  if (new Set(definition.exitCodes).size !== definition.exitCodes.length) {
    throw new Error(`Command "${definition.name}" declares duplicate exit codes.`);
  }
  if (definition.exitCodes.some((exitCode) => exitCode !== 0 && exitCode !== 1 && exitCode !== 2)) {
    throw new Error(`Command "${definition.name}" declares an unsupported exit code.`);
  }
  if (
    new Set(definition.positionals.map((positional) => positional.name)).size !==
    definition.positionals.length
  ) {
    throw new Error(`Command "${definition.name}" declares duplicate positional names.`);
  }
  for (const option of definition.options) {
    if (!/^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(option.longFlag)) {
      throw new Error(`Command "${definition.name}" declares invalid long option flag.`);
    }
    if (option.shortFlag !== undefined && !/^-[A-Za-z0-9]$/.test(option.shortFlag)) {
      throw new Error(`Command "${definition.name}" declares invalid short option flag.`);
    }
    if (option.value !== undefined && !/^[a-z][a-z0-9-]*$/.test(option.value.name)) {
      throw new Error(`Command "${definition.name}" declares an invalid option value name.`);
    }
    if (
      option.behavior === undefined &&
      (option.scope !== undefined || option.response !== undefined)
    ) {
      throw new Error(`Command "${definition.name}" option scope and response require a behavior.`);
    }
    if (option.behavior !== undefined && option.scope === undefined) {
      throw new Error(`Command "${definition.name}" framework options must declare a scope.`);
    }
    if ((option.behavior === "version") !== (option.response !== undefined)) {
      throw new Error(
        `Command "${definition.name}" version behavior requires exactly one response.`,
      );
    }
    if (option.optionRequired && option.defaultValue !== undefined) {
      throw new Error(`Command "${definition.name}" cannot default a required option.`);
    }
    if (
      (option.defaultValue !== undefined || option.values !== undefined) &&
      option.value === undefined
    ) {
      throw new Error(`Command "${definition.name}" option values require a value declaration.`);
    }
    if (option.values !== undefined && option.values.length === 0) {
      throw new Error(`Command "${definition.name}" option choices must not be empty.`);
    }
    if (
      option.defaultValue !== undefined &&
      option.values !== undefined &&
      !option.values.includes(option.defaultValue)
    ) {
      throw new Error(`Command "${definition.name}" option default must be one of its choices.`);
    }
  }
  for (const errorCode of frameworkErrorCodes) {
    if (!definition.errorCodes.includes(errorCode)) {
      throw new Error(`Command "${definition.name}" must declare error code "${errorCode}".`);
    }
  }
  for (const exitCode of frameworkExitCodes) {
    if (!definition.exitCodes.includes(exitCode)) {
      throw new Error(`Command "${definition.name}" must declare exit code ${exitCode}.`);
    }
  }
}

function assertRegistryMetadata(definitions: readonly CommandDefinition[]): void {
  const names = new Set<string>();
  const globalOptionFlags = new Set(rootCommand.options.flatMap(commandOptionFlags));

  for (const definition of definitions) {
    if (definition.name === rootCommand.name) {
      throw new Error(`Command name "${definition.name}" is reserved for the root command.`);
    }
    if (names.has(definition.name)) {
      throw new Error(`Command name "${definition.name}" is declared more than once.`);
    }
    names.add(definition.name);

    const localOptionFlags = new Set<string>();
    for (const option of definition.options) {
      if (option.behavior !== undefined) {
        throw new Error(`Command "${definition.name}" cannot declare framework option behavior.`);
      }
      for (const flag of commandOptionFlags(option)) {
        if (globalOptionFlags.has(flag) || localOptionFlags.has(flag)) {
          throw new Error(`Command "${definition.name}" declares conflicting option "${flag}".`);
        }
        localOptionFlags.add(flag);
      }
    }
  }

  for (const definition of definitions) {
    const hasChild = definitions.some((candidate) =>
      candidate.name.startsWith(`${definition.name}.`),
    );
    if (hasChild && (definition.positionals.length > 0 || definition.options.length > 0)) {
      throw new Error(
        `Command "${definition.name}" cannot combine local arguments with child commands.`,
      );
    }
  }
}

function commandOptionFlags(option: CommandOption): string[] {
  return option.shortFlag === undefined ? [option.longFlag] : [option.shortFlag, option.longFlag];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }
  return Object.freeze(value);
}

function commandUsage(definition: CommandDefinition): string {
  const command = definition.name.replaceAll(".", " ");
  const positionals = definition.positionals.map((positional) =>
    positional.required ? `<${positional.name}>` : `[${positional.name}]`,
  );
  return [command, ...positionals].join(" ");
}
