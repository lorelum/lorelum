import { expect, test } from "bun:test";
import { createEmbeddingProcess, nativeExitLogRecord } from "./embedding-process";

test("runtime exit settles even if clearing the ownership record fails", async () => {
  const runtime = createEmbeddingProcess(
    { modelPath: "model", executable: "native", buildIdentity: "build" },
    async () => {
      throw new Error("record update failed");
    },
  );
  await expect(runtime.stop(Date.now() + 100)).rejects.toThrow("record update failed");
  let exited = false;
  void runtime.exited.then(() => {
    exited = true;
  });
  await Promise.resolve();
  expect(exited).toBe(true);
});

test("records a clean zero-output exit before readiness as a failed native run", () => {
  expect(
    nativeExitLogRecord({
      nativeRunId: "native-run-1",
      preparationId: "preparation-1",
      buildIdentity: "build-1",
      readiness: "pending",
      stopped: false,
      exitCode: 0,
      signal: null,
      stdoutBytes: 0,
      stderrBytes: 0,
    }),
  ).toMatchObject({
    event: "native.exited-before-ready",
    readiness: "failed",
    exitCode: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    code: "embedding.failed",
  });
});

test("keeps a post-readiness signal exit distinct from an initial probe failure", () => {
  expect(
    nativeExitLogRecord({
      nativeRunId: "native-run-2",
      readiness: "ready",
      stopped: false,
      exitCode: null,
      signal: "SIGTERM",
      stdoutBytes: 12,
      stderrBytes: 4,
    }),
  ).toMatchObject({
    event: "native.exited-after-ready",
    readiness: "ready",
    signal: "SIGTERM",
    stdoutBytes: 12,
    stderrBytes: 4,
  });
});
