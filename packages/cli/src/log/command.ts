import { defaultLogDirectory } from "@lorelum/config";
import {
  isLogLevel,
  isTraceId,
  pruneManagedLogs,
  readManagedLogs,
  type LogLevel,
} from "@lorelum/log";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { frameworkErrorCodes, invalidInvocationError } from "../runtime/errors.js";

const recordsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["records", "missingEvidence", "truncated"],
  properties: {
    records: { type: "array", items: { type: "object" } },
    missingEvidence: { type: "array", items: { type: "string" } },
    truncated: { type: "boolean" },
  },
};

const pruneSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["deletedFiles", "deletedBytes"],
  properties: { deletedFiles: { type: "integer" }, deletedBytes: { type: "integer" } },
};

function limit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,3}$/.test(value))
    throw invalidInvocationError("--limit must be an integer from 1 through 1000.");
  const parsed = Number(value);
  if (parsed > 1000)
    throw invalidInvocationError("--limit must be an integer from 1 through 1000.");
  return parsed;
}

export function createLogCommands(): readonly CommandDefinition[] {
  return [
    {
      name: "logs",
      summary: "View managed local logs or prune retained files.",
      positionals: [{ name: "action", required: false, values: ["prune"] }],
      options: [
        {
          longFlag: "--source",
          description: "Limit records to one stable logger source.",
          value: { name: "source", required: true },
          optionRequired: false,
        },
        {
          longFlag: "--trace-id",
          description: "Limit records to one invocation trace.",
          value: { name: "trace-id", required: true },
          optionRequired: false,
        },
        {
          longFlag: "--level",
          description: "Limit records to one local log level.",
          value: { name: "level", required: true },
          optionRequired: false,
          values: ["error", "warn", "info", "debug"],
        },
        {
          longFlag: "--limit",
          description: "Return at most this many records (1-1000).",
          value: { name: "count", required: true },
          optionRequired: false,
        },
      ],
      resultSchema: { oneOf: [recordsSchema, pruneSchema] },
      errorCodes: frameworkErrorCodes,
      exitCodes: [0, 2],
      async handler(invocation) {
        const action = invocation.positionals[0];
        const source = invocation.options.source;
        const traceId = invocation.options.traceId;
        const level = invocation.options.level;
        if (source !== undefined && (typeof source !== "string" || source.length === 0))
          throw invalidInvocationError("--source must be non-empty.");
        if (traceId !== undefined && (typeof traceId !== "string" || !isTraceId(traceId)))
          throw invalidInvocationError("--trace-id must be a valid invocation trace ID.");
        if (level !== undefined && !isLogLevel(level))
          throw invalidInvocationError("--level must be error, warn, info or debug.");
        if (action === "prune") {
          if (
            source !== undefined ||
            traceId !== undefined ||
            level !== undefined ||
            invocation.options.limit !== undefined
          )
            throw invalidInvocationError(
              "logs prune does not accept --source, --trace-id, --level or --limit.",
            );
          const result = await pruneManagedLogs({
            rootDirectory: invocation.logDirectory ?? defaultLogDirectory(),
          });
          return { data: { deletedFiles: result.deletedFiles, deletedBytes: result.deletedBytes } };
        }
        if (action !== undefined)
          throw invalidInvocationError("Only logs prune is a valid action.");
        const parsedLimit = limit(invocation.options.limit);
        const result = await readManagedLogs({
          rootDirectory: invocation.logDirectory ?? defaultLogDirectory(),
          ...(source === undefined ? {} : { source }),
          ...(traceId === undefined ? {} : { traceId }),
          ...(level === undefined ? {} : { level: level as LogLevel }),
          ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
        });
        return {
          data: {
            records: result.records as unknown as JsonValue,
            missingEvidence: result.missing,
            truncated: result.truncated,
          },
        };
      },
    },
  ];
}
