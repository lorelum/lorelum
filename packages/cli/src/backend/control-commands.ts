import { loadBackendConfig } from "@lorelum/backend/config";
import type { BackendSupervisor } from "@lorelum/backend/control";
import {
  BackendError,
  backendErrorCodes,
  statusSchema,
  type BackendStatus,
} from "@lorelum/backend/protocol";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, frameworkErrorCodes } from "../runtime/errors.js";

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
    model: { const: "unloaded" },
    instanceId: { type: "string" },
    buildIdentity: { type: "string" },
  },
};

/**
 * Creates the process-specific supervisor only for a backend control request.
 * The lifecycle module owns process spawning and never loads on ordinary metadata reads.
 */
export async function createProcessBackendSupervisor(): Promise<BackendSupervisor> {
  const { createBackendSupervisor, currentBuildIdentity } =
    await import("@lorelum/backend/control");
  const entrypoint = Bun.main;
  const command = isCompiledCliEntrypoint(entrypoint)
    ? [process.execPath, "--internal-backend-serve"]
    : [process.execPath, entrypoint, "--internal-backend-serve"];
  return createBackendSupervisor({
    config: await loadBackendConfig(),
    buildIdentity: await currentBuildIdentity(entrypoint),
    command,
  });
}

function isCompiledCliEntrypoint(entrypoint: string): boolean {
  return entrypoint.includes("/$bunfs/") || entrypoint.includes("\\$bunfs\\");
}

function toResult(status: BackendStatus): JsonValue {
  return {
    state: status.state,
    model: status.model,
    ...(status.instanceId === undefined ? {} : { instanceId: status.instanceId }),
    ...(status.buildIdentity === undefined ? {} : { buildIdentity: status.buildIdentity }),
  };
}

async function execute(
  services: BackendCommandServices,
  operation: (supervisor: BackendSupervisor) => Promise<BackendStatus>,
): Promise<{ data: JsonValue }> {
  try {
    return { data: toResult(await operation(await services.createSupervisor())) };
  } catch (error) {
    if (error instanceof BackendError) {
      throw new CliError(error.code, error.message);
    }
    throw error;
  }
}

function definition(
  name: "backend.start" | "backend.status" | "backend.stop",
  summary: string,
  services: BackendCommandServices,
  operation: (supervisor: BackendSupervisor) => Promise<BackendStatus>,
): CommandDefinition {
  return {
    name,
    summary,
    positionals: [],
    options: [],
    resultSchema: backendStatusResultSchema,
    errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
    exitCodes: [0, 2],
    handler: () => execute(services, operation),
  };
}

/** Control commands share the CLI registry but have no LocalStore dependency. */
export function createBackendCommands(
  services: BackendCommandServices,
): readonly CommandDefinition[] {
  return [
    definition(
      "backend.start",
      "Start the local backend and wait for it to become ready.",
      services,
      (supervisor) => supervisor.start(),
    ),
    definition(
      "backend.status",
      "Report the current local backend status without starting it.",
      services,
      (supervisor) => supervisor.status(),
    ),
    definition(
      "backend.stop",
      "Stop the local backend and wait for it to exit.",
      services,
      (supervisor) => supervisor.stop(),
    ),
  ];
}
