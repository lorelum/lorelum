import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run as runCli } from "../main";

const run = (arguments_: readonly string[], options?: Parameters<typeof runCli>[1]) =>
  runCli(["--json", ...arguments_], options);

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("cache status and prune use only the explicit derived cache root", async () => {
  const cache = await mkdtemp(join(tmpdir(), "lorelum-cli-cache-"));
  try {
    const status = new MemoryWriter();
    expect(await run(["cache", "status", "--cache-root", cache], { stdout: status })).toBe(0);
    expect(JSON.parse(status.value)).toMatchObject({
      command: "cache.status",
      ok: true,
      data: { artifactCount: 0, vectorCount: 0 },
    });

    const prune = new MemoryWriter();
    expect(await run(["cache", "prune", "--cache-root", cache], { stdout: prune })).toBe(0);
    expect(JSON.parse(prune.value)).toMatchObject({
      command: "cache.prune",
      ok: true,
      data: { removedArtifactCount: 0, skippedArtifactCount: 0 },
    });
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
