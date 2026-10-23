import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { chinesePracticeId, type InstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runGet, runQuery } from "../support/commands.js";
import { runProcess } from "../support/process.js";
import {
  isRecord,
  parseSingleResponse,
  requireFailureCode,
  requireSuccessData,
} from "../support/protocol.js";

/** Verify persisted `get` content and keyword-query behavior in the compiled CLI. */
export async function verifyGetAndQueryScenario(
  compiledBinary: string,
  fixture: InstalledPacksFixture,
  workingDirectory: string,
): Promise<void> {
  const first = await runGet(compiledBinary, fixture.primaryPracticeId, fixture.storageRoot);
  assert.equal(first.exitCode, 0);
  assert.equal(first.stderr, "");
  const firstData = requireSuccessData(parseSingleResponse(first.stdout), "get");
  assert(isRecord(firstData.practice));
  assert.deepEqual(firstData.practice, {
    id: fixture.primaryPracticeId,
    title: "Persisted retrieval demo",
    stage: "integration",
    tech_stack: ["bun", "typescript"],
    applies_when: "exercising the compiled get command",
    severity: "warn",
    body: "# Persisted guidance\n\nThis complete body must survive installation and retrieval.\n",
    anti_patterns: [
      {
        id: "integration.retrieval.skip",
        name: "Skip persisted state",
        description: "Do not bypass the local snapshot.",
        severity: "warn",
      },
    ],
  });
  assert.match(String(firstData.contentDigest), /^[0-9a-f]{64}$/);
  assert.equal(Array.isArray(firstData.sources), true);
  const sources = firstData.sources as unknown[];
  assert.equal(sources.length, 1);
  const source = sources[0];
  assert(isRecord(source));
  assert.equal(source.packName, "integration-pack");
  assert.equal(source.sourcePath, "practices/retrieval-demo.md");
  // A Store source exposes the public current view. Resolve both sides so a
  // symlinked temporary directory (macOS /var -> /private/var) cannot perturb
  // the comparison; a non-locator value fails realpath outright.
  assert.equal(
    await realpath(String(source.packRoot)),
    await realpath(join(fixture.storageRoot, "packs", "p-integration-pack", "current")),
  );

  const keyword = await runQuery(compiledBinary, "retrieval OR", fixture.storageRoot, 3);
  assert.equal(keyword.exitCode, 0);
  assert.equal(keyword.stderr, "");
  const keywordData = requireSuccessData(parseSingleResponse(keyword.stdout), "query");
  assert.equal(keywordData.mode, "keyword");
  assert(Array.isArray(keywordData.results));
  const keywordHit = keywordData.results.find(
    (value) => isRecord(value) && value.practiceId === fixture.primaryPracticeId,
  );
  assert(isRecord(keywordHit));
  const queriedGet = await runGet(compiledBinary, fixture.primaryPracticeId, fixture.storageRoot);
  const queriedGetData = requireSuccessData(parseSingleResponse(queriedGet.stdout), "get");
  assert.equal(keywordHit.contentDigest, queriedGetData.contentDigest);
  assert.equal(queriedGetData.contentDigest, firstData.contentDigest);

  const noMatches = await runQuery(compiledBinary, "zzzxylophone", fixture.storageRoot);
  assert.equal(noMatches.exitCode, 0);
  const emptyData = requireSuccessData(parseSingleResponse(noMatches.stdout), "query");
  assert.deepEqual(emptyData.results, []);
  const explanation = emptyData.empty;
  assert(isRecord(explanation));
  assert.equal(explanation.reason, "empty");
  assert.equal(explanation.nextAction, "finish-lookup");
  assert.match(String(explanation.message), /decision, constraints, and technology context/);
  assert.match(String(explanation.message), /at most one substantive rewrite for this lookup/);
  assert.match(
    String(explanation.message),
    /already specific or the rewrite is still empty, end this lookup only/,
  );
  assert.match(
    String(explanation.message),
    /Query Lorelum normally for other topics or new decisions/,
  );
  assert.equal("empty" in keywordData, false);
  await Promise.all(
    [[], ["--verbose"]].map(async (flags) => {
      const text = await runProcess([
        compiledBinary,
        "query",
        "zzzxylophone",
        "--mode",
        "keyword",
        "--store-root",
        fixture.storageRoot,
        ...flags,
      ]);
      assert.equal(text.exitCode, 0);
      assert.equal(text.stderr, "");
      assert(text.stdout.startsWith(String(explanation.message)));
      assert.match(text.stdout, /results: \[\]/);
    }),
  );

  // An empty topic must not suppress a later, independent query/get on another topic.
  const chinese = await runQuery(compiledBinary, "认证接口", fixture.storageRoot, 5);
  assert.equal(chinese.exitCode, 0);
  assert.equal(chinese.stderr, "");
  const chineseData = requireSuccessData(parseSingleResponse(chinese.stdout), "query");
  assert(Array.isArray(chineseData.results));
  const chineseHit = chineseData.results.find(
    (value) => isRecord(value) && value.practiceId === chinesePracticeId,
  );
  assert(isRecord(chineseHit));
  assert.equal("empty" in chineseData, false);
  const chineseGet = await runGet(compiledBinary, chinesePracticeId, fixture.storageRoot);
  assert.equal(chineseGet.exitCode, 0);
  const chineseGetData = requireSuccessData(parseSingleResponse(chineseGet.stdout), "get");
  assert(isRecord(chineseGetData.practice));
  assert.equal(chineseGetData.practice.id, chinesePracticeId);
  assert.match(String(chineseGetData.practice.body), /通过现有认证接口完成页面请求/);
  assert.equal(chineseHit.contentDigest, chineseGetData.contentDigest);

  const before = await runGet(
    compiledBinary,
    fixture.primaryPracticeId,
    fixture.storageRoot,
    "before",
  );
  assert.equal(before.exitCode, 0);
  assert.equal(before.stderr, "");
  const beforeData = requireSuccessData(parseSingleResponse(before.stdout), "get");
  assert.deepEqual(beforeData.practice, firstData.practice);
  assert.equal(beforeData.contentDigest, firstData.contentDigest);
  assert.deepEqual(beforeData.sources, firstData.sources);

  const absent = await runGet(compiledBinary, "integration.retrieval.absent", fixture.storageRoot);
  assert.equal(absent.exitCode, 2);
  assert.equal(absent.stderr, "");
  requireFailureCode(parseSingleResponse(absent.stdout), "get", "practice.not-found");

  const isolatedRoot = join(workingDirectory, "isolated-store");
  await mkdir(isolatedRoot, { recursive: true });
  const emptyStore = await runQuery(compiledBinary, "anything", isolatedRoot);
  assert.equal(emptyStore.exitCode, 0);
  const emptyStoreData = requireSuccessData(parseSingleResponse(emptyStore.stdout), "query");
  assert.deepEqual(emptyStoreData.results, []);
  assert(isRecord(emptyStoreData.empty));
  assert.equal(emptyStoreData.empty.reason, "corpus-empty");
  assert.equal(emptyStoreData.empty.nextAction, "finish-lookup");
  assert.doesNotMatch(String(emptyStoreData.empty.message), /try at most one/);
  const isolated = await runGet(compiledBinary, fixture.primaryPracticeId, isolatedRoot);
  assert.equal(isolated.exitCode, 2);
  requireFailureCode(parseSingleResponse(isolated.stdout), "get", "practice.not-found");

  const malformedRoot = join(workingDirectory, "malformed-store");
  const malformed = await runGet(compiledBinary, "invalid-id", malformedRoot);
  assert.equal(malformed.exitCode, 2);
  assert.equal(malformed.stderr, "");
  requireFailureCode(parseSingleResponse(malformed.stdout), "get", "usage.invalid");
  assert.equal(existsSync(malformedRoot), false, "malformed IDs must not create a Store root");
}
