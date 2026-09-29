import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { chinesePracticeId, type InstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runGet, runQuery } from "../support/commands.js";
import {
  isRecord,
  parseSingleResponse,
  requireFailureCode,
  requireSuccessData,
} from "../support/protocol.js";

/** Compare full envelope output while masking the per-invocation random traceId. */
function withoutTraceId(stdout: string): string {
  return stdout.replace(/"traceId":"[0-9a-f-]{36}"/u, '"traceId":"<trace>"');
}

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

  const chinese = await runQuery(compiledBinary, "认证接口", fixture.storageRoot, 5);
  assert.equal(chinese.exitCode, 0);
  assert.equal(chinese.stderr, "");
  const chineseData = requireSuccessData(parseSingleResponse(chinese.stdout), "query");
  assert(Array.isArray(chineseData.results));
  assert(
    chineseData.results.some((value) => isRecord(value) && value.practiceId === chinesePracticeId),
  );

  const noMatches = await runQuery(compiledBinary, "zzzxylophone", fixture.storageRoot);
  assert.equal(noMatches.exitCode, 0);
  assert.deepEqual(requireSuccessData(parseSingleResponse(noMatches.stdout), "query").results, []);

  const before = await runGet(
    compiledBinary,
    fixture.primaryPracticeId,
    fixture.storageRoot,
    "before",
  );
  assert.equal(before.exitCode, 0);
  assert.equal(withoutTraceId(before.stdout), withoutTraceId(first.stdout));
  const after = await runGet(
    compiledBinary,
    fixture.primaryPracticeId,
    fixture.storageRoot,
    "after",
  );
  assert.equal(after.exitCode, 0);
  assert.equal(withoutTraceId(after.stdout), withoutTraceId(first.stdout));

  const absent = await runGet(compiledBinary, "integration.retrieval.absent", fixture.storageRoot);
  assert.equal(absent.exitCode, 2);
  assert.equal(absent.stderr, "");
  requireFailureCode(parseSingleResponse(absent.stdout), "get", "practice.not-found");

  const isolatedRoot = join(workingDirectory, "isolated-store");
  await mkdir(isolatedRoot, { recursive: true });
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
