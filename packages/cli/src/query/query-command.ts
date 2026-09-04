import {
  DEFAULT_QUERY_TOP_K,
  MAX_QUERY_TOP_K,
  MIN_QUERY_TOP_K,
  createQueryService,
  defaultStorageRoot,
  type QueryService,
  type StorageRoot,
} from "@lorelum/engine";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { practiceSummarySchema, stringSchema } from "../output/schema-primitives.js";
import { retrievalErrorCodes } from "../retrieval/errors.js";
import { parseTopKOption } from "../retrieval/top-k-option.js";
import type { CommandDefinition } from "../registry.js";
import { invalidInvocationError } from "../runtime/errors.js";
import { throwVisibleStoreError } from "../runtime/store-errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";

export interface QueryCommandServices {
  readonly query: QueryService;
  readonly storageRoot: StorageRoot;
}

function defaultQueryServices(): QueryCommandServices {
  const storageRoot = defaultStorageRoot();
  return { query: createQueryService({ storageRoot }), storageRoot };
}

const resultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query", "k", "total", "generation", "effectiveRevision", "results"],
  properties: {
    query: stringSchema,
    k: { type: "integer" },
    total: { type: "integer" },
    generation: { type: "integer" },
    effectiveRevision: { type: "integer" },
    results: { type: "array", items: practiceSummarySchema },
  },
};

const topKBounds = {
  defaultTopK: DEFAULT_QUERY_TOP_K,
  minTopK: MIN_QUERY_TOP_K,
  maxTopK: MAX_QUERY_TOP_K,
} as const;

export function createQueryCommand(
  services: QueryCommandServices = defaultQueryServices(),
): CommandDefinition {
  return {
    name: "query",
    summary: "Retrieve Practices relevant to a natural-language engineering task.",
    positionals: [{ name: "query", required: true }],
    options: [
      {
        longFlag: "--top-k",
        description: "Maximum Practices to return; default 5, valid range 1-50.",
        value: { name: "count", required: true },
        optionRequired: false,
      },
    ],
    resultSchema,
    errorCodes: retrievalErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      const query = invocation.positionals[0];
      if (query === undefined || query.trim().length === 0) throw invalidInvocationError();
      const topK = parseTopKOption(invocation.options.topK, topKBounds);
      const storageRoot = resolveInvocationStorageRoot(
        invocation.options.storeRoot,
        services.storageRoot,
      );

      try {
        const result = await services.query.query({ query, topK, storageRoot });
        return { data: result as unknown as JsonValue };
      } catch (error) {
        throwVisibleStoreError(error);
      }
    },
  };
}
