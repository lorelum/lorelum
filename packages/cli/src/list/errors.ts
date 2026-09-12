import { StoreBusyError, StoreRecoveryRequiredError, UnknownPackError } from "@lorelum/engine";

import { CliError, cliErrorCodes, frameworkErrorCodes } from "../runtime/errors.js";

/** Error allowlist for the LocalStore-backed catalog command (`lore list`). */
export const listErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
  cliErrorCodes.listPackNotFound,
]);

/** Convert engine domain errors to visible CLI errors; returns undefined when not one. */
export function toListCliError(error: unknown): CliError | undefined {
  if (error instanceof UnknownPackError) {
    return new CliError(cliErrorCodes.listPackNotFound, "The requested Pack is not installed.");
  }
  return undefined;
}

/** Re-throw a mapped CliError, a list domain error, or a Store error verbatim. */
export function throwListVisibleError(error: unknown): never {
  if (error instanceof CliError) throw error;
  const listError = toListCliError(error);
  if (listError !== undefined) throw listError;
  if (error instanceof StoreBusyError) {
    throw new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
  }
  if (error instanceof StoreRecoveryRequiredError) {
    throw new CliError(
      cliErrorCodes.storeRecoveryRequired,
      "The local Pack store requires recovery.",
    );
  }
  throw error;
}
