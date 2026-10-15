import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { InstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runProcess } from "../support/process.js";
import { parseSingleResponse } from "../support/protocol.js";

/** Verify the omp Catalog bridge through the compiled CLI. */
export async function verifyOmpHookScenario(
  compiledBinary: string,
  fixture: InstalledPacksFixture,
  workingDirectory: string,
): Promise<void> {
  const request = '{"event":"catalog"}\n';
  const successful = await runProcess(
    [compiledBinary, "hook", "omp", "--store-root", fixture.storageRoot],
    60_000,
    request,
  );
  assert.equal(successful.exitCode, 0);
  assert.equal(successful.stderr, "");
  const response = parseSingleResponse(successful.stdout);
  assert.deepEqual(Object.keys(response), ["additionalContext"]);
  assert.equal(typeof response.additionalContext, "string");
  const context = response.additionalContext as string;
  assert(context.length <= 4000);
  assert.match(context, /integration-pack/);
  assert.match(context, /minimal-pack/);
  assert.match(context, /Process integration fixture/);
  assert.match(context, /Stack scope: bun, typescript/);
  assert.equal(context.includes(fixture.storageRoot), false);
  assert.equal(
    context.includes("This complete body must survive installation and retrieval."),
    false,
  );

  const malformed = await runProcess(
    [compiledBinary, "hook", "omp", "--store-root", fixture.storageRoot],
    60_000,
    "{",
  );
  assert.equal(malformed.exitCode, 0);
  assert.deepEqual(parseSingleResponse(malformed.stdout), {});
  assert.match(malformed.stderr, /^lore hook omp degraded: /);

  const unavailableStore = join(workingDirectory, "unavailable-omp-hook-store");
  await writeFile(unavailableStore, "not a directory\n");
  const unavailable = await runProcess(
    [compiledBinary, "hook", "omp", "--store-root", unavailableStore],
    60_000,
    request,
  );
  assert.equal(unavailable.exitCode, 0);
  assert.deepEqual(parseSingleResponse(unavailable.stdout), {});
  assert.match(unavailable.stderr, /^lore hook omp degraded: /);
}
