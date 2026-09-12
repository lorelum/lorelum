import { expect, test } from "bun:test";
import { InvalidQueryRequestError, SemanticIndexNotReadyError } from "@lorelum/engine";

import { createBackendApp } from "../../app";
import { createBackendService } from "../backend/service";
import type { QueryService } from "@lorelum/engine";
import type { SemanticQueryService } from "@lorelum/engine";
import { PROTOCOL_VERSION } from "../../protocol/constants";

const secret = "query-controller-test-secret";
const identity = {
  instanceId: "query-controller-test",
  buildIdentity: "query-controller-build",
  protocolVersion: PROTOCOL_VERSION,
} as const;

function request(body: unknown): Request {
  return new Request("http://127.0.0.1/internal/v1/query", {
    method: "POST",
    headers: {
      host: "127.0.0.1:26186",
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function app(keywordQueryService: QueryService, semanticQueryService: SemanticQueryService) {
  return createBackendApp({
    backend: createBackendService({ identity, secret, onStop: () => undefined }),
    keywordQueryService,
    semanticQueryService,
  });
}

test("defaults query mode to semantic and preserves semantic result metadata", async () => {
  const calls: string[] = [];
  const instance = app(
    {
      async query() {
        throw new Error("keyword facade must not be selected");
      },
    },
    {
      async query(root, query) {
        calls.push(`${root.rootPath}:${query.text}`);
        return {
          mode: "semantic",
          profileId: "a".repeat(64),
          coverage: "partial",
          results: [],
        };
      },
    },
  );

  const response = await instance.handle(
    request({ storageRoot: "/tmp/query-controller", query: { text: "deployment" } }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    mode: "semantic",
    profileId: "a".repeat(64),
    coverage: "partial",
    results: [],
  });
  expect(calls).toEqual(["/tmp/query-controller:deployment"]);
});

test("explicit keyword mode selects only the keyword facade", async () => {
  const calls: string[] = [];
  const instance = app(
    {
      async query(_root, query) {
        calls.push(query.text);
        return { mode: "keyword", results: [] };
      },
    },
    {
      async query() {
        throw new Error("semantic facade must not be selected");
      },
    },
  );

  const response = await instance.handle(
    request({
      storageRoot: "/tmp/query-controller",
      query: { text: "deployment", mode: "keyword" },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ mode: "keyword", results: [] });
  expect(calls).toEqual(["deployment"]);
});

test("maps semantic index readiness failures to a typed remote error", async () => {
  const instance = app(
    {
      async query() {
        return { mode: "keyword", results: [] };
      },
    },
    {
      async query() {
        throw new SemanticIndexNotReadyError();
      },
    },
  );
  const response = await instance.handle(
    request({ storageRoot: "/tmp/query-controller", query: { text: "deployment" } }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "semantic.index-not-ready" } });
});

test("maps invalid Engine input before exposing an implementation failure", async () => {
  const instance = app(
    {
      async query() {
        throw new InvalidQueryRequestError();
      },
    },
    {
      async query() {
        return { mode: "semantic", profileId: "a".repeat(64), coverage: "complete", results: [] };
      },
    },
  );
  const response = await instance.handle(
    request({
      storageRoot: "/tmp/query-controller",
      query: { text: "deployment", mode: "keyword" },
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "usage.invalid" } });
});
