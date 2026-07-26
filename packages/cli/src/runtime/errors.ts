export class CliError extends Error {
  readonly exitCode: 1 | 2;

  constructor(
    readonly code: string,
    message: string,
    options: { exitCode?: 1 | 2 } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.exitCode = options.exitCode ?? 2;
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (isPackLoadError(error)) {
    return new CliError(error.code, error.message);
  }

  if (isCommanderError(error)) {
    return new CliError("usage.invalid", "The command invocation is invalid.");
  }

  return new CliError("runtime.unexpected", "The command could not be completed.");
}

function isPackLoadError(error: unknown): error is {
  code: "pack.parse_error" | "pack.path_invalid" | "pack.unreadable";
  message: string;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    (error.code === "pack.parse_error" ||
      error.code === "pack.path_invalid" ||
      error.code === "pack.unreadable") &&
    typeof error.message === "string"
  );
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
