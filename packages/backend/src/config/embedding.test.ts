import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_MODEL_DOWNLOAD_URL,
  MAX_SERIALIZED_EMBEDDING_BYTES,
  resolveEmbeddingConfig,
} from "./embedding";

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected configuration resolution to fail");
}

test("missing embedding config is allowed", () => {
  // The example home must be absolute for the host running the test.
  const exampleHome = process.platform === "win32" ? "C:\\home\\example" : "/home/example";
  expect(resolveEmbeddingConfig(undefined, exampleHome)).toMatchObject({
    threads: 4,
    cacheDirectory: join(exampleHome, ".lorelum", "models"),
    download: { enabled: true, url: DEFAULT_MODEL_DOWNLOAD_URL },
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

test("embedding failures preserve their source, rule and safe unknown-key location", () => {
  const source = { kind: "file", path: "/home/example/config.yaml" } as const;
  const invalidSection = capture(() => resolveEmbeddingConfig(null, "/home/example", source));
  expect(invalidSection).toMatchObject({
    cause: {
      failure: {
        source,
        subject: "embedding section",
        reason: "type",
        rule: { kind: "shape", expected: "object" },
      },
    },
  });

  const invalidDownloadSection = capture(() =>
    resolveEmbeddingConfig({ download: null }, "/home/example", source),
  );
  expect(invalidDownloadSection).toMatchObject({
    cause: {
      failure: {
        source,
        subject: "embedding.download",
        reason: "type",
        rule: { kind: "shape", expected: "object" },
      },
    },
  });

  const invalidThread = capture(() =>
    resolveEmbeddingConfig({ threads: 0 }, "/home/example", source),
  );
  expect(invalidThread).toMatchObject({
    code: "backend.config-invalid",
    cause: {
      failure: {
        kind: "setting",
        source,
        subject: "embedding.threads",
        reason: "range",
        rule: { kind: "integer", minimum: 1, maximum: 64 },
      },
    },
  });

  const unknown = capture(() =>
    resolveEmbeddingConfig(
      { download: { unknownMirror: "do-not-echo-this-value" } },
      "/home/example",
      source,
    ),
  );
  expect(unknown).toMatchObject({
    cause: {
      failure: {
        source,
        subject: "embedding.download.unknownMirror",
        reason: "unknown-key",
      },
    },
  });
  expect((unknown as Error).message).toContain("unknownMirror");
  expect((unknown as Error).message).not.toContain("do-not-echo-this-value");
});

test("source and resolved embedding size failures identify the owning boundary", () => {
  const source = { kind: "file", path: "/home/example/config.yaml" } as const;
  const sourceFailure = capture(() =>
    resolveEmbeddingConfig(
      { modelPath: `/${"m".repeat(MAX_SERIALIZED_EMBEDDING_BYTES)}` },
      "/home/example",
      source,
    ),
  );
  expect(sourceFailure).toMatchObject({
    cause: {
      failure: {
        source,
        subject: "embedding section",
        reason: "size",
        rule: { kind: "max-bytes", maximum: MAX_SERIALIZED_EMBEDDING_BYTES },
      },
    },
  });

  const resolvedFailure = capture(() =>
    resolveEmbeddingConfig({}, `/${"h".repeat(MAX_SERIALIZED_EMBEDDING_BYTES)}`, source),
  );
  expect(resolvedFailure).toMatchObject({
    cause: {
      failure: {
        source: {
          kind: "resolved",
          label: "resolved embedding settings after applying the cache path default",
        },
        subject: "embedding section",
        reason: "size",
        rule: { kind: "max-bytes", maximum: MAX_SERIALIZED_EMBEDDING_BYTES },
      },
    },
  });
});

test.each(["not-a-url", "https://"])(
  "malformed embedding URL %j remains a classified configuration error",
  (url) => {
    const error = capture(() =>
      resolveEmbeddingConfig({ download: { url } }, "/home/example", {
        kind: "file",
        path: "/home/example/config.yaml",
      }),
    );
    expect(error).toMatchObject({
      code: "backend.config-invalid",
      message: expect.stringContaining("embedding.download.url"),
      cause: {
        failure: {
          source: { kind: "file", path: "/home/example/config.yaml" },
          subject: "embedding.download.url",
          reason: "format",
          rule: { kind: "https-url-without-credentials-or-fragment" },
        },
      },
    });
    expect(String((error as Error).message).includes("Invalid URL")).toBe(false);
  },
);

test("thread tuning is bounded and download has no overall timeout option", () => {
  const config = resolveEmbeddingConfig({
    threads: 8,
    download: { enabled: false, stallTimeoutSeconds: 120 },
  });
  expect(config).toMatchObject({
    threads: 8,
    download: { enabled: false, stallTimeoutSeconds: 120, maxAttempts: 3 },
  });
  expect(Object.isFrozen(config.download)).toBe(true);
  for (const value of [
    { threads: 0 },
    { contextTokens: 2048 },
    { dimensions: 768 },
    { download: { timeoutMs: 1000 } },
    { download: { maxAttempts: 0 } },
    { download: { url: "http://example.test/model.gguf" } },
    { download: { url: "https://user:password@example.test/model" } },
  ])
    expect(() => resolveEmbeddingConfig(value)).toThrow();
});

test("existing download settings inherit the pinned source and explicit mirrors override it", () => {
  expect(resolveEmbeddingConfig({ download: { maxAttempts: 5 } }).download.url).toBe(
    DEFAULT_MODEL_DOWNLOAD_URL,
  );
  expect(
    resolveEmbeddingConfig({ download: { url: "https://example.test/mirror.gguf" } }).download.url,
  ).toBe("https://example.test/mirror.gguf");
});
