import {
  createLocalStore,
  defaultStorageRoot,
  type LocalStore,
  type StorageRoot,
} from "../local-store/index.js";
import { UnknownPackError } from "./errors.js";
import { retrievePackPractices, retrievePacks } from "./retrieve.js";
import type {
  ListPackPracticesResult,
  ListPackRequest,
  ListPacksResult,
  ListRequest,
} from "./types.js";

export interface ListService {
  list(request?: ListRequest): Promise<ListPacksResult>;
  listPack(request: ListPackRequest): Promise<ListPackPracticesResult>;
}

export interface ListServiceOptions {
  readonly store?: Pick<LocalStore, "open">;
  readonly storageRoot?: StorageRoot;
}

/** Application boundary for the LocalStore-backed `lore list` catalog. */
export function createListService(options: ListServiceOptions = {}): ListService {
  const store = options.store ?? createLocalStore();
  const fallbackStorageRoot = options.storageRoot ?? defaultStorageRoot();

  return Object.freeze({
    async list(request: ListRequest = {}): Promise<ListPacksResult> {
      const opened = await store.open(request.storageRoot ?? fallbackStorageRoot);
      return Object.freeze({
        ...retrievePacks({
          packs: opened.packs,
          effectivePractices: opened.effectivePractices,
        }),
        generation: opened.generation,
        effectiveRevision: opened.effectiveRevision,
      });
    },

    async listPack(request: ListPackRequest): Promise<ListPackPracticesResult> {
      if (typeof request.packName !== "string" || request.packName.trim().length === 0) {
        throw new UnknownPackError(String(request.packName));
      }

      const opened = await store.open(request.storageRoot ?? fallbackStorageRoot);
      const retrieved = retrievePackPractices({
        packName: request.packName,
        packs: opened.packs,
        effectivePractices: opened.effectivePractices,
      });
      if (retrieved === null) throw new UnknownPackError(request.packName);
      return Object.freeze({
        ...retrieved,
        generation: opened.generation,
        effectiveRevision: opened.effectiveRevision,
      });
    },
  });
}
