import { afterEach, describe, expect, test } from "bun:test";

import type { QueryService } from "@lorelum/engine";

import { createBackendApp } from "../app";
import { createBackendService } from "../modules/backend/service";
import type { InstanceIdentity } from "../protocol/identity";
import { BackendRemoteError } from "../protocol/errors";
import { createBackendClient } from "./client";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  controlVersion: 1,
  businessVersion: 1,
});
const secret = "a secret used only by tests";
const apps: Array<ReturnType<typeof createBackendApp>> = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.stop(true);
});

function runningApp(
  queryService?: QueryService,
  backendIdentity: InstanceIdentity = identity,
): {
  readonly app: ReturnType<typeof createBackendApp>;
  readonly url: string;
} {
  const app = createBackendApp({
    backend: createBackendService({ identity: backendIdentity, secret, onStop: () => undefined }),
    queryService: queryService ?? {
      async query() {
        return { mode: "keyword", results: [] } as const;
      },
    },
  });
  apps.push(app);
  app.listen({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 65_536 });
  if (app.server === null) throw new Error("test server did not start");
  return { app, url: `http://127.0.0.1:${app.server.port}` };
}

describe("createBackendClient", () => {
  test("authenticates the service before making a strict-build query", async () => {
    const calls: unknown[] = [];
    const { url } = runningApp({
      async query(root, request) {
        calls.push({ root, request });
        return { mode: "keyword", results: [] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
    ).resolves.toEqual({
      mode: "keyword",
      results: [],
    });
    expect(calls).toEqual([
      { root: { rootPath: "/tmp/lorelum-client-test" }, request: { text: "search" } },
    ]);
  });

  test("allows a compatible control client to stop an older build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "newer-build",
      baseUrl: url,
    });

    await expect(client.status()).resolves.toMatchObject({ state: "ready" });
    await expect(client.stop()).resolves.toMatchObject({ state: "stopping" });
  });

  test("does not send a query to a service with a different business build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "different-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
    ).rejects.toEqual(expect.objectContaining({ code: "backend.incompatible" }));
  });

  test("allows control operations but rejects queries against an older business protocol", async () => {
    const { url } = runningApp(undefined, { ...identity, businessVersion: 0 });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(client.status()).resolves.toMatchObject({ state: "ready" });
    await expect(client.stop()).resolves.toMatchObject({ state: "stopping" });
    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
    ).rejects.toEqual(expect.objectContaining({ code: "backend.incompatible" }));
  });

  test("preserves the established domain error code from a query response", async () => {
    const { url } = runningApp({
      async query() {
        throw new (await import("@lorelum/engine")).InvalidQueryRequestError();
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search" }),
    ).rejects.toBeInstanceOf(BackendRemoteError);
  });

  test("rejects non-loopback client URLs", () => {
    expect(() =>
      createBackendClient({
        identity,
        secret,
        buildIdentity: "test-build",
        baseUrl: "http://example.test",
      }),
    ).toThrow(TypeError);
    expect(() =>
      createBackendClient({
        identity,
        secret,
        buildIdentity: "test-build",
        baseUrl: "http://localhost:26186/query",
      }),
    ).toThrow(TypeError);
  });
});
