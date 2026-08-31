export const cliErrorCodes = Object.freeze({
  packInvalid: "pack.invalid",
  packUpgradeRequired: "pack.upgrade-required",
  practiceConflict: "practice.conflict",
  registryInvalid: "registry.invalid",
  registryPackNotFound: "registry.pack-not-found",
  registryUnavailable: "registry.unavailable",
  registryVersionNotFound: "registry.version-not-found",
  runtimeUnexpected: "runtime.unexpected",
  sourceInvalid: "source.invalid",
  sourceUnavailable: "source.unavailable",
  storeBusy: "store.busy",
  storeRecoveryRequired: "store.recovery-required",
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
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function invalidInvocationError(): CliError {
  return new CliError(cliErrorCodes.usageInvalid, "The command invocation is invalid.");
}

/** Preserves only errors declared by the selected command's public allowlist. */
export function toVisibleCliError(error: unknown, visibleErrorCodes: readonly string[]): CliError {
  const cliError = toCliError(error);
  return visibleErrorCodes.includes(cliError.code) ? cliError : unexpectedRuntimeError();
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (isCommanderError(error)) {
    return invalidInvocationError();
  }

  return unexpectedRuntimeError();
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
