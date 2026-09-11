import { expect, test } from "bun:test";
import { DEFAULT_BACKEND_SETTINGS } from "../../config/model";
import { EmbeddingError } from "./errors";
import type { EmbeddingRuntime } from "./model";
import { createEmbeddingService } from "./service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides: Partial<EmbeddingRuntime> = {}) {
  const end = deferred<void>();
  let starts = 0;
  let stops = 0;
  const encoded: string[] = [];
  const runtime: EmbeddingRuntime = {
    async start() {
      starts++;
    },
    async tokenize(text) {
      return Array.from({ length: text === "long" ? 513 : 512 }, () => 1);
    },
    async encode(text) {
      encoded.push(text);
      return [1, ...Array<number>(383).fill(0)];
    },
    async stop() {
      stops++;
      end.resolve();
    },
    exited: end.promise,
    ...overrides,
  };
  const service = createEmbeddingService({
    createRuntime: () => runtime,
    settings: DEFAULT_BACKEND_SETTINGS,
  });
  return { service, encoded, end, starts: () => starts, stops: () => stops };
}

test("concurrent load shares one task and ready load reuses the process", async () => {
  const f = fixture();
  const first = f.service.load();
  expect(f.service.load()).toBe(first);
  expect((await first).state).toBe("ready");
  await f.service.load();
  expect(f.starts()).toBe(1);
  await f.service.unload();
  expect(f.service.status().state).toBe("unloaded");
});

test("512 accepted, entire batch validated before encode, original text and order preserved", async () => {
  const f = fixture();
  await f.service.load();
  await expect(f.service.embed("query", ["valid", "long"])).rejects.toMatchObject({
    code: "embedding.input-too-long",
  });
  expect(f.encoded).toEqual([]);
  expect(f.service.status().state).toBe("ready");
  const result = await f.service.embed("document", ["  source\n", "second"]);
  expect(f.encoded).toEqual(["  source\n", "second"]);
  expect(result.vectors).toHaveLength(2);
  await f.service.unload();
});

test("one inflight request, responsive status, excess admission rejected", async () => {
  const pending = deferred<number[]>();
  const f = fixture({ encode: () => pending.promise });
  await f.service.load();
  const request = f.service.embed("query", ["one"]);
  expect(f.service.status().state).toBe("ready");
  await expect(f.service.embed("query", ["two"])).rejects.toMatchObject({ code: "embedding.busy" });
  pending.resolve([1, ...Array<number>(383).fill(0)]);
  await request;
  await f.service.unload();
});

test("unload during loading cancels startup without stale ready state", async () => {
  const entered = deferred<void>();
  const f = fixture({
    start: (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new EmbeddingError("embedding.failed")), {
          once: true,
        });
        entered.resolve();
      }),
  });
  const load = f.service.load().catch(() => {});
  await entered.promise;
  expect((await f.service.unload()).state).toBe("unloaded");
  await load;
  expect(f.service.status().state).toBe("unloaded");
});

test("native failure recycles owned process before allowing explicit load", async () => {
  const f = fixture({
    encode: async () => {
      throw new EmbeddingError("embedding.deadline-exceeded");
    },
  });
  await f.service.load();
  await expect(f.service.embed("document", ["text"])).rejects.toMatchObject({
    code: "embedding.deadline-exceeded",
  });
  expect(f.stops()).toBe(1);
  expect(f.service.status()).toMatchObject({
    state: "failed",
    error: "embedding.deadline-exceeded",
  });
});

test("failed termination retains ownership and blocks a replacement load", async () => {
  const f = fixture({
    stop: async () => {
      throw new EmbeddingError("embedding.deadline-exceeded");
    },
  });
  await f.service.load();
  await expect(f.service.unload()).rejects.toMatchObject({ code: "embedding.deadline-exceeded" });
  await expect(f.service.load()).rejects.toMatchObject({ code: "embedding.busy" });
});

test("unconfigured load fails explicitly and status remains read-only", async () => {
  let calls = 0;
  const service = createEmbeddingService({
    settings: DEFAULT_BACKEND_SETTINGS,
    createRuntime() {
      calls++;
      throw new EmbeddingError("embedding.not-configured");
    },
  });
  expect(service.status().state).toBe("unloaded");
  expect(calls).toBe(0);
  await expect(service.load()).rejects.toMatchObject({ code: "embedding.not-configured" });
  expect(service.status().state).toBe("failed");
  expect((await service.unload()).state).toBe("unloaded");
});

test("blank and empty input rejected at service boundary", async () => {
  const f = fixture();
  for (const input of [[], ["  \n"]]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(f.service.embed("query", input)).rejects.toMatchObject({
      code: "embedding.input-invalid",
    });
  }
});

test("a crash cannot admit a replacement while the previous request is settling", async () => {
  const pending = deferred<number[]>();
  const f = fixture({ encode: () => pending.promise });
  await f.service.load();
  const request = f.service.embed("query", ["one"]);
  f.end.resolve();
  await Promise.resolve();
  expect(f.service.status().state).toBe("failed");
  await expect(f.service.load()).rejects.toMatchObject({ code: "embedding.busy" });
  pending.resolve([1, ...Array<number>(383).fill(0)]);
  await expect(request).rejects.toMatchObject({ code: "embedding.not-loaded" });
  await f.service.unload();
});

test("cleanup failure preserves the original error and blocks a replacement", async () => {
  const f = fixture({
    start: async () => {
      throw new EmbeddingError("embedding.resource-invalid");
    },
    stop: async () => {
      throw new EmbeddingError("embedding.deadline-exceeded");
    },
  });
  await expect(f.service.load()).rejects.toMatchObject({
    code: "embedding.resource-invalid",
    cause: expect.any(AggregateError),
  });
  expect(f.service.status()).toMatchObject({
    state: "failed",
    error: "embedding.resource-invalid",
  });
  await expect(f.service.load()).rejects.toMatchObject({ code: "embedding.busy" });
});

test("unload cannot report success while an old request can still return a vector", async () => {
  const pending = deferred<number[]>();
  const f = fixture({ encode: () => pending.promise });
  await f.service.load();
  const request = f.service.embed("query", ["pending"]);
  await expect(f.service.unload(Date.now() + 30)).rejects.toMatchObject({
    code: "embedding.deadline-exceeded",
  });
  expect(f.service.status().state).toBe("failed");
  await expect(f.service.load()).rejects.toMatchObject({ code: "embedding.busy" });
  pending.resolve([1, ...Array<number>(383).fill(0)]);
  await expect(request).rejects.toMatchObject({ code: "embedding.not-loaded" });
  expect((await f.service.unload()).state).toBe("unloaded");
});
