import { expect, test } from "bun:test";
import { resolveEmbeddingConfig } from "./embedding";

test("missing embedding config is allowed", () => {
  expect(resolveEmbeddingConfig(undefined, "/home/example")).toMatchObject({
    threads: 4,
    maxTokens: 512,
    cacheDirectory: "/home/example/.lorelum/models",
    download: { enabled: true },
  });
});

test("embedding config is strict, absolute-path-only, and immutable", () => {
  const config = resolveEmbeddingConfig({ modelPath: "/models/granite.gguf" })!;
  expect(config).toMatchObject({ modelPath: "/models/granite.gguf" });
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

test("runtime tuning is bounded and download has no overall timeout option", () => {
  const config = resolveEmbeddingConfig({
    threads: 8,
    maxTokens: 2048,
    download: { enabled: false, stallTimeoutSeconds: 120 },
  });
  expect(config).toMatchObject({
    threads: 8,
    maxTokens: 2048,
    download: { enabled: false, stallTimeoutSeconds: 120, maxAttempts: 3 },
  });
  expect(Object.isFrozen(config.download)).toBe(true);
  for (const value of [
    { threads: 0 },
    { maxTokens: 32768 },
    { dimensions: 768 },
    { download: { timeoutMs: 1000 } },
    { download: { maxAttempts: 0 } },
    { download: { url: "http://example.test/model.gguf" } },
    { download: { url: "https://user:password@example.test/model" } },
  ])
    expect(() => resolveEmbeddingConfig(value)).toThrow();
});
