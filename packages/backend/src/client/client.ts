import { randomBytes } from "node:crypto";

import {
  BACKEND_URL,
  BUSINESS_VERSION,
  CONTROL_VERSION,
  MAX_RESPONSE_BYTES,
} from "../protocol/constants";
import {
  errorSchema,
  BackendRemoteError,
  backendRemoteErrorCodes,
  BackendError,
  backendErrorCodes,
} from "../protocol/errors";
import { constantTimeEqual, identityProof, type InstanceIdentity } from "../protocol/identity";
import {
  identitySchema,
  statusSchema,
  type BackendIdentity,
  type BackendStatus,
} from "../modules/backend/model";
import { DEFAULT_BACKEND_SETTINGS } from "../config/model";

export interface CreateBackendClientOptions {
  readonly identity: InstanceIdentity;
  readonly secret: string;
  /** Test-only alternate loopback HTTP address. */
  readonly baseUrl?: string;
  readonly buildIdentity: string;
  readonly timeoutMs?: number;
}

export interface BackendClient {
  identity(): Promise<BackendIdentity>;
  status(): Promise<BackendStatus>;
  stop(): Promise<BackendStatus>;
}

function validatedLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username !== "" || url.password !== "") {
    throw new TypeError("Backend URL must be an unauthenticated HTTP loopback URL");
  }
  if (url.hostname !== "127.0.0.1") {
    throw new TypeError("Backend URL must use a loopback host");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new TypeError("Backend URL must not include a path, query, or fragment");
  }
  return url;
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError"
  );
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new BackendError("backend.failed");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // A response body is ordered; each chunk must be consumed before the next.
      // eslint-disable-next-line no-await-in-loop
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        throw new BackendError("backend.failed");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof BackendError) throw error;
    if (signal.aborted || isTimeout(error)) {
      throw new BackendError("backend.deadline-exceeded", { cause: error });
    }
    throw new BackendError("backend.failed", { cause: error });
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    throw new BackendError("backend.failed");
  }
}

function remoteError(body: unknown): Error | undefined {
  const parsed = errorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  if ((backendErrorCodes as readonly string[]).includes(parsed.data.error.code)) {
    return new BackendError(parsed.data.error.code as (typeof backendErrorCodes)[number]);
  }
  if ((backendRemoteErrorCodes as readonly string[]).includes(parsed.data.error.code)) {
    return new BackendRemoteError(
      parsed.data.error.code as (typeof backendRemoteErrorCodes)[number],
    );
  }
  return new BackendError("backend.failed");
}

/** A fetch-only client boundary; it has no runtime dependency on Engine or Elysia. */
export function createBackendClient(options: CreateBackendClientOptions): BackendClient {
  if (options.secret.length === 0) throw new TypeError("Backend secret must not be empty");
  if (options.buildIdentity.length === 0) throw new TypeError("Build identity must not be empty");
  const timeoutMs = options.timeoutMs ?? DEFAULT_BACKEND_SETTINGS.requestTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("Timeout must be a positive integer");
  const baseUrl = validatedLoopbackUrl(options.baseUrl ?? BACKEND_URL);

  const send = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const url = new URL(path, baseUrl);
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      proxy: "",
      signal,
      headers: { host: baseUrl.host, ...init.headers },
    }).catch((error: unknown) => {
      if (isTimeout(error)) {
        throw new BackendError("backend.deadline-exceeded", { cause: error });
      }
      throw new BackendError("backend.unavailable", { cause: error });
    });
    const body = await readBoundedJson(response, signal);
    if (!response.ok) throw remoteError(body) ?? new BackendError("backend.failed");
    return body;
  };

  const identify = async (): Promise<BackendIdentity> => {
    const nonce = randomBytes(32).toString("hex");
    const body = await send(`/internal/v1/identity?nonce=${nonce}`);
    const parsed = identitySchema.safeParse(body);
    if (!parsed.success) throw new BackendError("backend.port-conflict");
    const { proof, ...identity } = parsed.data;
    if (!constantTimeEqual(proof, identityProof(options.secret, nonce, identity))) {
      throw new BackendError("backend.port-conflict");
    }
    if (
      identity.instanceId !== options.identity.instanceId ||
      identity.buildIdentity !== options.identity.buildIdentity ||
      identity.controlVersion !== CONTROL_VERSION
    ) {
      throw new BackendError("backend.incompatible");
    }
    return parsed.data;
  };

  const authorized = async (
    strictBusinessBuild: boolean,
  ): Promise<{
    readonly headers: Record<string, string>;
    readonly identity: BackendIdentity;
  }> => {
    const identity = await identify();
    if (
      strictBusinessBuild &&
      (identity.buildIdentity !== options.buildIdentity ||
        identity.businessVersion !== BUSINESS_VERSION)
    ) {
      throw new BackendError("backend.incompatible");
    }
    return { headers: { authorization: `Bearer ${options.secret}` }, identity };
  };

  const checkedStatus = (body: unknown, authenticated: BackendIdentity): BackendStatus => {
    const parsed = statusSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.instanceId !== authenticated.instanceId ||
      parsed.data.buildIdentity !== authenticated.buildIdentity
    ) {
      throw new BackendError("backend.failed");
    }
    return parsed.data;
  };

  return Object.freeze({
    identity: identify,
    async status() {
      const authenticated = await authorized(false);
      const body = await send("/internal/v1/status", { headers: authenticated.headers });
      return checkedStatus(body, authenticated.identity);
    },
    async stop() {
      const authenticated = await authorized(false);
      const body = await send("/internal/v1/stop", {
        method: "POST",
        headers: authenticated.headers,
      });
      return checkedStatus(body, authenticated.identity);
    },
  } satisfies BackendClient);
}
