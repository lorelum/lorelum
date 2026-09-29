import { expect, test } from "bun:test";
import { createBackendClient, type BackendClient } from "@lorelum/backend/client";
import {
  type ModelPreparation,
  type BackendQueryResult,
  EmbeddingError,
  BackendError,
  PROTOCOL_VERSION,
} from "@lorelum/backend/protocol";

import { createSemanticRuntimeClient, type SemanticRuntimeCoordinator } from "./runtime-client";

const root = { rootPath: "/isolated-store" };
const profileId = "a".repeat(64);
const preparationId = "0f8fad5b-d9cb-469f-a165-70867728950e";

const complete: BackendQueryResult = {
  mode: "semantic",
  profileId,
  coverage: "complete",
  indexedPracticeCount: 1,
  totalPracticeCount: 1,
  results: [],
};

function backend(overrides: Partial<BackendClient> = {}): BackendClient {
  return {
    ...createBackendClient({
      identity: { instanceId: "test", buildIdentity: "test", protocolVersion: PROTOCOL_VERSION },
      secret: "test",
      buildIdentity: "test",
    }),
    identity: async () => ({
      instanceId: "test",
      buildIdentity: "test",
      protocolVersion: PROTOCOL_VERSION,
      proof: "a".repeat(64),
    }),
    query: async () => complete,
    ...overrides,
  };
}

function loadingPreparation(): ModelPreparation {
  return {
    preparationId,
    status: {
      state: "loading",
      encodingId: profileId,
      device: "cpu",
      dimensions: 384,
      threads: 1,
      progress: { phase: "starting" },
    },
  };
}

test("zero wait budget remains a Backend request policy rather than a transport deadline", async () => {
  const connectionWaits: unknown[] = [];
  const queryOptions: unknown[] = [];
  const client = backend({
    query: async (_root, _request, options) => {
      queryOptions.push(options);
      return complete;
    },
  });
  const coordinator: SemanticRuntimeCoordinator = {
    connect: async (wait) => {
      connectionWaits.push(wait);
      return client;
    },
    beginModelPreparation: async () => {
      throw new Error("model preparation must not run");
    },
    observeModelPreparation: async () => {
      throw new Error("model preparation must not run");
    },
  };

  await expect(
    createSemanticRuntimeClient(coordinator).query(root, {
      text: "zero budget",
      maxWaitMs: 0,
      minCoveragePercent: 0,
    }),
  ).resolves.toEqual(complete);
  expect(connectionWaits).toEqual([{ onProgress: expect.any(Function) }]);
  expect(queryOptions).toEqual([undefined]);
});

test("zero wait budget reports preparing while an absent model is downloading", async () => {
  const observationBudgets: number[] = [];
  const preparation = loadingPreparation();
  const client = backend({
    query: async () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
  });
  const coordinator: SemanticRuntimeCoordinator = {
    connect: async () => client,
    beginModelPreparation: async () => preparation,
    observeModelPreparation: async (_client, _preparation, _wait, observationMs) => {
      observationBudgets.push(observationMs ?? -1);
      return preparation;
    },
  };

  await expect(
    createSemanticRuntimeClient(coordinator).query(root, {
      text: "download model",
      maxWaitMs: 0,
      minCoveragePercent: 0,
    }),
  ).resolves.toMatchObject({ state: "preparing", preparationId });
  expect(observationBudgets).toEqual([0]);
});

test("model preparation observes the caller's full semantic wait budget", async () => {
  const observationBudgets: number[] = [];
  const preparation = loadingPreparation();
  const client = backend({
    query: async () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
  });
  const coordinator: SemanticRuntimeCoordinator = {
    connect: async () => client,
    beginModelPreparation: async () => preparation,
    observeModelPreparation: async (_client, _preparation, _wait, observationMs) => {
      observationBudgets.push(observationMs ?? -1);
      return preparation;
    },
  };

  await expect(
    createSemanticRuntimeClient(coordinator).query(root, {
      text: "wait for model",
      maxWaitMs: 5_000,
      minCoveragePercent: 0,
    }),
  ).resolves.toMatchObject({ state: "preparing", preparationId });
  expect(observationBudgets).toEqual([5_000]);
});

test("semantic query preserves resource details from a failed preparation status", async () => {
  const resource = {
    kind: "native",
    file: "native/darwin-arm64/llama-server",
    check: "missing",
  } as const;
  const preparation = loadingPreparation();
  const failed = {
    ...preparation,
    status: {
      ...preparation.status,
      state: "failed" as const,
      error: "embedding.native-resource-invalid" as const,
      resource,
    },
  };
  const client = backend({
    query: async () => {
      throw new EmbeddingError("embedding.not-loaded");
    },
  });
  const coordinator: SemanticRuntimeCoordinator = {
    connect: async () => client,
    beginModelPreparation: async () => preparation,
    observeModelPreparation: async () => failed,
  };

  await expect(
    createSemanticRuntimeClient(coordinator).query(root, {
      text: "missing runtime",
      minCoveragePercent: 0,
    }),
  ).rejects.toMatchObject({
    code: "embedding.native-resource-invalid",
    resource,
    message: new EmbeddingError("embedding.native-resource-invalid", undefined, resource).message,
  });
});

test("annotates a compatibility error with the local automatic recovery policy", async () => {
  const coordinator: SemanticRuntimeCoordinator = {
    connect: async () => {
      throw new BackendError("backend.build-mismatch");
    },
    beginModelPreparation: async () => {
      throw new Error("must not prepare");
    },
    observeModelPreparation: async () => {
      throw new Error("must not observe");
    },
  };
  await expect(
    createSemanticRuntimeClient(coordinator, undefined, async () => ({
      action: "backend.stop-if-idle",
      automation: "auto",
      reason: "idle",
      retry: "original-command",
    })).query(root, { text: "recover", minCoveragePercent: 0 }),
  ).rejects.toMatchObject({
    code: "backend.build-mismatch",
    recovery: {
      action: "backend.stop-if-idle",
      automation: "auto",
      reason: "idle",
      retry: "original-command",
    },
  });
});
