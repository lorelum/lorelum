import { ConfigError } from "@lorelum/config";
import { loadBackendConfig } from "@lorelum/backend/config";
import type { BackendSupervisor } from "@lorelum/backend/control";
import {
  BackendError,
  backendErrorCodes,
  backendStatusStates,
  modelStates,
  PROTOCOL_VERSION,
  type BackendStatus,
  type BuildInfo,
} from "@lorelum/backend/protocol";

import { initializeApplicationConfig } from "../config/initialize";
import type { JsonSchema, JsonValue } from "../output/protocol";
import type { CommandDefinition } from "../registry";
import { frameworkErrorCodes, invalidInvocationError } from "../runtime/errors";
import type { TextRenderer } from "../output/render";
import { backendCliError } from "./error";

export interface BackendCommandServices {
  readonly createSupervisor: (options?: {
    initialize?: boolean;
    buildIdentity?: string;
  }) => Promise<BackendSupervisor>;
  readonly currentBuildInfo: () => Promise<BuildInfo>;
}

const DEFAULT_LEASE_TTL_MS = 60_000;

// Translate the Zod status contract into the smaller JSON schema dialect used
// by CLI discovery. The adapter stays local because CLI output is not an HTTP
// schema and does not need a general Zod-to-JSON-Schema converter.
const provenanceProperties: Readonly<Record<string, JsonSchema>> = {
  toolVersion: { type: "string" },
  revision: { oneOf: [{ type: "string" }, { const: null }] },
  dirty: { oneOf: [{ type: "boolean" }, { const: null }] },
  buildKind: { enum: ["source", "compiled"] },
};
const provenanceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(provenanceProperties),
  properties: provenanceProperties,
};
const cliBuildSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(provenanceProperties), "buildIdentity", "backendProtocolVersion"],
  properties: {
    ...provenanceProperties,
    buildIdentity: { type: "string" },
    backendProtocolVersion: { const: PROTOCOL_VERSION },
  },
};
const backendStatusResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "model"],
  properties: {
    state: { enum: backendStatusStates },
    model: { enum: modelStates },
    instanceId: { type: "string" },
    buildIdentity: { type: "string" },
    backendProtocolVersion: { type: "integer" },
    build: provenanceSchema,
  },
};
const observedStatusResultSchema: JsonSchema = {
  ...backendStatusResultSchema,
  required: [...(backendStatusResultSchema.required ?? []), "cli"],
  properties: {
    ...backendStatusResultSchema.properties,
    cli: cliBuildSchema,
    sameBuild: { type: "boolean" },
    protocolCompatible: { const: true },
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
const startResultSchema: JsonSchema = {
  oneOf: [
    observedStatusResultSchema,
    {
      ...stopIfIdleResultSchema,
      required: ["state", "reason"],
      properties: {
        ...stopIfIdleResultSchema.properties,
        state: { const: "deferred" },
      },
    },
  ],
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
  options: { initialize?: boolean; buildIdentity?: string } = {},
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
      if (error instanceof ConfigError)
        throw new BackendError("backend.config-invalid", { cause: error }, error.message);
      throw error;
    }
  }
  return createBackendSupervisor({
    config: await loadBackendConfig(),
    buildIdentity: options.buildIdentity ?? (await currentBuildIdentity(entrypoint)),
    command,
    daemonArgv0: "lore-backend",
  });
}

function toResult(status: BackendStatus, cli?: BuildInfo): JsonValue {
  return {
    state: status.state,
    model: status.model,
    ...(status.state === "stopped"
      ? {}
      : {
          instanceId: status.instanceId,
          buildIdentity: status.buildIdentity,
          backendProtocolVersion: status.backendProtocolVersion,
          build: status.build,
        }),
    ...(cli === undefined ? {} : { cli: { ...cli, backendProtocolVersion: PROTOCOL_VERSION } }),
    ...(cli === undefined || status.state === "stopped"
      ? {}
      : {
          sameBuild: cli.buildIdentity === status.buildIdentity,
          protocolCompatible: true,
        }),
  };
}

function toHandoffResult(result: Awaited<ReturnType<BackendSupervisor["stopIfIdle"]>>): JsonValue {
  return {
    state: result.state,
    ...(result.state === "deferred" ? { reason: result.reason } : {}),
  };
}

function toLeaseResult(
  result: Awaited<ReturnType<BackendSupervisor["acquireTaskLease"]>>,
): JsonValue {
  return { leaseId: result.leaseId, expiresAt: result.expiresAt };
}

function parseLeaseTtl(value: unknown): number {
  if (value === undefined) return DEFAULT_LEASE_TTL_MS;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw invalidInvocationError("--ttl-ms must be an integer from 1000 through 300000.");
  const ttlMs = Number(value);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000)
    throw invalidInvocationError("--ttl-ms must be an integer from 1000 through 300000.");
  return ttlMs;
}

async function lifecycleError(error: unknown, build?: BuildInfo): Promise<never> {
  if (error instanceof BackendError) throw await backendCliError(error, build);
  throw error;
}

const renderBackendStatus: TextRenderer = (data, fallback) => {
  if (!isJsonObject(data)) return fallback(data);
  if (data.state === "deferred")
    return `Backend switch deferred: ${data.reason}. Leave the current backend running; retry this command after the active work finishes or its activity is resolved.`;
  const cli = data.cli;
  if (!isJsonObject(cli)) return fallback(data);
  const lines = [`Backend: ${data.state}; model: ${data.model}`];
  const build = data.build;
  if (isJsonObject(build))
    lines.push(
      `Backend build: ${buildLabel(build)}; id ${String(data.buildIdentity).slice(0, 12)}; protocol ${data.backendProtocolVersion}`,
    );
  lines.push(
    `CLI build: ${buildLabel(cli)}; id ${String(cli.buildIdentity).slice(0, 12)}; protocol ${cli.backendProtocolVersion}`,
  );
  if (data.sameBuild !== undefined)
    lines.push(`Same build: ${data.sameBuild ? "yes" : "no"}; protocol compatible: yes`);
  return lines.join("\n");
};

function isJsonObject(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildLabel(build: Readonly<Record<string, JsonValue>>): string {
  const revision =
    typeof build.revision === "string" ? build.revision.slice(0, 8) : "revision unknown";
  const dirty = build.dirty === true ? " dirty" : build.dirty === null ? " (dirty unknown)" : "";
  return `${build.toolVersion} ${build.buildKind} ${revision}${dirty}`;
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
  const startAndStatus: CommandDefinition[] = (["start", "status"] as const).map((operation) => ({
    name: `backend.${operation}`,
    summary:
      operation === "start"
        ? "Start or reuse the local backend; optionally require this exact build."
        : "Report the current local backend status without starting it.",
    positionals: [],
    options:
      operation === "start"
        ? [
            {
              longFlag: "--current-build",
              description:
                "Ensure this exact build is running; switch another build only when the backend is idle.",
              optionRequired: false,
            },
          ]
        : [],
    resultSchema: operation === "start" ? startResultSchema : observedStatusResultSchema,
    textRenderer: renderBackendStatus,
    errorCodes: [...frameworkErrorCodes, ...backendErrorCodes],
    exitCodes: operation === "start" ? [0, 1, 2] : [0, 2],
    async handler(invocation) {
      const build = await services.currentBuildInfo();
      try {
        const supervisor = await services.createSupervisor({
          initialize: operation === "start",
          buildIdentity: build.buildIdentity,
        });
        const result =
          operation === "status"
            ? await supervisor.status()
            : invocation.options.currentBuild === true
              ? await supervisor.start({ requireCurrentBuild: true })
              : await supervisor.start();
        if (result.state === "deferred") return { data: toHandoffResult(result), exitCode: 1 };
        return { data: toResult(result, build) };
      } catch (error) {
        return lifecycleError(error, build);
      }
    },
  }));

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
        return lifecycleError(error);
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
          return lifecycleError(error);
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
          if (leaseId === undefined) throw invalidInvocationError("Provide a lease ID to renew.");
          return {
            data: toLeaseResult(
              await (
                await services.createSupervisor({ initialize: false })
              ).renewTaskLease(leaseId, parseLeaseTtl(invocation.options.ttlMs)),
            ),
          };
        } catch (error) {
          return lifecycleError(error);
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
          if (leaseId === undefined) throw invalidInvocationError("Provide a lease ID to release.");
          await (await services.createSupervisor({ initialize: false })).releaseTaskLease(leaseId);
          return { data: { released: true } };
        } catch (error) {
          return lifecycleError(error);
        }
      },
    },
  ];

  return [...startAndStatus, stop, ...leases];
}
