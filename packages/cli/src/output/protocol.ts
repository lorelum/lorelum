import packageManifest from "../../package.json";
import { createTraceId, type PersistenceOutcomeFact, type TraceId } from "@lorelum/log";

/**
 * Version of the process-envelope contract. v3 adds the optional
 * `diagnostics.logPersistence` deviation report (issue #224); the addition is
 * not representable under the v2 schema's `additionalProperties: false`.
 */
export const protocolVersion = 3;
/** Version of the CLI implementation emitting the envelope. */
export const toolVersion = packageManifest.version;

export type JsonSchema = {
  oneOf?: readonly JsonSchema[];
  type?: "array" | "boolean" | "integer" | "object" | "string";
  const?: unknown;
  enum?: readonly unknown[];
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Readonly<Record<string, JsonSchema>>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<Record<string, unknown>>;

export interface OutputWriter {
  write(message: string): void;
}

interface EnvelopeBase {
  protocolVersion: number;
  toolVersion: string;
  command: string;
  diagnostics: ProtocolDiagnostics;
}

export interface ProtocolDiagnostics {
  readonly traceId: TraceId;
  /**
   * Present only when this invocation's diagnostics persistence deviated from
   * the quiet normal path (repaired, diverted to the fallback, or failed).
   */
  readonly logPersistence?: PersistenceOutcomeFact;
}

export interface ProtocolSuccess<T extends JsonValue = JsonValue> extends EnvelopeBase {
  ok: true;
  data: T;
}

export interface ProtocolFailure extends EnvelopeBase {
  ok: false;
  error: {
    code: string;
    message: string;
    recovery?: ErrorRecovery;
  };
}

export interface ErrorRecovery {
  readonly action: "backend.stop-if-idle";
  readonly automation: "auto" | "defer";
  readonly reason: "idle" | "active-long-task" | "unknown-activity";
  readonly retry: "original-command";
}

const logPersistenceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["persisted", "fallbackUsed", "attemptedPath", "usedPath"],
  properties: {
    persisted: { type: "boolean" },
    fallbackUsed: { type: "boolean" },
    attemptedPath: { type: "string" },
    usedPath: { type: "string" },
    fallbackAttemptPath: { type: "string" },
    failure: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "path"],
      properties: {
        kind: { enum: ["location-unavailable", "location-error", "write-failed"] },
        path: { type: "string" },
        reason: { type: "string" },
        error: { type: "string" },
      },
    },
    repairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "kind", "beforeMode", "afterMode"],
        properties: {
          path: { type: "string" },
          kind: { type: "string" },
          beforeMode: { type: "integer" },
          afterMode: { type: "integer" },
        },
      },
    },
  },
};

/** Validates the outer response only; command `data` uses its registry result schema. */
export const protocolResponseSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "toolVersion", "command", "diagnostics", "ok", "data"],
      properties: {
        protocolVersion: { const: protocolVersion },
        toolVersion: { type: "string" },
        command: { type: "string" },
        diagnostics: {
          type: "object",
          additionalProperties: false,
          required: ["traceId"],
          properties: {
            traceId: { type: "string" },
            logPersistence: logPersistenceSchema,
          },
        },
        ok: { const: true },
        data: {},
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "toolVersion", "command", "diagnostics", "ok", "error"],
      properties: {
        protocolVersion: { const: protocolVersion },
        toolVersion: { type: "string" },
        command: { type: "string" },
        diagnostics: {
          type: "object",
          additionalProperties: false,
          required: ["traceId"],
          properties: {
            traceId: { type: "string" },
            logPersistence: logPersistenceSchema,
          },
        },
        ok: { const: false },
        error: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            recovery: {
              type: "object",
              additionalProperties: false,
              required: ["action", "automation", "reason", "retry"],
              properties: {
                action: { const: "backend.stop-if-idle" },
                automation: { enum: ["auto", "defer"] },
                reason: { enum: ["idle", "active-long-task", "unknown-activity"] },
                retry: { const: "original-command" },
              },
            },
          },
        },
      },
    },
  ],
} as const satisfies JsonSchema;

export function createSuccessEnvelope<T extends JsonValue>(
  command: string,
  data: T,
  diagnostics: ProtocolDiagnostics = { traceId: createTraceId() },
): ProtocolSuccess<T> {
  assertJsonValue(data);
  return {
    protocolVersion,
    toolVersion,
    command,
    diagnostics,
    ok: true,
    data,
  };
}

export function createFailureEnvelope(
  command: string,
  code: string,
  message: string,
  recovery?: ErrorRecovery,
  diagnostics: ProtocolDiagnostics = { traceId: createTraceId() },
): ProtocolFailure {
  return {
    protocolVersion,
    toolVersion,
    command,
    diagnostics,
    ok: false,
    error: { code, message, ...(recovery === undefined ? {} : { recovery }) },
  };
}

export function assertJsonValue(value: unknown, ancestors: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError("Protocol data contains a non-finite number.");
  }
  if (typeof value !== "object") {
    throw new TypeError("Protocol data is not JSON-safe.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Protocol data contains a circular reference.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, ancestors);
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Protocol data must contain only plain JSON objects.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Protocol data contains symbol properties.");
    }
    for (const nestedValue of Object.values(value)) {
      assertJsonValue(nestedValue, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}
