import type { BackendClient } from "@lorelum/backend/client";
import { defaultRuntimeDirectory, resolveBackendSettings } from "@lorelum/backend/config";
import { BACKEND_URL, BackendError } from "@lorelum/backend/protocol";
import type { TraceId } from "@lorelum/log";

/** Connect to the verified daemon record without starting it or creating runtime state. */
export async function createProcessBackendClient(
  traceId?: TraceId,
  debug = false,
): Promise<BackendClient> {
  const [clientModule, controlModule] = await Promise.all([
    import("@lorelum/backend/client"),
    import("@lorelum/backend/control"),
  ]);
  const { createBackendClient } = clientModule;
  const { isSameProcess, readRecord } = controlModule;
  const record = await readRecord(defaultRuntimeDirectory());
  if (record === undefined || !(await isSameProcess(record)))
    throw new BackendError("backend.unavailable");
  const settings = resolveBackendSettings(record.settings);
  return createBackendClient({
    identity: record,
    secret: record.secret,
    baseUrl: BACKEND_URL,
    timeoutMs: settings.requestTimeoutMs,
    startupTimeoutMs: settings.startupTimeoutMs,
    shutdownTimeoutMs: settings.shutdownTimeoutMs,
    ...(traceId === undefined ? {} : { traceId }),
    ...(debug ? { diagnosticLevel: "debug" as const } : {}),
  });
}
