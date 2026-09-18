import { ConfigError } from "@lorelum/config";
import { loadBackendConfig } from "@lorelum/backend/config";
import type { BackendSupervisor } from "@lorelum/backend/control";
import {
  BackendError,
  backendErrorCodes,
  statusSchema,
  type BackendStatus,
} from "@lorelum/backend/protocol";

import { initializeApplicationConfig } from "../config/initialize";
import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { CliError, frameworkErrorCodes, invalidInvocationError } from "../runtime/errors";

export interface BackendCommandServices {
  readonly createSupervisor: (options?: { initialize?: boolean }) => Promise<BackendSupervisor>;
}

const DEFAULT_LEASE_TTL_MS = 60_000;

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
const stopIfIdleResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state"],
  properties: {
    state: { enum: ["stopped", "deferred"] },
    reason: { enum: ["active-long-task", "unknown-activity"] },
  },
};
const stopResultSchema: JsonSchema = {
  oneOf: [backendStatusResultSchema, stopIfIdleResultSchema],
};
const leaseResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["leaseId", "expiresAt"],
  properties: {
    leaseId: { type: "string" },
    expiresAt: { type: "string" },
  },
};
const releasedLeaseResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["released"],
  properties: { released: { const: true } },
};

/**
 * Creates the process-specific supervisor only for a backend control request.
 * The lifecycle module owns process spawning and never loads on ordinary metadata reads.
 */
export async function createProcessBackendSupervisor(
  options: { initialize?: boolean } = {},
): Promise<BackendSupervisor> {
  const { createBackendSupervisor, currentBuildIdentity, isCompiledEntrypoint } =
    await import("@lorelum/backend/control");
  const entrypoint = Bun.main;
  const command = isCompiledEntrypoint(entrypoint)
    ? [process.execPath, "--internal-backend-serve"]
    : [process.execPath, entrypoint, "--internal-backend-serve"];
  if (options.initialize) {
    try {
      await initializeApplicationConfig();
    } catch (error) {
      if (error instanceof ConfigError) throw new BackendError("backend.config-invalid");
      throw error;
    }
  }
  return createBackendSupervisor({
    config: await loadBackendConfig(),
    buildIdentity: await currentBuildIdentity(entrypoint),
    command,
    daemonArgv0: "lore-backend",
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

function toHandoffResult(result: Awaited<ReturnType<BackendSupervisor["stopIfIdle"]>>): JsonValue {
  return {
    state: result.state,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

function toLeaseResult(
  result: Awaited<ReturnType<BackendSupervisor["acquireTaskLease"]>>,
): JsonValue {
  return { leaseId: result.leaseId, expiresAt: result.expiresAt };
}

function parseLeaseTtl(value: unknown): number {
  if (value === undefined) return DEFAULT_LEASE_TTL_MS;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw invalidInvocationError();
  const ttlMs = Number(value);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000)
    throw invalidInvocationError();
  return ttlMs;
}

function lifecycleError(error: unknown): never {
  if (error instanceof BackendError) throw new CliError(error.code, error.message);
  throw error;
}

const leaseTtlOption = {
  longFlag: "--ttl-ms",
  description: "Keep the machine-managed task lease active for this many milliseconds.",
  value: { name: "milliseconds", required: true },
  optionRequired: false,
  defaultValue: String(DEFAULT_LEASE_TTL_MS),
} as const;

/** Control commands share the CLI registry but have no LocalStore dependency. */
export function createBackendCommands(
  services: BackendCommandServices,
): readonly CommandDefinition[] {
  const startAndStatus = (
    [
      ["start", "Start the local backend and wait for it to become ready."],
      ["status", "Report the current local backend status without starting it."],
    ] as const
  ).map(([operation, summary]) =>
    lifecycleDefinition({
      name: `backend.${operation}`,
      summary,
      resultSchema: backendStatusResultSchema,
      execute: async () =>
        toResult(
          await (
            await services.createSupervisor({ initialize: operation === "start" })
          )[operation](),
        ),
    }),
  );

  const stop: CommandDefinition = {
    name: "backend.stop",
    summary: "Stop the local backend, or safely hand it off only when it is idle.",
    positionals: [],
    options: [
      {
        longFlag: "--if-idle",
        description: "Stop only a verified idle Backend; active or unknown work is left running.",
        optionRequired: false,
      },
    ],
    resultSchema: stopResultSchema,
    errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const supervisor = await services.createSupervisor({ initialize: false });
        if (invocation.options.ifIdle === true)
          return { data: toHandoffResult(await supervisor.stopIfIdle()) };
        return { data: toResult(await supervisor.stop()) };
      } catch (error) {
        lifecycleError(error);
      }
    },
  };

  const leases: readonly CommandDefinition[] = [
    {
      name: "backend.lease.acquire",
      summary: "Acquire a machine-managed Backend task lease.",
      positionals: [],
      options: [leaseTtlOption],
      resultSchema: leaseResultSchema,
      errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
      exitCodes: [0, 2],
      async handler(invocation) {
        try {
          return {
            data: toLeaseResult(
              await (
                await services.createSupervisor({ initialize: false })
              ).acquireTaskLease(parseLeaseTtl(invocation.options.ttlMs)),
            ),
          };
        } catch (error) {
          lifecycleError(error);
        }
      },
    },
    {
      name: "backend.lease.renew",
      summary: "Renew a machine-managed Backend task lease.",
      positionals: [{ name: "lease-id", required: true }],
      options: [leaseTtlOption],
      resultSchema: leaseResultSchema,
      errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
      exitCodes: [0, 2],
      async handler(invocation) {
        try {
          const leaseId = invocation.positionals[0];
          if (leaseId === undefined) throw invalidInvocationError();
          return {
            data: toLeaseResult(
              await (
                await services.createSupervisor({ initialize: false })
              ).renewTaskLease(leaseId, parseLeaseTtl(invocation.options.ttlMs)),
            ),
          };
        } catch (error) {
          lifecycleError(error);
        }
      },
    },
    {
      name: "backend.lease.release",
      summary: "Release a machine-managed Backend task lease.",
      positionals: [{ name: "lease-id", required: true }],
      options: [],
      resultSchema: releasedLeaseResultSchema,
      errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
      exitCodes: [0, 2],
      async handler(invocation) {
        try {
          const leaseId = invocation.positionals[0];
          if (leaseId === undefined) throw invalidInvocationError();
          await (await services.createSupervisor({ initialize: false })).releaseTaskLease(leaseId);
          return { data: { released: true } };
        } catch (error) {
          lifecycleError(error);
        }
      },
    },
  ];

  return [...startAndStatus, stop, ...leases];
}

function lifecycleDefinition(input: {
  readonly name: string;
  readonly summary: string;
  readonly resultSchema: JsonSchema;
  readonly execute: () => Promise<JsonValue>;
}): CommandDefinition {
  return {
    name: input.name,
    summary: input.summary,
    positionals: [],
    options: [],
    resultSchema: input.resultSchema,
    errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
    exitCodes: [0, 2],
    async handler() {
      try {
        return { data: await input.execute() };
      } catch (error) {
        lifecycleError(error);
      }
    },
  };
}
