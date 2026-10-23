import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { writeNativeProjectPack } from "../fixtures/native-project.js";
import { expectOk, type NativeSmokeEnvironment } from "../support/native-smoke.js";
import { isRecord } from "../support/protocol.js";

/** Exercise empty query explanations through CLI, HTTP Backend and the real native runtime. */
export async function verifyEmptyQueryNativeScenario(environment: NativeSmokeEnvironment) {
  const session = await environment.createSession("empty-query");
  const before = environment.encodingStats();
  const args = ["--cache-root", session.cacheRoot, "query", "decide deployment constraints"];
  const first = await session.invoke(["--no-project", ...args]);
  if (first.exitCode === 1) await environment.waitForIdle();
  const store = expectOk(
    "empty Store semantic query",
    first.exitCode === 0 ? first : await session.invoke(["--no-project", ...args]),
  );
  assert.equal(store.mode, "semantic");
  assert.equal(store.coverage, "complete");
  assert.deepEqual(store.results, []);
  assert(isRecord(store.empty));
  assert.equal(store.empty.reason, "corpus-empty");
  assert.equal(store.empty.nextAction, "continue-task");
  assert.match(String(store.empty.message), /no retrievable Practices/);
  assert.equal("emptyReason" in store, false);

  const projectRoot = join(session.root, "project");
  await writeNativeProjectPack(projectRoot, 0);
  await writeFile(
    join(projectRoot, ".lorelum", "packs", "performance", "practices", "broken.md"),
    "---\nid: empty.broken\nstage: implementation\n---\nInvalid Practice\n",
  );
  const project = expectOk(
    "empty degraded ProjectContext semantic query",
    await session.invoke(["--project-root", projectRoot, ...args]),
  );
  assert.equal(project.coverage, "complete");
  assert.deepEqual(project.results, []);
  assert(isRecord(project.empty));
  assert.equal(project.empty.reason, "corpus-empty");
  assert.match(String(project.empty.message), /see context warnings/);
  assert(isRecord(project.context));
  assert.equal(project.context.state, "degraded");
  assert(Array.isArray(project.context.warnings));
  assert(
    project.context.warnings.some(
      (warning) => isRecord(warning) && warning.code === "practice.invalid",
    ),
  );
  assert.deepEqual(
    environment.encodingStats().nativeBatchSizes,
    before.nativeBatchSizes,
    "Empty queries must not request document or query embedding",
  );
  return {
    observations: {
      emptyStore: "corpus-empty",
      emptyProject: "corpus-empty",
      emptyQueryEmbeddings: 0,
    },
  };
}
