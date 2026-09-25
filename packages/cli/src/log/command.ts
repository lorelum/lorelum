import { defaultDiagnosticsFallbackDirectory, defaultLogDirectory } from "@lorelum/config";
import {
  deriveTraceEvidenceState,
  isLogLevel,
  isTraceId,
  pruneManagedLogs,
  readManagedLogs,
  type LogLevel,
  type TraceId,
} from "@lorelum/log";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { frameworkErrorCodes, invalidInvocationError } from "../runtime/errors.js";

const recordsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["records", "locations", "missingEvidence", "truncated"],
  properties: {
    records: { type: "array", items: { type: "object" } },
    locations: { type: "array", items: { type: "string", enum: ["primary", "fallback"] } },
    missingEvidence: { type: "array", items: { type: "string" } },
    truncated: { type: "boolean" },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["status", "locations", "missingEvidence"],
      properties: {
        status: {
          enum: ["available", "not-persisted", "no-matching-records", "unreadable", "truncated"],
        },
        roots: { type: "array", items: { type: "string", enum: ["primary", "fallback"] } },
        missingEvidence: { type: "array", items: { type: "string" } },
      },
    },
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
  if (typeof value !== "string" || !/^[1-9][0-9]{0,3}$/.test(value)) throw invalidInvocationError();
  const parsed = Number(value);
  if (parsed > 1000) throw invalidInvocationError();
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
        if (
          (source !== undefined && (typeof source !== "string" || source.length === 0)) ||
          (traceId !== undefined && (typeof traceId !== "string" || !isTraceId(traceId))) ||
          (level !== undefined && !isLogLevel(level))
        ) {
          throw invalidInvocationError();
        }
        if (action === "prune") {
          if (
            source !== undefined ||
            traceId !== undefined ||
            level !== undefined ||
            invocation.options.limit !== undefined
          )
            throw invalidInvocationError();
          const rootDirectory = invocation.logDirectory ?? defaultLogDirectory();
          const result = await pruneManagedLogs({
            rootDirectory,
            // Explicit test overrides stay isolated from the real home fallback.
            ...(invocation.logDirectory === undefined
              ? { fallbackRootDirectory: defaultDiagnosticsFallbackDirectory() }
              : {}),
          });
          return { data: { deletedFiles: result.deletedFiles, deletedBytes: result.deletedBytes } };
        }
        if (action !== undefined) throw invalidInvocationError();
        const parsedLimit = limit(invocation.options.limit);
        const rootDirectory = invocation.logDirectory ?? defaultLogDirectory();
        const result = await readManagedLogs({
          rootDirectory,
          ...(invocation.logDirectory === undefined
            ? { fallbackRootDirectory: defaultDiagnosticsFallbackDirectory() }
            : {}),
          ...(source === undefined ? {} : { source }),
          ...(traceId === undefined ? {} : { traceId }),
          ...(level === undefined ? {} : { level: level as LogLevel }),
          ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
        });
        const evidence =
          traceId === undefined
            ? undefined
            : deriveTraceEvidenceState({
                traceId: traceId as TraceId,
                directRecords: result.records,
                directLocations: result.locations,
                missing: result.missing,
                truncated: result.truncated,
                rootAvailability: result.rootAvailability,
              });
        return {
          data: {
            records: result.records as unknown as JsonValue,
            locations: result.locations,
            missingEvidence: evidence?.missingEvidence ?? result.missing,
            truncated: result.truncated,
            ...(evidence === undefined
              ? {}
              : {
                  evidence: {
                    status: evidence.status,
                    roots: evidence.roots,
                    missingEvidence: evidence.missingEvidence,
                  },
                }),
          },
        };
      },
    },
  ];
}
