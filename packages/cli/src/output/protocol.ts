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
  };
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
          },
        },
      },
    },
  ],
} as const satisfies JsonSchema;

export function renderSuccess<T extends JsonValue>(
  writer: OutputWriter,
  command: string,
  data: T,
): void {
  assertJsonValue(data);
  const response: ProtocolSuccess<T> = {
    protocolVersion,
    toolVersion,
    command,
    ok: true,
    data,
  };
  writer.write(`${JSON.stringify(response)}\n`);
}

export function renderFailure(
  writer: OutputWriter,
  command: string,
  code: string,
  message: string,
): void {
  const response: ProtocolFailure = {
    protocolVersion,
    toolVersion,
    command,
    ok: false,
    error: { code, message },
  };
  writer.write(`${JSON.stringify(response)}\n`);
}

function assertJsonValue(value: unknown, ancestors: WeakSet<object> = new WeakSet()): void {
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
