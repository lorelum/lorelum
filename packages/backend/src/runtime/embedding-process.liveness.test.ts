import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createEmbeddingProcess, type EmbeddingProcessDeps } from "./embedding-process";

/**
 * The launcher's collaboration seams (resource resolution and child spawn) are
 * injected, so the startup contract can be observed without a native build, a
 * real model file, or global module mocks.
 */
interface CapturedSpawn {
  readonly executable: string;
  readonly options: SpawnOptions;
}

const capturedSpawns: CapturedSpawn[] = [];

/** Behavior switch for the fake child: resolved with the first spawn of a test. */
let onFakeChild:
  | ((
      child: EventEmitter & {
        exitCode: number | null;
        stdin: { on: () => void; destroy: () => void };
      },
    ) => void)
  | undefined;

class FakeNativeChild extends EventEmitter {
  readonly stdin = { on: () => {}, destroy: () => {} };
  // A live pid keeps the real process-identity check on the launcher's path.
  readonly pid = process.pid;
  exitCode: number | null = null;
  signalCode: number | null = null;

  constructor() {
    super();
    queueMicrotask(() => this.emit("spawn"));
    onFakeChild?.(this);
  }

  kill(): boolean {
    this.exitCode = 0;
    queueMicrotask(() => this.emit("close", 0));
    return true;
  }
}

function deps(): EmbeddingProcessDeps {
  return {
    resolveResources: async () => ({
      executable: "stub-llama-server",
      buildIdentity: "test-build-identity",
      assertUnchanged: async () => {},
    }),
    spawnProcess: (executable, _args, options) => {
      capturedSpawns.push({ executable, options });
      return new FakeNativeChild() as unknown as ChildProcess;
    },
  };
}

test("daemon-owned spawn carries the parent liveness opt-in", async () => {
  capturedSpawns.length = 0;
  onFakeChild = () => {};
  const runtime = createEmbeddingProcess(
    { modelPath: "stub-model", threads: 1 },
    undefined,
    deps(),
  );
  try {
    await expect(
      runtime.start(new AbortController().signal, Date.now() + 400),
    ).rejects.toMatchObject({ code: "embedding.deadline-exceeded" });
    expect(capturedSpawns.length).toBe(1);
    const environment = capturedSpawns[0]?.options.env as Record<string, string>;
    expect(environment["LLAMA_PARENT_LIVENESS_STDIN"]).toBe("1");
    expect(environment["LLAMA_API_KEY"]).toBeTruthy();
  } finally {
    await runtime.stop(Date.now() + 1_000);
  }
});

test("a native runtime that exits during startup fails terminally after bounded retries", async () => {
  capturedSpawns.length = 0;
  onFakeChild = (child) => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit("close", 0));
  };
  const runtime = createEmbeddingProcess(
    { modelPath: "stub-model", threads: 1 },
    undefined,
    deps(),
  );
  await expect(
    runtime.start(new AbortController().signal, Date.now() + 5_000),
  ).rejects.toMatchObject({ code: "embedding.failed" });
  expect(capturedSpawns.length).toBe(3);
  await runtime.stop(Date.now() + 1_000);
});
