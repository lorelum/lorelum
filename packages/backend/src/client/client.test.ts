import { afterEach, describe, expect, test } from "bun:test";

import { createBackendApp } from "../app";
import { createBackendService } from "../modules/backend/service";
import type { InstanceIdentity } from "../protocol/identity";
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

function runningApp(backendIdentity: InstanceIdentity = identity): {
  readonly app: ReturnType<typeof createBackendApp>;
  readonly url: string;
} {
  const app = createBackendApp({
    backend: createBackendService({ identity: backendIdentity, secret, onStop: () => undefined }),
  });
  apps.push(app);
  app.listen({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 65_536 });
  if (app.server === null) throw new Error("test server did not start");
  return { app, url: `http://127.0.0.1:${app.server.port}` };
}

describe("createBackendClient", () => {
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
