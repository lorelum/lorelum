import {
  BackendError,
  BackendRemoteError,
  backendErrorCodes,
  backendRemoteErrorCodes,
  embeddingErrorCodes,
  EmbeddingError,
} from "@lorelum/backend/protocol";
import type { BackendClient } from "@lorelum/backend/client";
import {
  InvalidQueryRequestError,
  KeywordIndexError,
  KeywordIndexUnavailableError,
  parseQueryRequest,
  StoreBusyError,
  StoreRecoveryRequiredError,
  type QueryHit,
  type QueryResult,
  type QueryService,
  type SemanticQueryResult,
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
  readonly createClient: () => Promise<Pick<BackendClient, "query">>;
  readonly storageRoot: StorageRoot;
}

const queryModes = ["semantic", "keyword"] as const;
type QueryMode = (typeof queryModes)[number];
const queryErrorCodes = Object.freeze([
  ...new Set([
    ...frameworkErrorCodes,
    ...backendErrorCodes,
    ...embeddingErrorCodes,
    ...backendRemoteErrorCodes,
  ]),
]);

function parseMode(value: unknown): QueryMode {
  if (value === undefined) return "semantic";
  if (typeof value !== "string" || !queryModes.includes(value as QueryMode)) {
    throw invalidInvocationError();
  }
  return value as QueryMode;
}

function parseTopK(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw invalidInvocationError();
  return Number(value);
}

function toQueryResult(result: QueryResult | SemanticQueryResult): JsonValue {
  return {
    mode: result.mode,
    ...(result.mode === "semantic"
      ? { profileId: result.profileId, coverage: result.coverage }
      : {}),
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
  if (error instanceof BackendError || error instanceof EmbeddingError) {
    throw new CliError(error.code, error.message);
  }
  if (error instanceof BackendRemoteError) {
    throw new CliError(error.code, queryRemoteErrorMessage(error.code));
  }
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

function queryRemoteErrorMessage(code: (typeof backendRemoteErrorCodes)[number]): string {
  switch (code) {
    case "usage.invalid":
      return "The command invocation is invalid.";
    case "query.unavailable":
      return "Keyword query is unavailable.";
    case "query.failed":
      return "Keyword query failed.";
    case "semantic.index-not-ready":
      return "Build the semantic index before running a semantic query.";
    case "semantic.index-incompatible":
      return "The semantic index is incompatible; build or rebuild it.";
    case "semantic.index-failed":
      return "The semantic index could not answer the query.";
    case "semantic.embedding-failed":
      return "Semantic query embedding failed.";
    case "store.busy":
      return "The local Pack store is busy.";
    case "store.recovery-required":
      return "The local Pack store requires recovery.";
  }
}

export function createQueryCommand(services: QueryCommandServices): CommandDefinition {
  return {
    name: "query",
    summary: "Find installed Practices by semantic or keyword relevance.",
    positionals: [{ name: "text", required: true }],
    options: [
      {
        longFlag: "--mode",
        description: "Choose semantic relevance (default) or the offline keyword index.",
        value: { name: "mode", required: true },
        optionRequired: false,
        defaultValue: "semantic",
        values: queryModes,
      },
      {
        longFlag: "--top-k",
        description: "Return at most this many matching Practices.",
        value: { name: "n", required: true },
        optionRequired: false,
      },
    ],
    resultSchema: queryResultSchema,
    errorCodes: queryErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        const text = invocation.positionals[0];
        if (text === undefined) throw invalidInvocationError();
        const mode = parseMode(invocation.options.mode);
        const limit = parseTopK(invocation.options.topK);
        // Validate domain input before resolving or connecting to the Backend.
        parseQueryRequest(limit === undefined ? { text } : { text, limit });
        const root = resolveInvocationStorageRoot(
          invocation.options.storeRoot,
          services.storageRoot,
        );
        const request = limit === undefined ? { text } : { text, limit };
        const result =
          mode === "keyword"
            ? await services.queryService.query(root, request)
            : await (await services.createClient()).query(root, { ...request, mode });
        return { data: toQueryResult(result) };
      } catch (error) {
        throwVisibleQueryError(error);
      }
    },
  };
}
