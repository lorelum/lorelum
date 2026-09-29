export const cliErrorCodes = Object.freeze({
  packInvalid: "pack.invalid",
  packNotInstalled: "pack.not-installed",
  packUpdateRequired: "pack.update-required",
  practiceConflict: "practice.conflict",
  practiceNotFound: "practice.not-found",
  registryInvalid: "registry.invalid",
  registryAliasConflict: "registry.alias-conflict",
  registryAliasNotFound: "registry.alias-not-found",
  registryCatalogBusy: "registry.catalog-busy",
  registryCatalogInvalid: "registry.catalog-invalid",
  registryPackNotFound: "registry.pack-not-found",
  registryUnavailable: "registry.unavailable",
  registryVersionNotFound: "registry.version-not-found",
  runtimeUnexpected: "runtime.unexpected",
  sourceInvalid: "source.invalid",
  sourceUnavailable: "source.unavailable",
  storeBusy: "store.busy",
  storeRecoveryRequired: "store.recovery-required",
  localizationInvalid: "localization.invalid",
  localizationPracticeNotFound: "localization.practice-not-found",
  queryUnavailable: "query.unavailable",
  queryFailed: "query.failed",
  queryConfigInvalid: "query.config-invalid",
  usageInvalid: "usage.invalid",
});

export const frameworkErrorCodes = Object.freeze([
  cliErrorCodes.usageInvalid,
  cliErrorCodes.runtimeUnexpected,
]);

export class CliError extends Error {
  readonly exitCode = 2 as const;

  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: BackendCompatibilityRecovery,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function invalidInvocationError(message = "The command invocation is invalid."): CliError {
  return new CliError(cliErrorCodes.usageInvalid, message);
}

/** Preserves only errors declared by the selected command's public allowlist. */
export function toVisibleCliError(
  error: unknown,
  visibleErrorCodes: readonly string[],
  command = "unknown",
): CliError {
  const cliError = toCliError(error, command);
  if (!visibleErrorCodes.includes(cliError.code)) return unexpectedRuntimeError();
  if (
    cliError.code === cliErrorCodes.usageInvalid &&
    cliError.message === "The command invocation is invalid."
  ) {
    return invalidInvocationError(
      `Invalid invocation. Run ${helpCommand(command)} to see valid arguments.`,
    );
  }
  return cliError;
}

function toCliError(error: unknown, command: string): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (isCommanderError(error)) {
    return invalidInvocationError(
      `${commanderFailureReason(error.code, command)} Run ${helpCommand(command)} to see valid arguments.`,
    );
  }

  return unexpectedRuntimeError();
}

function helpCommand(command: string): string {
  return command === "unknown" || command === "lore"
    ? "lore --help"
    : `lore ${command.replaceAll(".", " ")} --help`;
}

function commanderFailureReason(code: string, command: string): string {
  switch (code) {
    case "commander.unknownOption":
      return "Unknown option.";
    case "commander.unknownCommand":
      return "Unknown command.";
    case "commander.missingArgument":
      return "A required argument is missing.";
    case "commander.missingMandatoryOptionValue":
      return "A required option is missing.";
    case "commander.optionMissingArgument":
      return "An option needs a value.";
    case "commander.invalidArgument":
      return "An option or argument value is not allowed.";
    case "commander.excessArguments":
      return command === "unknown" ? "Unknown command or extra argument." : "Too many arguments.";
    default:
      return "Invalid command syntax.";
  }
}

function unexpectedRuntimeError(): CliError {
  return new CliError(cliErrorCodes.runtimeUnexpected, "The command could not be completed.");
}

function isCommanderError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("commander.")
  );
}
import type { BackendCompatibilityRecovery } from "@lorelum/backend/protocol";
