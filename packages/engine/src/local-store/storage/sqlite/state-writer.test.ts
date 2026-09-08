import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { reactPack } from "@lorelum/format";

import { createPackCandidate, reconcileEffectivePractices } from "../../model";

import { migrateDatabase } from "./migrations";
import { LOCAL_STORE_SCHEMA_VERSION } from "./migrations";
import { readEffectivePracticeSnapshot } from "./snapshot-reader";
import { writeDerivedState } from "./state-writer";

function candidate(name: string) {
  const input = reactPack();
  input.pack.name = name;
  return createPackCandidate(input, {
    "react.api.layered-design": "practices/api/layered-design.md",
    "react.state.redux": "practices/state/redux.md",
    "react.auth.guard": "practices/auth/guard.md",
  }).candidate;
}

function activePack(packName: string) {
  return {
    packName,
    packVersion: "0.1.0",
    artifactDigest: packName === "react-core" ? "a".repeat(64) : "b".repeat(64),
    storageKey: "p-" + packName,
    installedAt: "2026-07-27T00:00:00.000Z",
  };
}

test("writer and reader round-trip derived state with deterministic source ordering", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    const first = reconcileEffectivePractices([], candidate("react-core"));
    const reconciled = reconcileEffectivePractices(first.sources, candidate("react-fullstack"));
    writeDerivedState(database, {
      generation: 3,
      effectiveRevision: 7,
      activePacks: [activePack("react-core"), activePack("react-fullstack")],
      effectivePractices: reconciled.effectivePractices,
    });

    const snapshot = readEffectivePracticeSnapshot(database);
    expect(snapshot.metadata).toEqual({
      schemaVersion: LOCAL_STORE_SCHEMA_VERSION,
      generation: 3,
      effectiveRevision: 7,
    });
    expect(snapshot.effectivePractices.map((practice) => practice.practiceId)).toEqual([
      "react.api.layered-design",
      "react.auth.guard",
      "react.state.redux",
    ]);
    expect(snapshot.effectivePractices[0]?.sources.map((source) => source.packName)).toEqual([
      "react-core",
      "react-fullstack",
    ]);
  } finally {
    database.close();
  }
});

test("reader rejects an Effective Practice whose stored metadata was tampered", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    const reconciled = reconcileEffectivePractices([], candidate("react-core"));
    writeDerivedState(database, {
      generation: 1,
      effectiveRevision: 1,
      activePacks: [activePack("react-core")],
      effectivePractices: reconciled.effectivePractices,
    });
    database
      .prepare("UPDATE effective_practices SET title = 'tampered' WHERE practice_id = ?")
      .run("react.api.layered-design");

    expect(() => readEffectivePracticeSnapshot(database)).toThrow(
      "materialization is inconsistent",
    );
  } finally {
    database.close();
  }
});

test("writer rejects an Effective Practice whose source data was tampered", () => {
  const database = new Database(":memory:");
  try {
    migrateDatabase(database);
    const reconciled = reconcileEffectivePractices([], candidate("react-core"));
    const effective = reconciled.effectivePractices[0]!;
    expect(() =>
      writeDerivedState(database, {
        generation: 1,
        effectiveRevision: 1,
        activePacks: [activePack("react-core")],
        effectivePractices: [
          {
            ...effective,
            sources: [{ ...effective.sources[0]!, sourcePath: "practices/../escape.md" }],
          },
        ],
      }),
    ).toThrow("source is inconsistent");
  } finally {
    database.close();
  }
});
