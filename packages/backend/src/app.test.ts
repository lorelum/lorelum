import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, createQueryService, type QueryService } from "@lorelum/engine";

import { createPackCandidate } from "../../engine/src/local-store/model/candidate";

import { createBackendApp } from "./app";
import { createBackendService } from "./modules/backend/service";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  controlVersion: 1,
  businessVersion: 1,
});
const secret = "a secret used only by tests";

function candidate(version: string, text: string) {
  return createPackCandidate(
    {
      pack: { name: "backend-test", version },
      practices: [
        {
          id: "backend.query",
          title: "Backend query",
          stage: "api",
          tech_stack: ["typescript"],
          applies_when: text,
          severity: "warn",
          body: text,
        },
      ],
      decisions: [],
    },
    { "backend.query": "practices/backend/query.md" },
  ).candidate;
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: { host: "127.0.0.1:26186", ...init.headers },
  });
}

function app(
  queryService?: QueryService,
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
    queryService: queryService ?? {
      async query() {
        return { mode: "keyword", results: [] } as const;
      },
    },
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
    const response = await app(undefined, () => undefined, withPrivateRuntimeField).handle(
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

  test("delegates a valid query to QueryService without parsing it in the adapter", async () => {
    const calls: unknown[] = [];
    const queryService: QueryService = {
      async query(root, input) {
        calls.push({ root, input });
        return { mode: "keyword", results: [] };
      },
    };
    const response = await app(queryService).handle(
      request("/internal/v1/query", {
        method: "POST",
        headers: {
          host: "127.0.0.1:26186",
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          storageRoot: "/tmp/lorelum-test",
          query: { text: "  keep this input  " },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        root: { rootPath: "/tmp/lorelum-test" },
        input: { text: "  keep this input  " },
      },
    ]);
  });

  test("observes LocalStore mutations through the real QueryService", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "lorelum-backend-test-"));
    try {
      const store = createLocalStore();
      await store.install({ rootPath }, candidate("1.0.0", "orchid deployment guidance"));
      const instance = app(createQueryService({ store }));
      const query = (text: string) =>
        instance.handle(
          request("/internal/v1/query", {
            method: "POST",
            headers: {
              host: "127.0.0.1:26186",
              authorization: `Bearer ${secret}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ storageRoot: rootPath, query: { text, limit: 1 } }),
          }),
        );

      expect(await (await query("orchid")).json()).toMatchObject({
        results: [{ practiceId: "backend.query" }],
      });
      await store.upgrade({ rootPath }, candidate("1.0.1", "violet deployment guidance"));
      expect(await (await query("orchid")).json()).toMatchObject({ results: [] });
      expect(await (await query("violet")).json()).toMatchObject({
        results: [{ practiceId: "backend.query" }],
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  test("keeps simultaneous Store roots isolated", async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), "lorelum-backend-first-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "lorelum-backend-second-"));
    try {
      const store = createLocalStore();
      await store.install({ rootPath: firstRoot }, candidate("1.0.0", "orchid guidance"));
      await store.install({ rootPath: secondRoot }, candidate("1.0.0", "violet guidance"));
      const instance = app(createQueryService({ store }));
      const query = async (rootPath: string, text: string) => {
        const response = await instance.handle(
          request("/internal/v1/query", {
            method: "POST",
            headers: {
              host: "127.0.0.1:26186",
              authorization: `Bearer ${secret}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ storageRoot: rootPath, query: { text } }),
          }),
        );
        return response.json();
      };

      expect(await query(firstRoot, "orchid")).toMatchObject({
        results: [{ practiceId: "backend.query" }],
      });
      expect(await query(firstRoot, "violet")).toMatchObject({ results: [] });
      expect(await query(secondRoot, "orchid")).toMatchObject({ results: [] });
      expect(await query(secondRoot, "violet")).toMatchObject({
        results: [{ practiceId: "backend.query" }],
      });
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
        rm(secondRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
      ]);
    }
  });

  test("translates typed Engine errors without exposing their details", async () => {
    const queryService: QueryService = {
      async query() {
        throw new Error("/private/path must never be returned");
      },
    };
    const response = await app(queryService).handle(
      request("/internal/v1/query", {
        method: "POST",
        headers: {
          host: "127.0.0.1:26186",
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ storageRoot: "/tmp/lorelum-test", query: { text: "test" } }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "backend.failed", message: "The backend operation failed." },
    });
  });

  test("whitelists QueryService result fields", async () => {
    const queryService: QueryService = {
      async query() {
        return { mode: "keyword", results: [], privateRuntimeDetail: "must-not-leak" } as never;
      },
    };
    const response = await app(queryService).handle(
      request("/internal/v1/query", {
        method: "POST",
        headers: {
          host: "127.0.0.1:26186",
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ storageRoot: "/tmp/lorelum-test", query: { text: "test" } }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "keyword",
      results: [],
    });
  });

  test("rejects a malformed QueryService result at the success-response boundary", async () => {
    const queryService: QueryService = {
      async query() {
        return { mode: "not-keyword", results: [] } as never;
      },
    };
    const response = await app(queryService).handle(
      request("/internal/v1/query", {
        method: "POST",
        headers: {
          host: "127.0.0.1:26186",
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ storageRoot: "/tmp/lorelum-test", query: { text: "test" } }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "backend.failed", message: "The backend operation failed." },
    });
  });

  test("reports starting and rejects query admission before readiness", async () => {
    let ready = false;
    const instance = app(
      undefined,
      () => undefined,
      identity,
      () => ready,
    );
    const status = await instance.handle(
      request("/internal/v1/status", {
        headers: { host: "127.0.0.1:26186", authorization: `Bearer ${secret}` },
      }),
    );
    const query = await instance.handle(
      request("/internal/v1/query", {
        method: "POST",
        headers: {
          host: "127.0.0.1:26186",
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ storageRoot: "/tmp/lorelum-test", query: { text: "test" } }),
      }),
    );

    expect(await status.json()).toMatchObject({ state: "starting" });
    expect(query.status).toBe(503);
    ready = true;
    expect(
      await (
        await instance.handle(
          request("/internal/v1/status", {
            headers: { host: "127.0.0.1:26186", authorization: `Bearer ${secret}` },
          }),
        )
      ).json(),
    ).toMatchObject({ state: "ready" });
  });

  test("returns stopping before calling lifecycle shutdown", async () => {
    let stopped = false;
    const response = await app(undefined, () => {
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
      undefined,
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
