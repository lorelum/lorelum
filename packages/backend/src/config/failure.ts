import { ConfigError, formatConfigFailure, type ConfigFailure } from "@lorelum/config";

import { BackendError } from "../protocol/errors";

/** Keeps Backend's established code while carrying only an approved config fact. */
export function backendConfigError(failure: ConfigFailure): BackendError {
  const cause = new ConfigError(failure);
  return new BackendError("backend.config-invalid", { cause }, formatConfigFailure(failure));
}

/** Adapts the shared document loader's already-safe fact to the Backend code. */
export function backendDocumentError(error: ConfigError): BackendError {
  return new BackendError("backend.config-invalid", { cause: error }, error.message);
}
