import { lifecycleCommand } from "./common";
import { defaultRuntimeDirectory, resolveBackendSettings } from "@lorelum/backend/config";
import type { BackendClient } from "@lorelum/backend/client";
import { BACKEND_URL } from "@lorelum/backend/protocol";
import {
  BackendError,
  backendErrorCodes,
  embeddingErrorCodes,
  modelStatusSchema,
  type ModelStatus,
} from "@lorelum/backend/protocol";
import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";

export interface ModelCommandServices {
  readonly createClient: () => Promise<BackendClient>;
}

const modelStatusResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "encodingId", "device", "dimensions"],
  properties: {
    state: { enum: modelStatusSchema.shape.state.options },
    encodingId: { const: modelStatusSchema.shape.encodingId.value },
    device: { const: modelStatusSchema.shape.device.value },
    dimensions: { const: modelStatusSchema.shape.dimensions.value },
    error: { enum: embeddingErrorCodes },
  },
};

/** Connect to the verified daemon record without starting it or creating runtime state. */
export async function createProcessBackendClient(): Promise<BackendClient> {
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
  });
}

function toResult(status: ModelStatus): JsonValue {
  return {
    state: status.state,
    encodingId: status.encodingId,
    device: status.device,
    dimensions: status.dimensions,
    ...(status.error === undefined ? {} : { error: status.error }),
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
      execute: async () => toResult(await (await services.createClient())[operation]()),
    }),
  );
}
