import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SemanticOperationJournal } from "./project-operation-journal";

const digest = "a".repeat(64);

test("persists opaque project targets and converts interrupted work to waiting-for-source", async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "lorelum-project-operation-journal-")),
  );
  try {
    const journal = new SemanticOperationJournal(directory);
    await journal.upsert({
      operationId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      targetKind: "project",
      sourceId: digest,
      targetSlotId: "b".repeat(64),
      cacheScopeId: "f".repeat(64),
      artifactId: "c".repeat(64),
      corpusDigest: "d".repeat(64),
      profileId: "e".repeat(64),
      state: "building",
      indexedPracticeCount: 50,
      totalPracticeCount: 100,
      attempts: 1,
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
    });
    await expect(journal.recover()).resolves.toMatchObject([
      {
        state: "waiting-for-source",
        indexedPracticeCount: 50,
        totalPracticeCount: 100,
      },
    ]);
    const raw = await readFile(join(directory, "semantic-index-operations.json"), "utf8");
    expect(raw).not.toContain("/Users/");
    expect(raw).not.toContain("Practice:");
    expect(raw).not.toContain("cacheRoot");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
