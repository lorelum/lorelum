import { createModelProgressReporter } from "./progress";
import type { OutputWriter } from "../output/protocol";
import { lifecycleCommand } from "../backend/common";
import { defaultRuntimeDirectory, resolveBackendSettings } from "@lorelum/backend/config";
import type { BackendClient } from "@lorelum/backend/client";
import { BACKEND_URL } from "@lorelum/backend/protocol";
import {
  BackendError,
  backendErrorCodes,
  embeddingErrorCodes,
  EmbeddingError,
  modelStatusSchema,
  type ModelStatus,
} from "@lorelum/backend/protocol";
import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import type { TraceId } from "@lorelum/log";

export interface ModelCommandServices {
  readonly createClient: (traceId?: TraceId, debug?: boolean) => Promise<BackendClient>;
  readonly progressWriter?: OutputWriter;
}

const modelStatusResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "encodingId", "device", "dimensions", "threads"],
  properties: {
    state: { enum: modelStatusSchema.shape.state.options },
    encodingId: { type: "string" },
    threads: { type: "integer" },
    message: { type: "string" },
    resource: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "file", "check"],
      properties: {
        kind: { enum: ["model", "native"] },
        file: { type: "string" },
        check: {
          enum: ["missing", "invalid", "size-mismatch", "sha256-mismatch", "manifest-mismatch"],
        },
        expected: { type: "string" },
        actual: { type: "string" },
      },
    },
    progress: {
      type: "object",
      additionalProperties: false,
      required: ["phase"],
      properties: {
        phase: { enum: ["resolving", "downloading", "verifying", "starting"] },
        downloadedBytes: { type: "integer" },
        totalBytes: { type: "integer" },
        attempt: { type: "integer" },
      },
    },
    device: { const: modelStatusSchema.shape.device.value },
    dimensions: { const: modelStatusSchema.shape.dimensions.value },
    error: { enum: embeddingErrorCodes },
  },
};

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
  const { currentBuildIdentity, isSameProcess, readRecord } = controlModule;
  const record = await readRecord(defaultRuntimeDirectory());
  if (record === undefined || !(await isSameProcess(record)))
    throw new BackendError("backend.unavailable");
  const settings = resolveBackendSettings(record.settings);
  return createBackendClient({
    identity: record,
    secret: record.secret,
    buildIdentity: await currentBuildIdentity(Bun.main),
    baseUrl: BACKEND_URL,
    timeoutMs: settings.requestTimeoutMs,
    startupTimeoutMs: settings.startupTimeoutMs,
    shutdownTimeoutMs: settings.shutdownTimeoutMs,
    ...(traceId === undefined ? {} : { traceId }),
    ...(debug ? { diagnosticLevel: "debug" as const } : {}),
  });
}

function toResult(status: ModelStatus): JsonValue {
  const message =
    status.error === undefined
      ? undefined
      : new EmbeddingError(status.error, undefined, status.resource).message;
  return {
    state: status.state,
    encodingId: status.encodingId,
    device: status.device,
    dimensions: status.dimensions,
    threads: status.threads,
    ...(status.progress ? { progress: status.progress } : {}),
    ...(status.error === undefined ? {} : { error: status.error }),
    ...(message === undefined ? {} : { message }),
    ...(status.resource === undefined ? {} : { resource: status.resource }),
  };
}

export function createModelCommands(services: ModelCommandServices): readonly CommandDefinition[] {
  return (
    [
      ["load", "loadModel", "Load the configured embedding model."],
      ["status", "statusModel", "Report embedding model status without loading it."],
      ["unload", "unloadModel", "Unload the embedding model."],
    ] as const
  ).map(([name, operation, summary]) =>
    lifecycleCommand({
      name: `model.${name}`,
      summary,
      resultSchema: modelStatusResultSchema,
      errorCodes: [...backendErrorCodes, ...embeddingErrorCodes],
      execute: async (invocation) => {
        const client = await services.createClient(
          invocation.traceId,
          invocation.options.debug === true,
        );
        return toResult(
          operation === "loadModel"
            ? await client.loadModel({
                onProgress: createModelProgressReporter(services.progressWriter ?? process.stderr),
              })
            : await client[operation](),
        );
      },
    }),
  );
}
