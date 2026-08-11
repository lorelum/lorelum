import { decisionErrorCodes } from "@lorelum/engine";

/**
 * CLI error model (ADR 0004): every command failure is one JSON envelope with
 * a stable dotted `code`. Commands throw `CliError` directly; domain errors
 * from engine/format are mapped to `CliError` by the owning command, so the
 * framework stays free of domain error classes. `toVisibleCliError` masks any
 * code outside the selected command's declared `errorCodes` allowlist as
 * `runtime.unexpected`, so command authors opt in to what agents may rely on.
 * Decide codes are sourced from `@lorelum/engine` to keep the strings in one
 * place.
 */
export const cliErrorCodes = Object.freeze({
  runtimeUnexpected: "runtime.unexpected",
  usageInvalid: "usage.invalid",
  packPathInvalid: "pack.path_invalid",
  packUnreadable: "pack.unreadable",
  packParseError: "pack.parse_error",
  decideUnknownDecision: decisionErrorCodes.unknownDecision,
  decideInvalidCondition: decisionErrorCodes.invalidCondition,
  decideDuplicateDecision: decisionErrorCodes.duplicateDecision,
  decideCycle: decisionErrorCodes.cycle,
});

/** Error codes every command must declare; used as the framework masking baseline. */
export const frameworkErrorCodes = Object.freeze([
  cliErrorCodes.usageInvalid,
  cliErrorCodes.runtimeUnexpected,
]);

/** Typed CLI failure carrying a stable dotted protocol code and exit code 2. */
export class CliError extends Error {
  readonly exitCode = 2 as const;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Standard usage error for an invalid command invocation. */
export function invalidInvocationError(): CliError {
  return new CliError(cliErrorCodes.usageInvalid, "The command invocation is invalid.");
}

/** Preserves only errors declared by the selected command's public allowlist. */
export function toVisibleCliError(error: unknown, visibleErrorCodes: readonly string[]): CliError {
  const cliError = toCliError(error);
  return visibleErrorCodes.includes(cliError.code) ? cliError : unexpectedRuntimeError();
}

/** Translate any thrown value into a CliError; domain errors arrive already mapped by their command. */
function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (isCommanderError(error)) {
    return invalidInvocationError();
  }

  return unexpectedRuntimeError();
}

/** Fallback error masking anything the selected command did not declare. */
function unexpectedRuntimeError(): CliError {
  return new CliError(cliErrorCodes.runtimeUnexpected, "The command could not be completed.");
}

/** Commander parse failures are invocation errors, not domain failures. */
function isCommanderError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("commander.")
  );
}
