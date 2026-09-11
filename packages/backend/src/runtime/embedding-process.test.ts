import { expect, test } from "bun:test";
import { createEmbeddingProcess } from "./embedding-process";

test("runtime exit settles even if clearing the ownership record fails", async () => {
  const runtime = createEmbeddingProcess(undefined, async () => {
    throw new Error("record update failed");
  });
  await expect(runtime.start(new AbortController().signal, Date.now() + 100)).rejects.toMatchObject(
    { code: "embedding.not-configured" },
  );
  await expect(runtime.stop(Date.now() + 100)).rejects.toThrow("record update failed");
  let exited = false;
  void runtime.exited.then(() => {
    exited = true;
  });
  await Promise.resolve();
  expect(exited).toBe(true);
});
