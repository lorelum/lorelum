import { lifecycleCommand } from "./common";
import { loadBackendConfig } from "@lorelum/backend/config";
import type { BackendSupervisor } from "@lorelum/backend/control";
import { backendErrorCodes, statusSchema, type BackendStatus } from "@lorelum/backend/protocol";

import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";

export interface BackendCommandServices {
  readonly createSupervisor: () => Promise<BackendSupervisor>;
}

// Translate the Zod status contract into the smaller JSON schema dialect used
// by CLI discovery. The adapter stays local because CLI output is not an HTTP
// schema and does not need a general Zod-to-JSON-Schema converter.
const statusShape = statusSchema.shape;
const backendStatusResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.entries(statusShape)
    .filter(([, schema]) => !schema.isOptional())
    .map(([name]) => name),
  properties: {
    state: { enum: statusShape.state.options },
    model: { enum: statusShape.model.options },
    instanceId: { type: "string" },
    buildIdentity: { type: "string" },
  },
};

/**
 * Creates the process-specific supervisor only for a backend control request.
 * The lifecycle module owns process spawning and never loads on ordinary metadata reads.
 */
export async function createProcessBackendSupervisor(): Promise<BackendSupervisor> {
  const { createBackendSupervisor, currentBuildIdentity, isCompiledEntrypoint } =
    await import("@lorelum/backend/control");
  const entrypoint = Bun.main;
  const command = isCompiledEntrypoint(entrypoint)
    ? [process.execPath, "--internal-backend-serve"]
    : [process.execPath, entrypoint, "--internal-backend-serve"];
  return createBackendSupervisor({
    config: await loadBackendConfig(),
    buildIdentity: await currentBuildIdentity(entrypoint),
    command,
  });
}

function toResult(status: BackendStatus): JsonValue {
  return {
    state: status.state,
    model: status.model,
    ...(status.instanceId === undefined ? {} : { instanceId: status.instanceId }),
    ...(status.buildIdentity === undefined ? {} : { buildIdentity: status.buildIdentity }),
  };
}

/** Control commands share the CLI registry but have no LocalStore dependency. */
export function createBackendCommands(
  services: BackendCommandServices,
): readonly CommandDefinition[] {
  return (
    [
      ["start", "Start the local backend and wait for it to become ready."],
      ["status", "Report the current local backend status without starting it."],
      ["stop", "Stop the local backend and wait for it to exit."],
    ] as const
  ).map(([operation, summary]) =>
    lifecycleCommand({
      name: `backend.${operation}`,
      summary,
      resultSchema: backendStatusResultSchema,
      errorCodes: backendErrorCodes,
      execute: async () => toResult(await (await services.createSupervisor())[operation]()),
    }),
  );
}
