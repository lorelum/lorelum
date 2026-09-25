import {
  BackendError,
  BackendRemoteError,
  backendErrorCodes,
  backendRemoteErrorCodes,
  embeddingErrorCodes,
  EmbeddingError,
} from "@lorelum/backend/protocol";
import {
  InvalidProjectRootError,
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
  type ProjectContextSnapshot,
  type StorageRoot,
  queryContentAddressedKeyword,
} from "@lorelum/engine";

import type { JsonValue } from "../output/protocol.js";
import type { CommandDefinition, CommandInvocation } from "../registry.js";
import {
  CliError,
  cliErrorCodes,
  frameworkErrorCodes,
  invalidInvocationError,
} from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import {
  backendProjectTargetOptions,
  resolveProjectInvocationOptions,
  type ProjectContextResolver,
} from "../project-context/service.js";
import { queryResultSchema } from "./result-schema.js";
import type { SemanticRuntimeClient, SemanticRuntimeResult } from "./runtime-client.js";
import { DEFAULT_QUERY_SETTINGS, type QuerySettings } from "./settings.js";
import type { TraceId } from "@lorelum/log";

interface QueryIndexingResult {
  readonly state: "indexing";
  readonly operationId: string;
  readonly indexedPracticeCount: number;
  readonly totalPracticeCount: number;
  readonly context?: QueryContextData;
}

interface QueryContextData {
  readonly state: "ready" | "degraded";
  readonly warnings: readonly {
    readonly code: "config.invalid" | "pack.invalid" | "practice.invalid" | "source.unsafe";
    readonly layerDepth: number;
    readonly packName?: string;
    readonly practiceId?: string;
  }[];
}

interface AnnotatedSemanticQueryResult extends SemanticQueryResult {
  readonly indexedPracticeCount?: number;
  readonly totalPracticeCount?: number;
  readonly operationId?: string;
  readonly context?: QueryContextData;
}

export interface QueryCommandServices {
  readonly queryService: QueryService;
  readonly createClient: (traceId?: TraceId, debug?: boolean) => Promise<SemanticRuntimeClient>;
  readonly storageRoot: StorageRoot;
  /** The registry wires this to Engine; tests can keep an isolated Store-only route. */
  readonly resolveProjectContext?: ProjectContextResolver;
  readonly loadSettings?: () => Promise<QuerySettings>;
}

const queryModes = ["semantic", "keyword"] as const;
type QueryMode = (typeof queryModes)[number];
const queryErrorCodes = Object.freeze([
  ...new Set([
    ...frameworkErrorCodes,
    cliErrorCodes.queryConfigInvalid,
    ...backendErrorCodes,
    ...embeddingErrorCodes,
    ...backendRemoteErrorCodes,
  ]),
]);

function parseMode(value: unknown): QueryMode {
  if (value === undefined) return "semantic";
  if (typeof value !== "string" || !queryModes.includes(value as QueryMode)) {
    throw invalidInvocationError("--mode must be semantic or keyword.");
  }
  return value as QueryMode;
}

function parseTopK(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value))
    throw invalidInvocationError("--top-k must be a non-negative integer.");
  return Number(value);
}

function parseIntegerOption(
  value: unknown,
  option: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^-?[0-9]+$/.test(value)) {
    throw integerOptionError(option, min, max);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw integerOptionError(option, min, max);
  }
  return parsed;
}

function integerOptionError(option: string, min: number, max: number): CliError {
  return invalidInvocationError(`${option} must be an integer from ${min} through ${max}.`);
}

function toQueryResult(
  result: QueryResult | SemanticQueryResult | SemanticRuntimeResult | QueryIndexingResult,
  project?: ProjectContextSnapshot,
): JsonValue {
  const context =
    project !== undefined
      ? { context: projectContextData(project) }
      : "context" in result && result.context !== undefined
        ? { context: result.context }
        : {};
  if ("state" in result && result.state === "preparing") {
    return {
      state: result.state,
      preparationId: result.preparationId,
      message:
        ("message" in result ? result.message : undefined) ??
        "The local model is preparing in the background. Check lore model status, then retry this query.",
      ...context,
    };
  }
  if ("state" in result && result.state === "indexing") {
    return {
      state: result.state,
      operationId: result.operationId,
      indexedPracticeCount: result.indexedPracticeCount,
      totalPracticeCount: result.totalPracticeCount,
      message: "The semantic index is building in the background. Retry this query shortly.",
      ...context,
    };
  }
  const queryResult = result as QueryResult | AnnotatedSemanticQueryResult;
  return {
    mode: queryResult.mode,
    ...(queryResult.mode === "semantic"
      ? {
          profileId: queryResult.profileId,
          coverage: queryResult.coverage,
          ...("indexedPracticeCount" in queryResult &&
          queryResult.indexedPracticeCount !== undefined &&
          queryResult.totalPracticeCount !== undefined
            ? {
                indexedPracticeCount: queryResult.indexedPracticeCount,
                totalPracticeCount: queryResult.totalPracticeCount,
                ...(queryResult.operationId === undefined
                  ? {}
                  : { operationId: queryResult.operationId }),
              }
            : {}),
        }
      : {}),
    results: queryResult.results.map((hit: QueryHit) => ({
      practiceId: hit.practiceId,
      title: hit.title,
      stage: hit.stage,
      techStack: [...hit.techStack],
      appliesWhen: hit.appliesWhen,
      severity: hit.severity,
      contentDigest: hit.contentDigest,
    })),
    ...context,
  };
}

function projectContextData(project: ProjectContextSnapshot): JsonValue {
  return {
    state: project.state,
    warnings: project.warnings.map((warning) => ({
      code: warning.code,
      layerDepth: warning.layerDepth,
      ...(warning.packName === undefined ? {} : { packName: warning.packName }),
      ...(warning.practiceId === undefined ? {} : { practiceId: warning.practiceId }),
    })),
  };
}

function throwVisibleQueryError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (error instanceof InvalidQueryRequestError)
    throw invalidInvocationError(
      "The query or its options are invalid. Check the query text, --top-k and --mode.",
    );
  if (error instanceof BackendError || error instanceof EmbeddingError) {
    throw new CliError(
      error.code,
      error.message,
      error instanceof BackendError ? error.recovery : undefined,
    );
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
  if (error instanceof InvalidProjectRootError)
    throw invalidInvocationError("--project-root must point to a valid project directory.");
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
    summary: "Find current Practices by semantic or keyword relevance.",
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
      {
        longFlag: "--max-wait-ms",
        description: "Wait at most this many milliseconds for semantic index progress.",
        value: { name: "milliseconds", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--min-coverage-percent",
        description:
          "Require this percentage of current Practices before returning a partial result.",
        value: { name: "percent", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--require-complete",
        description: "Return only a complete semantic result for this invocation.",
        optionRequired: false,
      },
    ],
    resultSchema: queryResultSchema,
    errorCodes: queryErrorCodes,
    exitCodes: [0, 1, 2],
    async handler(invocation) {
      try {
        const text = invocation.positionals[0];
        if (text === undefined)
          throw invalidInvocationError("Provide query text. Run lore query --help for usage.");
        const mode = parseMode(invocation.options.mode);
        const limit = parseTopK(invocation.options.topK);
        const maxWaitOverride = parseIntegerOption(
          invocation.options.maxWaitMs,
          "--max-wait-ms",
          0,
          120_000,
        );
        const minCoverageOverride = parseIntegerOption(
          invocation.options.minCoveragePercent,
          "--min-coverage-percent",
          0,
          100,
        );
        if (invocation.options.requireComplete === true && minCoverageOverride !== undefined) {
          throw invalidInvocationError(
            "Use --require-complete or --min-coverage-percent, not both.",
          );
        }
        // Validate domain input before resolving or connecting to the Backend.
        parseQueryRequest(limit === undefined ? { text } : { text, limit });
        const root = resolveInvocationStorageRoot(
          invocation.options.storeRoot,
          services.storageRoot,
        );
        const projectOptions = resolveProjectInvocationOptions(invocation.options);
        const settings = await (
          services.loadSettings ?? (() => Promise.resolve(DEFAULT_QUERY_SETTINGS))
        )();
        const maxWaitMs = maxWaitOverride ?? settings.maxWaitMs;
        const minCoveragePercent =
          invocation.options.requireComplete === true
            ? 100
            : (minCoverageOverride ?? settings.minCoveragePercent);
        const request = limit === undefined ? { text } : { text, limit };
        const project =
          mode !== "keyword" || services.resolveProjectContext === undefined
            ? undefined
            : await services.resolveProjectContext(root, projectOptions);
        const result =
          mode === "keyword"
            ? await queryKeyword(
                services,
                root,
                project,
                projectOptions.cacheRoot,
                request,
                invocation,
              )
            : await (
                await services.createClient(invocation.traceId, invocation.options.debug === true)
              ).query(root, {
                ...request,
                mode,
                maxWaitMs,
                minCoveragePercent,
                ...backendProjectTargetOptions(projectOptions),
              });
        const data = toQueryResult(result, project);
        return { data, ...(dataIsPending(data) ? { exitCode: 1 as const } : {}) };
      } catch (error) {
        throwVisibleQueryError(error);
      }
    },
  };
}

async function queryKeyword(
  services: QueryCommandServices,
  root: StorageRoot,
  project:
    | Awaited<ReturnType<NonNullable<QueryCommandServices["resolveProjectContext"]>>>
    | undefined,
  cacheRoot: string,
  request: { readonly text: string; readonly limit?: number },
  invocation: Pick<CommandInvocation, "traceId" | "diagnostics">,
): Promise<QueryResult> {
  if (project === undefined)
    return services.queryService.query(
      root,
      request,
      invocation.diagnostics === undefined
        ? undefined
        : { emitter: invocation.diagnostics, traceId: invocation.traceId },
    );
  return queryContentAddressedKeyword(project, cacheRoot, request, {
    sourceSlotId: project.projectRootId,
  });
}

function dataIsPending(data: JsonValue): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "state" in data &&
    (data.state === "preparing" || data.state === "indexing")
  );
}
