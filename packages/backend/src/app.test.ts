import { describe, expect, test } from "bun:test";
import { createBackendApp } from "./app";
import { createBackendService } from "./modules/backend/service";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  controlVersion: 1,
  businessVersion: 1,
});
const secret = "a secret used only by tests";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: { host: "127.0.0.1:26186", ...init.headers },
  });
}

function app(
  onStop = () => undefined,
  instanceIdentity: typeof identity = identity,
  isReady: () => boolean = () => true,
  onStopFailure: (error: unknown) => void = () => undefined,
) {
  return createBackendApp({
    backend: createBackendService({
      identity: instanceIdentity,
      secret,
      onStop,
      onStopFailure,
      isReady,
    }),
  });
}

describe("createBackendApp", () => {
  test("returns a nonce-bound identity without accepting credentials", async () => {
    const response = await app().handle(
      request(
        "/internal/v1/identity?nonce=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...identity, proof: expect.any(String) });
  });

  test("whitelists identity fields before putting them on the wire", async () => {
    const withPrivateRuntimeField = Object.assign({}, identity, { runtimeSecret: "must-not-leak" });
    const response = await app(() => undefined, withPrivateRuntimeField).handle(
      request(
        "/internal/v1/identity?nonce=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
    );

    expect(await response.json()).toEqual({ ...identity, proof: expect.any(String) });
  });

  test("rejects browser origins, an unexpected host, and missing credentials", async () => {
    const instance = app();
    expect(
      (
        await instance.handle(
          request("/internal/v1/status", {
            headers: { host: "127.0.0.1", origin: "https://example.test" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await instance.handle(
          new Request("http://example.test/internal/v1/status", {
            headers: { host: "example.test:26186" },
          }),
        )
      ).status,
    ).toBe(400);
    expect((await instance.handle(request("/internal/v1/status"))).status).toBe(401);
  });

  test("returns stopping before calling lifecycle shutdown", async () => {
    let stopped = false;
    const response = await app(() => {
      stopped = true;
    }).handle(
      request("/internal/v1/stop", {
        method: "POST",
        headers: { host: "127.0.0.1:26186", authorization: `Bearer ${secret}` },
      }),
    );

    expect(await response.json()).toMatchObject({ state: "stopping", model: "unloaded" });
    expect(stopped).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(stopped).toBe(true);
  });

  test("reports a synchronous stop callback failure after scheduling its response", async () => {
    const failures: unknown[] = [];
    const response = await app(
      () => {
        throw new Error("test lifecycle failure");
      },
      identity,
      () => true,
      (error) => failures.push(error),
    ).handle(
      request("/internal/v1/stop", {
        method: "POST",
        headers: { host: "127.0.0.1:26186", authorization: `Bearer ${secret}` },
      }),
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(failures).toEqual([expect.objectContaining({ message: "test lifecycle failure" })]);
  });
});
