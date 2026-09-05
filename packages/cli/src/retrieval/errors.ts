import { UnknownPracticeError } from "@lorelum/engine";

import { CliError, cliErrorCodes, frameworkErrorCodes } from "../runtime/errors.js";
import { throwVisibleStoreError } from "../runtime/store-errors.js";

/** Error allowlist shared by LocalStore-backed retrieval commands. */
export const retrievalErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  // CLI-owned domain codes for retrieval commands stay in `retrieval/errors`;
  // engine/store failures are translated here instead of leaking internals.
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
]);

/** Error allowlist for id-addressed LocalStore retrieval (`lore get`). */
export const getRetrievalErrorCodes = Object.freeze([
  ...retrievalErrorCodes,
  cliErrorCodes.getUnknownPractice,
]);

/** Convert engine domain errors to visible CLI errors; returns undefined when not one. */
export function toGetCliError(error: unknown): CliError | undefined {
  if (error instanceof UnknownPracticeError) {
    return new CliError(cliErrorCodes.getUnknownPractice, error.message);
  }
  return undefined;
}

/** Re-throw a mapped CliError, a get domain error, or a store error verbatim. */
export function throwGetVisibleError(error: unknown): never {
  if (error instanceof CliError) throw error;
  const getError = toGetCliError(error);
  if (getError !== undefined) throw getError;
  throwVisibleStoreError(error);
}
