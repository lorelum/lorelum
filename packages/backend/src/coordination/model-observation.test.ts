import { expect, test } from "bun:test";
import { createBackendRuntimeCoordinator } from "./coordinator";
import { createBackendClient } from "../client/client";
import { ENCODING_ID } from "../modules/embedding/model";
import { PROTOCOL_VERSION } from "../protocol/constants";
import type { ModelPreparation } from "../modules/embedding/dto";

test("preparation observation is bounded while daemon task remains loading", async () => {
  const preparation: ModelPreparation = {
    preparationId: crypto.randomUUID(),
    status: {
      state: "loading",
      encodingId: ENCODING_ID,
      device: "cpu",
      dimensions: 384,
      threads: 4,
      progress: { phase: "downloading" },
    },
  };
  let admissions = 0;
  const client = {
    ...createBackendClient({
      identity: { instanceId: "test", buildIdentity: "test", protocolVersion: PROTOCOL_VERSION },
      secret: "test",
    }),
    beginModelPreparation: async () => {
      admissions++;
      return preparation;
    },
    modelPreparation: async () => preparation,
  };
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => client,
    start: async () => {},
  });
  const initial = await coordinator.beginModelPreparation(client);
  const observed = await coordinator.observeModelPreparation(client, initial, {}, 30);
  expect(observed.status.state).toBe("loading");
  expect(admissions).toBe(1);
  expect((await client.modelPreparation()).status.state).toBe("loading");
  expect(await coordinator.observeModelPreparation(client, initial, {}, 0)).toBe(initial);
});

test("cancelling an observer does not mutate the accepted model task", async () => {
  const preparation: ModelPreparation = {
    preparationId: crypto.randomUUID(),
    status: {
      state: "loading",
      encodingId: ENCODING_ID,
      device: "cpu",
      dimensions: 384,
      threads: 4,
    },
  };
  const client = {
    ...createBackendClient({
      identity: { instanceId: "test", buildIdentity: "test", protocolVersion: PROTOCOL_VERSION },
      secret: "test",
    }),
    modelPreparation: async () => preparation,
  };
  const coordinator = createBackendRuntimeCoordinator({
    connect: async () => client,
    start: async () => {},
  });
  const caller = new AbortController();
  const observed = coordinator.observeModelPreparation(client, preparation, {
    signal: caller.signal,
  });
  caller.abort(new Error("caller left"));
  await expect(observed).rejects.toThrow("caller left");
  expect((await client.modelPreparation()).status.state).toBe("loading");
});
