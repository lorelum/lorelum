import {
  createLocalStore,
  defaultStorageRoot,
  type LocalStore,
  type StorageRoot,
} from "../local-store/lifecycle/local-store.js";
import { UnknownPracticeError } from "./errors.js";
import { retrievePractice } from "./retrieve.js";
import type { GetRequest, GetResult } from "./types.js";

export interface GetService {
  get(request: GetRequest): Promise<GetResult>;
}

export interface GetServiceOptions {
  readonly store?: LocalStore;
  readonly storageRoot?: StorageRoot;
}

/**
 * Application boundary shared by CLI and future MCP adapters. It cold-opens
 * the selected LocalStore (per-call root override or the service default),
 * resolves exactly one Practice id, and converts the pure retrieval layer's
 * `null` into `UnknownPracticeError`. The CLI never inspects `null` and never
 * constructs that error itself (ADR 0011).
 */
export function createGetService(options: GetServiceOptions = {}): GetService {
  const store = options.store ?? createLocalStore();
  const fallbackStorageRoot = options.storageRoot ?? defaultStorageRoot();

  return Object.freeze({
    async get(request: GetRequest): Promise<GetResult> {
      const practiceId = request.practiceId;
      if (typeof practiceId !== "string" || practiceId.trim().length === 0) {
        // The service accepts valid-format ids and treats an unknown id as a
        // domain error; syntax-only rejection is owned by the CLI adapter.
        throw new UnknownPracticeError(practiceId);
      }

      const opened = await store.open(request.storageRoot ?? fallbackStorageRoot);
      const retrieved = retrievePractice(opened.effectivePractices, practiceId);
      if (retrieved === null) throw new UnknownPracticeError(practiceId);
      return {
        ...retrieved,
        generation: opened.generation,
        effectiveRevision: opened.effectiveRevision,
      };
    },
  });
}
