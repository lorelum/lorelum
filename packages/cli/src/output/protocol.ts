import packageManifest from "../../package.json";

export const protocolVersion = 1;
export const toolVersion = packageManifest.version;

export interface OutputWriter {
  write(message: string): void;
}

interface EnvelopeBase {
  protocolVersion: number;
  toolVersion: string;
  command: string;
}

export interface ProtocolSuccess<T> extends EnvelopeBase {
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

/** Candidate v1 JSON Schema used by protocol fixtures and command integrations. */
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
} as const;

export function renderSuccess<T>(writer: OutputWriter, command: string, data: T): void {
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
