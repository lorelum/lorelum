/* eslint-disable no-await-in-loop -- A single operation is observed at a bounded cadence. */
import type { StorageRoot } from "@lorelum/engine";

import type { BackendClient, BackendIndexRequestOptions } from "../client/client";
import type { IndexOperation } from "../modules/index/model";
import { BackendError } from "../protocol/errors";
import type { BackendRuntimeCoordinator, RuntimeWaitOptions } from "./coordinator";

const OBSERVATION_MS = 1_000;

export interface IndexRuntimeClient {
  build(
    root: StorageRoot,
    options?: RuntimeWaitOptions & Pick<BackendIndexRequestOptions, "projectContext" | "cacheRoot">,
  ): Promise<IndexOperation>;
  rebuild(
    root: StorageRoot,
    options?: RuntimeWaitOptions & Pick<BackendIndexRequestOptions, "projectContext" | "cacheRoot">,
  ): Promise<IndexOperation>;
}

type IndexOperationKind = "build" | "rebuild";

/** Starts one daemon-owned operation and only observes it briefly; it never prepares or replays it. */
export function createIndexRuntimeClient(
  coordinator: BackendRuntimeCoordinator,
  defaults: RuntimeWaitOptions = {},
): IndexRuntimeClient {
  async function pause(options: RuntimeWaitOptions, deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining < 1) return;
    options.signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          options.signal?.removeEventListener("abort", abort);
          resolve();
        },
        Math.min(100, remaining),
      );
      const abort = () => {
        clearTimeout(timer);
        reject(options.signal?.reason);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }

  async function observe(
    client: BackendClient,
    initial: IndexOperation,
    options: RuntimeWaitOptions,
  ): Promise<IndexOperation> {
    const deadline = Math.min(options.deadline ?? Infinity, Date.now() + OBSERVATION_MS);
    let current = initial;
    options.onProgress?.("index: building");
    while (
      current.state === "waiting-for-source" ||
      current.state === "queued" ||
      current.state === "building" ||
      current.state === "preparing"
    ) {
      if (Date.now() >= deadline) return current;
      if (current.state === "preparing") {
        let preparation;
        try {
          preparation = await client.modelPreparation(current.preparationId, {
            signal: options.signal,
            deadline,
          });
        } catch (error) {
          // The daemon already accepted this operation. A caller's observation window expiring
          // must not turn that accepted background work into a foreground failure.
          if (error instanceof BackendError && error.code === "backend.deadline-exceeded")
            return current;
          throw error;
        }
        const phase = preparation.status.progress?.phase;
        if (phase === "downloading" || phase === "verifying" || phase === "starting")
          options.onProgress?.(`model: ${phase}`);
      }
      await pause(options, deadline);
      if (Date.now() >= deadline) return current;
      try {
        current = await client.indexOperation(current.operationId, {
          signal: options.signal,
          deadline,
        });
      } catch (error) {
        if (error instanceof BackendError && error.code === "backend.deadline-exceeded")
          return current;
        throw error;
      }
    }
    return current;
  }

  async function run(
    kind: IndexOperationKind,
    root: StorageRoot,
    options: RuntimeWaitOptions & Pick<BackendIndexRequestOptions, "projectContext" | "cacheRoot">,
  ): Promise<IndexOperation> {
    const client = await coordinator.connect(options);
    const initial =
      kind === "build"
        ? await client.buildIndex(root, {
            signal: options.signal,
            deadline: options.deadline,
            ...(options.projectContext === undefined
              ? options.cacheRoot === undefined
                ? {}
                : { cacheRoot: options.cacheRoot }
              : { projectContext: options.projectContext }),
          })
        : await client.rebuildIndex(root, {
            signal: options.signal,
            deadline: options.deadline,
            ...(options.projectContext === undefined
              ? options.cacheRoot === undefined
                ? {}
                : { cacheRoot: options.cacheRoot }
              : { projectContext: options.projectContext }),
          });
    return observe(client, initial, options);
  }

  return Object.freeze({
    build: (
      root: StorageRoot,
      options: RuntimeWaitOptions &
        Pick<BackendIndexRequestOptions, "projectContext" | "cacheRoot"> = defaults,
    ) => run("build", root, options),
    rebuild: (
      root: StorageRoot,
      options: RuntimeWaitOptions &
        Pick<BackendIndexRequestOptions, "projectContext" | "cacheRoot"> = defaults,
    ) => run("rebuild", root, options),
  });
}
