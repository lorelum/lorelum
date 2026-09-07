import {
  InvalidQueryRequestError,
  KeywordIndexError,
  KeywordIndexUnavailableError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type QueryHit,
  type QueryResult,
  type QueryService,
  type StorageRoot,
} from "@lorelum/engine";

import type { JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import {
  CliError,
  cliErrorCodes,
  frameworkErrorCodes,
  invalidInvocationError,
} from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import { queryResultSchema } from "./result-schema.js";

export interface QueryCommandServices {
  readonly queryService: QueryService;
  readonly storageRoot: StorageRoot;
}

function parseTopK(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw invalidInvocationError();
  return Number(value);
}

function toQueryResult(result: QueryResult): JsonValue {
  return {
    mode: result.mode,
    results: result.results.map((hit: QueryHit) => ({
      practiceId: hit.practiceId,
      title: hit.title,
      stage: hit.stage,
      techStack: [...hit.techStack],
      appliesWhen: hit.appliesWhen,
      severity: hit.severity,
      contentDigest: hit.contentDigest,
    })),
  };
}

function throwVisibleQueryError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (error instanceof InvalidQueryRequestError) throw invalidInvocationError();
  if (error instanceof KeywordIndexUnavailableError) {
    throw new CliError(cliErrorCodes.queryUnavailable, "Keyword query is unavailable.");
  }
  if (error instanceof KeywordIndexError) {
    throw new CliError(cliErrorCodes.queryFailed, "Keyword query failed.");
  }
  if (error instanceof StoreBusyError) {
    throw new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
  }
  if (error instanceof StoreRecoveryRequiredError) {
    throw new CliError(
      cliErrorCodes.storeRecoveryRequired,
      "The local Pack store requires recovery.",
    );
  }
  throw error;
}

export function createQueryCommand(services: QueryCommandServices): CommandDefinition {
  return {
    name: "query",
    summary: "Find installed Practices by keyword relevance.",
    positionals: [{ name: "text", required: true }],
    options: [
      {
        longFlag: "--top-k",
        description: "Return at most this many matching Practices.",
        value: { name: "n", required: true },
        optionRequired: false,
      },
    ],
    resultSchema: queryResultSchema,
    errorCodes: [
      ...frameworkErrorCodes,
      cliErrorCodes.queryUnavailable,
      cliErrorCodes.queryFailed,
      cliErrorCodes.storeBusy,
      cliErrorCodes.storeRecoveryRequired,
    ],
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const text = invocation.positionals[0];
        if (text === undefined) throw invalidInvocationError();
        const limit = parseTopK(invocation.options.topK);
        const root = resolveInvocationStorageRoot(
          invocation.options.storeRoot,
          services.storageRoot,
        );
        const request = limit === undefined ? { text } : { text, limit };
        const result = await services.queryService.query(root, request);
        return { data: toQueryResult(result) };
      } catch (error) {
        throwVisibleQueryError(error);
      }
    },
  };
}
