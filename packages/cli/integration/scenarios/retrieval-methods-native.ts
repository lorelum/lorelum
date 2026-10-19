import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMBEDDING_MODEL } from "@lorelum/backend/protocol";
import { writeNativeProjectPack } from "../fixtures/native-project.js";
import { expectOk, type NativeSmokeEnvironment } from "../support/native-smoke.js";
import { isRecord } from "../support/protocol.js";

/** Real method selection on a fresh corpus, with no ProjectContext scenario prerequisites. */
export async function verifyRetrievalMethodsNativeScenario(environment: NativeSmokeEnvironment) {
  const session = await environment.createSession("retrieval-methods");
  const project = join(session.root, "project");
  // Every Practice has a task card and body: exercise more than one native document batch.
  const totalPractices = Math.floor(EMBEDDING_MODEL.maxInputs / 2) + 1;
  await writeNativeProjectPack(project, totalPractices);
  const projectArgs = ["--cache-root", session.cacheRoot, "--project-root", project];
  const invoke = (args: readonly string[]) => session.invoke([...projectArgs, ...args]);
  const queryArgs = ["query", "marker-v1-000", "--require-complete"];
  const readyQueryArgs = [...queryArgs, "--max-wait-ms", "0"];
  const before = environment.encodingStats();
  const singleQuery = expectOk(
    "default single-vector query",
    await invoke([...queryArgs, "--max-wait-ms", "120000"]),
  );
  assert.equal(singleQuery.coverage, "complete");
  assert.equal(singleQuery.retrievalMethod, "single-vector");
  assert.equal(typeof singleQuery.profileId, "string");
  const singleStatus = expectOk("default single-vector index", await invoke(["index", "status"]));
  assert.equal(singleStatus.state, "ready");
  assert.equal(singleStatus.profileId, singleQuery.profileId);

  const beforeMulti = environment.encodingStats();
  const temporaryQuery = expectOk(
    "temporary experimental mode builds its own artifact",
    await invoke([...queryArgs, "--mode", "multi-view-vector", "--max-wait-ms", "120000"]),
  );
  assert.equal(temporaryQuery.mode, "semantic");
  assert.equal(temporaryQuery.retrievalMethod, "multi-view-vector");
  assert.equal(temporaryQuery.coverage, "complete");
  assert.notEqual(temporaryQuery.profileId, singleStatus.profileId);
  assert(
    environment.encodingStats().documentCount - beforeMulti.documentCount >
      EMBEDDING_MODEL.maxInputs,
    "The multi-view native path must cover a document batch boundary",
  );
  const multiNativeBatchSizes = environment
    .encodingStats()
    .nativeBatchSizes.slice(beforeMulti.nativeBatchSizes.length);
  assert(
    multiNativeBatchSizes.includes(EMBEDDING_MODEL.maxInputs),
    "Multi-view index construction must complete a real native batch, not a singleton forwarding loop",
  );
  await assert.rejects(readFile(session.configFile), { code: "ENOENT" });
  const defaultAfterTemporary = expectOk(
    "ordinary query restores default after temporary mode",
    await invoke(readyQueryArgs),
  );
  assert.equal(defaultAfterTemporary.profileId, singleStatus.profileId);

  await writeFile(session.configFile, "query:\n  retrievalMethod: multi-view-vector\n");
  const multiStatus = expectOk(
    "multi-view-vector isolated status",
    await invoke(["index", "status"]),
  );
  assert.equal(multiStatus.state, "ready");
  assert.equal(multiStatus.profileId, temporaryQuery.profileId);
  expectOk("multi-view-vector build", await invoke(["index", "build"]));
  await environment.waitForIdle();
  const beforeMultiQuery = environment.encodingStats();
  const multiQuery = expectOk(
    "multi-view-vector complete query",
    await invoke([
      "query",
      "marker-v1-000; implementation performance",
      "--require-complete",
      "--max-wait-ms",
      "0",
    ]),
  );
  assert.equal(multiQuery.coverage, "complete");
  assert.equal(multiQuery.retrievalMethod, "multi-view-vector");
  assert.equal(multiQuery.profileId, multiStatus.profileId);
  const afterMultiQuery = environment.encodingStats();
  assert.equal(
    afterMultiQuery.documentCount,
    beforeMultiQuery.documentCount,
    "A ready query must not hide a document rebuild",
  );
  const multiQueryNativeBatchSizes = afterMultiQuery.nativeBatchSizes.slice(
    beforeMultiQuery.nativeBatchSizes.length,
  );
  assert(
    multiQueryNativeBatchSizes.some((size) => size > 1),
    "Multiple query clauses must complete together in a real native request",
  );
  const multiConfig = await readFile(session.configFile, "utf8");
  const temporarySingle = expectOk(
    "temporary single-vector mode overrides a multi-view-vector config",
    await invoke([...readyQueryArgs, "--mode", "single-vector"]),
  );
  assert.equal(temporarySingle.mode, "semantic");
  assert.equal(temporarySingle.retrievalMethod, "single-vector");
  assert.equal(temporarySingle.profileId, singleStatus.profileId);
  assert.equal(await readFile(session.configFile, "utf8"), multiConfig);
  const multiRebuild = expectOk("multi-view-vector rebuild", await invoke(["index", "rebuild"]));
  await environment.waitForIdle();

  await writeFile(session.configFile, "query:\n  retrievalMethod: single-vector\n");
  const restoredStatus = expectOk(
    "single-vector restored without daemon restart",
    await invoke(["index", "status"]),
  );
  assert.equal(restoredStatus.state, "ready");
  assert.equal(restoredStatus.profileId, singleStatus.profileId);
  const restoredQuery = expectOk("single-vector restored query", await invoke(readyQueryArgs));
  assert.equal(restoredQuery.profileId, singleStatus.profileId);
  const previousOperation = expectOk(
    "multi-view-vector operation survives selection change",
    await session.invoke(["index", "operation", String(multiRebuild.operationId)]),
  );
  assert(isRecord(previousOperation.index));
  assert.equal(previousOperation.index.profileId, multiStatus.profileId);

  const invalidConfig = "query:\n  retrievalMethod: invalid\n";
  await writeFile(session.configFile, invalidConfig);
  const invalidSemantic = await invoke(["query", "marker-v1-000"]);
  assert.equal(invalidSemantic.response.error?.code, "query.config-invalid");
  const explicitWithInvalidConfig = expectOk(
    "temporary mode overrides invalid method config",
    await invoke([...readyQueryArgs, "--mode", "multi-view-vector"]),
  );
  assert.equal(explicitWithInvalidConfig.mode, "semantic");
  assert.equal(explicitWithInvalidConfig.profileId, multiStatus.profileId);
  assert.equal(await readFile(session.configFile, "utf8"), invalidConfig);
  expectOk(
    "keyword ignores invalid semantic method",
    await invoke(["query", "marker-v1-000", "--mode", "keyword"]),
  );

  const after = environment.encodingStats();
  return {
    fixture: { totalPractices },
    observations: {
      retrievalMethods: ["single-vector", "multi-view-vector", "single-vector"],
      temporaryModeOverrides: ["multi-view-vector", "single-vector"],
      configurationUnchanged: true,
      methodDocumentBatches: after.batches - before.batches,
      methodDocumentInputs: after.documentCount - before.documentCount,
      multiNativeBatchSizes,
      multiQueryNativeBatchSizes,
    },
  };
}
