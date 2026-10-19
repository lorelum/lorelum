import assert from "node:assert/strict";
import { join } from "node:path";
import { EMBEDDING_MODEL } from "@lorelum/backend/protocol";
import { writeNativeProjectPack } from "../fixtures/native-project.js";
import { expectOk, type NativeSmokeEnvironment } from "../support/native-smoke.js";
import { isRecord } from "../support/protocol.js";

/** A canonical Pack install must itself submit indexing through the owned native runtime. */
export async function verifyInstallNativeScenario(environment: NativeSmokeEnvironment) {
  const session = await environment.createSession("install");
  const source = join(session.root, "source");
  const totalPractices = EMBEDDING_MODEL.maxInputs + 1;
  await writeNativeProjectPack(source, totalPractices);
  const args = ["--cache-root", session.cacheRoot];
  expectOk("prepare install native runtime", await session.invoke(["model", "load"]));
  const initial = expectOk(
    "fresh install index",
    await session.invoke([...args, "index", "status"]),
  );
  assert.equal(initial.state, "missing");
  const before = environment.encodingStats();
  const installed = expectOk(
    "local Pack install submits derived index",
    await session.invoke([
      "pack",
      "install",
      "--path",
      join(source, ".lorelum", "packs", "performance"),
    ]),
  );
  assert(isRecord(installed.indexSync), "Install must expose its index synchronization result");
  assert(
    installed.indexSync.state === "pending" || installed.indexSync.state === "ready",
    "Canonical install must submit a usable derived-index operation",
  );
  await environment.waitForIdle();
  // Check before querying: a query-triggered build must not mask a missing install submission.
  const ready = expectOk(
    "install-driven ready index",
    await session.invoke([...args, "index", "status"]),
  );
  assert.equal(ready.state, "ready");
  const after = environment.encodingStats();
  const nativeBatchSizes = after.nativeBatchSizes.slice(before.nativeBatchSizes.length);
  assert.equal(after.documentCount - before.documentCount, totalPractices);
  assert(
    nativeBatchSizes.includes(EMBEDDING_MODEL.maxInputs),
    "Install must complete a real native batch of eight sequences, not eight singleton calls",
  );
  const query = expectOk(
    "installed Pack semantic query reuses ready artifact",
    await session.invoke([
      ...args,
      "query",
      "marker-v1-000",
      "--require-complete",
      "--max-wait-ms",
      "0",
    ]),
  );
  assert.equal(query.coverage, "complete");
  assert.equal(environment.encodingStats().documentCount, after.documentCount);
  return {
    fixture: { installedPractices: totalPractices },
    observations: {
      installDocumentBatches: after.batches - before.batches,
      installNativeBatchSizes: nativeBatchSizes,
      installDocumentInputs: after.documentCount - before.documentCount,
    },
  };
}
