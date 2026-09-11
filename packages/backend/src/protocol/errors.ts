import { z } from "zod";

export const backendErrorCodes = [
  "backend.unavailable",
  "backend.port-conflict",
  "backend.incompatible",
  "backend.unauthorized",
  "backend.invalid-request",
  "backend.busy",
  "backend.deadline-exceeded",
  "backend.state-invalid",
  "backend.config-invalid",
  "backend.failed",
] as const;
export type BackendErrorCode = (typeof backendErrorCodes)[number];

const messages: Record<BackendErrorCode, string> = {
  "backend.unavailable": "The local backend is not running.",
  "backend.port-conflict": "The local backend address is occupied by an unverified service.",
  "backend.incompatible": "The backend does not match this client build or protocol.",
  "backend.unauthorized": "The local backend could not authenticate this request.",
  "backend.invalid-request": "The backend request is invalid.",
  "backend.busy": "The local backend is busy or stopping.",
  "backend.deadline-exceeded": "The backend operation did not finish before its deadline.",
  "backend.state-invalid": "The backend runtime state cannot be safely used or recovered.",
  "backend.config-invalid": "The local backend configuration is invalid.",
  "backend.failed": "The backend operation failed.",
};
export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    options?: ErrorOptions,
  ) {
    super(messages[code], options);
    this.name = "BackendError";
  }
}

/** Domain failures intentionally keep the established CLI error identities. */
export const backendRemoteErrorCodes = [
  "usage.invalid",
  "query.unavailable",
  "query.failed",
  "store.busy",
  "store.recovery-required",
] as const;
export type BackendRemoteErrorCode = (typeof backendRemoteErrorCodes)[number];

export class BackendRemoteError extends Error {
  constructor(readonly code: BackendRemoteErrorCode) {
    super("The local backend could not complete this request.");
    this.name = "BackendRemoteError";
  }
}

export const errorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
export function backendErrorBody(code: BackendErrorCode): ErrorBody {
  return { error: { code, message: messages[code] } };
}
