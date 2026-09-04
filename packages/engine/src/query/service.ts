import {
  createLocalStore,
  defaultStorageRoot,
  type LocalStore,
  type StorageRoot,
} from "../local-store/lifecycle/local-store.js";
import { InvalidQueryError } from "./errors.js";
import { retrievePractices } from "./retrieve.js";
import type { QueryRequest, QueryResult } from "./types.js";

export interface QueryService {
  query(request: QueryRequest): Promise<QueryResult>;
}

export interface QueryServiceOptions {
  readonly store?: LocalStore;
  readonly storageRoot?: StorageRoot;
}

/**
 * Application boundary shared by CLI and future MCP adapters. It cold-opens
 * the selected LocalStore (per-call root override or the service default), then
 * delegates ranking to the pure retrieval function. The command never accepts
 * or decodes a caller-selected Pack path.
 */
export function createQueryService(options: QueryServiceOptions = {}): QueryService {
  const store = options.store ?? createLocalStore();
  const fallbackStorageRoot = options.storageRoot ?? defaultStorageRoot();

  return Object.freeze({
    async query(request: QueryRequest): Promise<QueryResult> {
      if (typeof request.query !== "string" || request.query.trim().length === 0) {
        throw new InvalidQueryError();
      }

      const opened = await store.open(request.storageRoot ?? fallbackStorageRoot);
      return {
        ...retrievePractices({
          effectivePractices: opened.effectivePractices,
          query: request.query,
          ...(request.topK === undefined ? {} : { topK: request.topK }),
        }),
        generation: opened.generation,
        effectiveRevision: opened.effectiveRevision,
      };
    },
  });
}
