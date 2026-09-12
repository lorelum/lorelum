import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DEFAULT_BACKEND_SETTINGS } from "../../src/config/model";
import { createEmbeddingService } from "../../src/modules/embedding/service";
import type { EmbeddingRuntime } from "../../src/modules/embedding/model";
import type { ProcessIdentity } from "../../src/runtime/process-identity";
import { createEmbeddingProcess } from "../../src/runtime/embedding-process";

/**
 * Baseline CPU targets encode full batches sequentially and can exceed the 5 s product
 * default for one request; the harness observes throughput instead of gating machine speed.
 */
export const HARNESS_ENCODE_BUDGET_MS = 60_000;

export function modelPathFromArgs(): string {
  const path = process.argv[2];
  assert(path, "Provide the fixed Q4_0 model path as the first argument");
  return resolve(path);
}

/** Real native resources, with explicit access checks and one service cleanup owner. */
export function createNativeFixture(
  modelPath: string,
  options: {
    threads?: number;
    beforeEncode?: () => Promise<void> | void;
  } = {},
) {
  let runtime: EmbeddingRuntime | undefined;
  let process: ProcessIdentity | undefined;
  const runtimeSettings = {
    ...(options.threads === undefined ? {} : { threads: options.threads }),
  };
  const service = createEmbeddingService({
    settings: {
      ...DEFAULT_BACKEND_SETTINGS,
      startupTimeoutMs: 15_000,
      requestTimeoutMs: HARNESS_ENCODE_BUDGET_MS,
    },
    ...runtimeSettings,
    createRuntime() {
      const native = createEmbeddingProcess({ modelPath, ...runtimeSettings }, async (identity) => {
        process = identity;
      });
      runtime = {
        ...native,
        async encode(text, signal) {
          await options.beforeEncode?.();
          return native.encode(text, signal);
        },
      };
      return runtime;
    },
  });
  return {
    service,
    get runtime() {
      assert(runtime, "Load the model before accessing the native runtime");
      return runtime;
    },
    get process() {
      assert(process, "Loaded model must have a recorded native process identity");
      return process;
    },
  };
}

export function assertUnitVector(vector: number[] | undefined): asserts vector is number[] {
  assert(vector, "Embedding response must contain a vector");
  assert.equal(vector.length, 384, "Embedding dimensions");
  assert(vector.every(Number.isFinite), "Embedding values must be finite");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  assert(Math.abs(norm - 1) < 0.001, `Expected L2-normalized vector; norm=${norm}`);
}
