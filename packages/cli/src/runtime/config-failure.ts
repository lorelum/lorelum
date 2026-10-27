import { ConfigError, type ConfigFailure } from "@lorelum/config";
import { CliError } from "./errors.js";

/** CLI adapters preserve the classified config cause without examining arbitrary error trees. */
export function configurationFailureFrom(error: unknown): ConfigFailure | undefined {
  return error instanceof CliError && error.cause instanceof ConfigError
    ? error.cause.failure
    : undefined;
}
