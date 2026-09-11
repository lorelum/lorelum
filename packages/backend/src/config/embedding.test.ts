import { expect, test } from "bun:test";
import { resolveEmbeddingConfig } from "./embedding";

test("missing embedding config is allowed", () => {
  expect(resolveEmbeddingConfig(undefined)).toBeUndefined();
});

test("embedding config is strict, absolute-path-only, and immutable", () => {
  const config = resolveEmbeddingConfig({ modelPath: "/models/granite.gguf" })!;
  expect(config).toEqual({ modelPath: "/models/granite.gguf" });
  expect(Object.isFrozen(config)).toBe(true);
  expect(() => resolveEmbeddingConfig({ modelPath: "models/granite.gguf" })).toThrow();
  expect(() =>
    resolveEmbeddingConfig({ modelPath: "/models/granite.gguf", extra: true }),
  ).toThrow();
  expect(() => resolveEmbeddingConfig(null)).toThrow();
});

test("embedding snapshot uses a UTF-8 serialized byte limit", () => {
  expect(() => resolveEmbeddingConfig({ modelPath: `/${"模型".repeat(1_000)}` })).toThrow();
});
