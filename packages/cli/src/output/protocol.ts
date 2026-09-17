import packageManifest from "../../package.json";

/** Version of the process-envelope contract. */
export const protocolVersion = 1;
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

/** Validates the outer response only; command `data` uses its registry result schema. */
export const protocolResponseSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "toolVersion", "command", "ok", "data"],
      properties: {
        protocolVersion: { const: protocolVersion },
        toolVersion: { type: "string" },
        command: { type: "string" },
        ok: { const: true },
        data: {},
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["protocolVersion", "toolVersion", "command", "ok", "error"],
      properties: {
        protocolVersion: { const: protocolVersion },
        toolVersion: { type: "string" },
        command: { type: "string" },
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
): ProtocolSuccess<T> {
  assertJsonValue(data);
  return {
    protocolVersion,
    toolVersion,
    command,
    ok: true,
    data,
  };
}

export function createFailureEnvelope(
  command: string,
  code: string,
  message: string,
  recovery?: ErrorRecovery,
): ProtocolFailure {
  return {
    protocolVersion,
    toolVersion,
    command,
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
