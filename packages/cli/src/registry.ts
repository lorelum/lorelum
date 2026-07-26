import { v1PackInputLimits } from "@lorelum/engine";
import { validatePack } from "@lorelum/format";

import type { OutputWriter } from "./output/protocol.js";
import { renderSuccess } from "./output/protocol.js";
import type { JsonSchema } from "./output/protocol-schema.js";
import type { CliRuntime } from "./runtime/runtime.js";
import { CliError } from "./runtime/errors.js";
import { logLevels } from "./runtime/logger.js";

export interface CommandOption {
  name: string;
  description: string;
  required: boolean;
  values?: readonly string[];
}

export interface PositionalArgument {
  name: string;
  description: string;
  required: boolean;
  constraints?: Readonly<Record<string, unknown>>;
  values?: readonly string[];
}

export interface CommandDefinition {
  usage: string;
  name: string;
  summary: string;
  positionals: readonly PositionalArgument[];
  options: readonly CommandOption[];
  resultSchema: object;
  errorCodes: readonly string[];
  exitCodes: readonly number[];
  handler: CommandHandler;
}

export interface CommandInvocation {
  options: Readonly<Record<string, unknown>>;
  positionals: readonly string[];
  runtime: CliRuntime;
  setExitCode?(code: 1): void;
}

export type CommandHandler = (
  output: OutputWriter,
  invocation: CommandInvocation,
) => void | Promise<void>;

const globalOptions: readonly CommandOption[] = [
  {
    name: "--config <path>",
    description: "Read configuration from an explicit local file.",
    required: false,
  },
  {
    name: "--log-level <level>",
    description: "Set stderr log verbosity.",
    required: false,
    values: logLevels,
  },
];

const validateOptions: readonly CommandOption[] = [
  ...globalOptions,
  {
    name: "--lenient",
    description: "Keep exit code 0 when the loaded pack has validation errors.",
    required: false,
  },
];

const stringSchema: JsonSchema = { type: "string" };
function validationIssueSchema(level: "error" | "warning" | "info"): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["level", "code", "path", "message"],
    properties: {
      level: { const: level },
      code: stringSchema,
      path: stringSchema,
      message: stringSchema,
    },
  };
}

function validationReportSchema(valid: boolean): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["valid", "errors", "warnings", "infos"],
    properties: {
      valid: { const: valid },
      errors: {
        type: "array",
        ...(valid ? { maxItems: 0 } : { minItems: 1 }),
        items: validationIssueSchema("error"),
      },
      warnings: { type: "array", items: validationIssueSchema("warning") },
      infos: { type: "array", items: validationIssueSchema("info") },
    },
  };
}

const validationReportResultSchema: JsonSchema = {
  oneOf: [validationReportSchema(true), validationReportSchema(false)],
};
const configPathResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "source"],
  properties: {
    path: stringSchema,
    source: { enum: ["default", "environment", "explicit"] },
  },
};
const configShowResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["configuration", "source"],
  properties: {
    configuration: {
      type: "object",
      additionalProperties: false,
      required: ["version"],
      properties: { version: { const: 1 } },
    },
    source: { enum: ["default", "file"] },
  },
};
const positionalDescriptionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "required"],
  properties: {
    name: stringSchema,
    description: stringSchema,
    required: { type: "boolean" },
    constraints: { type: "object" },
    values: { type: "array", items: stringSchema },
  },
};
const optionDescriptionSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "required"],
  properties: {
    name: stringSchema,
    description: stringSchema,
    required: { type: "boolean" },
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

const validatePackPathConstraints = {
  kind: "directory",
  layoutVersion: 1,
  maxInputFiles: v1PackInputLimits.maxInputFiles,
  maxPracticeBytesTotal: v1PackInputLimits.maxPracticeBytesTotal,
  inputs: {
    pack: { path: "pack.yaml", required: true, maxBytes: v1PackInputLimits.maxPackBytes },
    decisions: {
      path: "decisions.yaml",
      required: false,
      maxBytes: v1PackInputLimits.maxDecisionBytes,
    },
    practices: {
      path: "practices/*.md",
      required: false,
      recursive: false,
      maxBytesEach: v1PackInputLimits.maxPracticeBytes,
    },
  },
  symlinks: "rejected",
  securityModel: {
    threatModel: "trusted-local",
    capabilityBoundary: false,
    concurrentUntrustedMutation: "unsupported",
  },
} as const;

const configPathErrorCodes = [
  "usage.invalid",
  "runtime.unexpected",
  "config.path_invalid",
] as const;

export const commandRegistry: CommandDefinition[] = [
  {
    usage: "describe [command]",
    name: "describe",
    summary: "Return machine-readable command capabilities.",
    positionals: [
      {
        name: "command",
        description: "Exact registered command id; omit it to describe the root command.",
        required: false,
      },
    ],
    options: globalOptions,
    resultSchema: discoveryResultSchema,
    errorCodes: configPathErrorCodes,
    exitCodes: [0, 2],
    handler: (output, invocation) => {
      const description = describeCommand(invocation.positionals[0]);
      if (description === undefined) {
        throw new CliError("usage.invalid", "The command invocation is invalid.");
      }
      renderSuccess(output, "describe", description);
    },
  },
  {
    usage: "config",
    name: "config",
    summary: "Inspect read-only local CLI configuration.",
    positionals: [],
    options: globalOptions,
    resultSchema: commandCapabilitySchema,
    errorCodes: configPathErrorCodes,
    exitCodes: [0, 2],
    handler: (output) => renderSuccess(output, "describe", describeCommand("config")),
  },
  {
    usage: "config path",
    name: "config.path",
    summary: "Return the resolved local configuration path and source.",
    positionals: [],
    options: globalOptions,
    resultSchema: configPathResultSchema,
    errorCodes: configPathErrorCodes,
    exitCodes: [0, 2],
    handler: (output, invocation) => {
      renderSuccess(output, "config.path", {
        path: invocation.runtime.configPath,
        source: invocation.runtime.configSource,
      });
    },
  },
  {
    usage: "config show",
    name: "config.show",
    summary: "Return validated local configuration and its source.",
    positionals: [],
    options: globalOptions,
    resultSchema: configShowResultSchema,
    errorCodes: [
      ...configPathErrorCodes,
      "config.unreadable",
      "config.invalid_json",
      "config.unknown_field",
      "config.unsupported_version",
      "config.too_large",
    ],
    exitCodes: [0, 2],
    handler: async (output, invocation) => {
      const loaded = await invocation.runtime.loadConfig();
      invocation.runtime.logger.log("info", "Loaded local CLI configuration.");
      renderSuccess(output, "config.show", {
        configuration: loaded.configuration,
        source: loaded.source,
      });
    },
  },
  {
    usage: "validate <pack-path>",
    name: "validate",
    summary: "Validate an explicitly selected v1 knowledge pack for authors and CI.",
    positionals: [
      {
        name: "pack-path",
        description: "Explicit v1 pack directory. Relative paths resolve once at invocation time.",
        required: true,
        constraints: validatePackPathConstraints,
      },
    ],
    options: validateOptions,
    resultSchema: validationReportResultSchema,
    errorCodes: [
      ...configPathErrorCodes,
      "pack.path_invalid",
      "pack.unreadable",
      "pack.parse_error",
    ],
    exitCodes: [0, 1, 2],
    handler: async (output, invocation) => {
      const report = validatePack(await invocation.runtime.loadPack(invocation.positionals[0]!));
      invocation.runtime.logger.log("info", "Validated explicit knowledge pack input.");
      renderSuccess(output, "validate", report);
      if (!report.valid && invocation.options.lenient !== true) invocation.setExitCode?.(1);
    },
  },
];

export const rootCommand: CommandDefinition = {
  usage: "lore",
  name: "lore",
  summary: "Engineering knowledge tooling for AI coding agents.",
  positionals: [],
  options: globalOptions,
  resultSchema: rootCapabilitySchema,
  errorCodes: configPathErrorCodes,
  exitCodes: [0, 2],
  handler: (output) => renderSuccess(output, "describe", describeCommand()),
};

export type KnownCommand = "lore" | (typeof commandRegistry)[number]["name"];

export function describeCommand(command?: string): object | undefined {
  if (command === "lore" || command === undefined) {
    return {
      ...materializeCommandDefinition(rootCommand),
      commands: commandRegistry.map(materializeCommandDefinition),
    };
  }

  const definition = commandRegistry.find((candidate) => candidate.name === command);
  return definition === undefined ? undefined : materializeCommandDefinition(definition);
}

export interface Invocation {
  command: KnownCommand | "unknown";
  configPath: string | undefined;
  help: boolean;
  valid: boolean;
  version: boolean;
}

export function inspectInvocation(arguments_: readonly string[]): Invocation {
  const positionals: string[] = [];
  const suppliedOptions: ParsedOption[] = [];
  let help = false;
  let version = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;

    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--version" || argument === "-V") {
      version = true;
      continue;
    }
    if (argument.startsWith("--")) {
      const parsedOption = parseOption(argument, arguments_[index + 1]);
      if (parsedOption === undefined) {
        return invalidInvocation("unknown", help, version, configPathFrom(suppliedOptions));
      }
      if (parsedOption.consumeNext) index += 1;
      suppliedOptions.push(parsedOption.option);
      continue;
    }
    if (argument.startsWith("-")) {
      return invalidInvocation(
        commandFromPositionals(positionals),
        help,
        version,
        configPathFrom(suppliedOptions),
      );
    }
    positionals.push(argument);
  }

  const configPath = configPathFrom(suppliedOptions);
  if (help && version)
    return invalidInvocation(commandFromPositionals(positionals), help, version, configPath);

  const command = commandFromPositionals(positionals);
  if (command === "unknown") return invalidInvocation(command, help, version, configPath);

  const definition = command === "lore" ? rootCommand : findCommand(command);
  if (
    definition === undefined ||
    !hasValidPositionals(
      materializeCommandDefinition(definition),
      positionals.slice(commandTokenCount(command)),
    )
  ) {
    return invalidInvocation(command, help, version, configPath);
  }

  if (version && command !== "lore") return invalidInvocation(command, help, version, configPath);
  if (!hasAllowedOptions(definition, suppliedOptions))
    return invalidInvocation(command, help, version, configPath);
  if (!help && !hasRequiredOptions(definition, suppliedOptions))
    return invalidInvocation(command, help, version, configPath);

  return { command, configPath, help, valid: true, version };
}

function invalidInvocation(
  command: KnownCommand | "unknown",
  help: boolean,
  version: boolean,
  configPath: string | undefined,
): Invocation {
  return { command, configPath, help, valid: false, version };
}

interface OptionSpec {
  flag: string;
  takesValue: boolean;
  values?: readonly string[];
}

interface ParsedOption {
  option: OptionSpec;
  value?: string;
}

function commandFromPositionals(positionals: readonly string[]): KnownCommand | "unknown" {
  if (positionals.length === 0) return "lore";

  for (let length = positionals.length; length > 0; length -= 1) {
    const definition = findCommand(positionals.slice(0, length).join("."));
    if (definition !== undefined) return definition.name;
  }
  return "unknown";
}

function commandTokenCount(command: KnownCommand): number {
  return command === "lore" ? 0 : command.split(".").length;
}

function findCommand(name: string): CommandDefinition | undefined {
  return commandRegistry.find((candidate) => candidate.name === name);
}

type CommandDescription = Omit<CommandDefinition, "handler">;

function materializeCommandDefinition(definition: CommandDefinition): CommandDescription {
  const positionals = definition.positionals.map((positional) => ({
    ...positional,
    ...(positional.values === undefined ? {} : { values: [...positional.values] }),
  }));
  if (definition.name === "describe") {
    for (const positional of positionals) {
      if (positional.name === "command") {
        positional.values = commandRegistry.map((candidate) => candidate.name);
      }
    }
  }
  return {
    usage: definition.usage,
    name: definition.name,
    summary: definition.summary,
    positionals,
    options: definition.options.map((option) => ({
      ...option,
      ...(option.values === undefined ? {} : { values: [...option.values] }),
    })),
    resultSchema: definition.resultSchema,
    errorCodes: [...definition.errorCodes],
    exitCodes: [...definition.exitCodes],
  };
}

function parseOption(
  argument: string,
  nextArgument: string | undefined,
): { consumeNext: boolean; option: ParsedOption } | undefined {
  const equalIndex = argument.indexOf("=");
  const flag = equalIndex === -1 ? argument : argument.slice(0, equalIndex);
  const option = allOptionSpecs().find((candidate) => candidate.flag === flag);
  if (option === undefined) return undefined;

  const value = equalIndex === -1 ? nextArgument : argument.slice(equalIndex + 1);
  if (!option.takesValue)
    return equalIndex === -1 ? { consumeNext: false, option: { option } } : undefined;
  if (value === undefined || value.startsWith("-") || !hasAllowedValue(option, value))
    return undefined;

  return { consumeNext: equalIndex === -1, option: { option, value } };
}

function configPathFrom(options: readonly ParsedOption[]): string | undefined {
  return options.filter((option) => option.option.flag === "--config").at(-1)?.value;
}

function hasValidPositionals(
  definition: Pick<CommandDefinition, "positionals">,
  positionals: readonly string[],
): boolean {
  if (positionals.length > definition.positionals.length) return false;

  return definition.positionals.every((positional, index) => {
    const value = positionals[index];
    if (value === undefined) return !positional.required;
    return positional.values === undefined || positional.values.includes(value);
  });
}

function hasAllowedOptions(
  definition: CommandDefinition,
  options: readonly ParsedOption[],
): boolean {
  const allowed = new Set(
    [...rootCommand.options, ...definition.options].map(toOptionSpec).map((option) => option.flag),
  );
  return options.every((option) => allowed.has(option.option.flag));
}

function hasRequiredOptions(
  definition: CommandDefinition,
  options: readonly ParsedOption[],
): boolean {
  const suppliedFlags = new Set(options.map((option) => option.option.flag));
  return [...rootCommand.options, ...definition.options]
    .filter((option) => option.required)
    .map(toOptionSpec)
    .every((option) => suppliedFlags.has(option.flag));
}

function allOptionSpecs(): OptionSpec[] {
  const options = [
    ...rootCommand.options,
    ...commandRegistry.flatMap((definition) => definition.options),
  ].map(toOptionSpec);
  return options.filter(
    (option, index) => options.findIndex((candidate) => candidate.flag === option.flag) === index,
  );
}

function toOptionSpec(option: CommandOption): OptionSpec {
  const [flag] = option.name.split(" ");
  return {
    flag: flag!,
    takesValue: option.name.includes("<"),
    ...(option.values === undefined ? {} : { values: option.values }),
  };
}

function hasAllowedValue(option: OptionSpec, value: string): boolean {
  return option.values === undefined || option.values.includes(value);
}
