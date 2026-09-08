import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { UnvalidatedPackInput } from "@lorelum/format";

import { createPackCandidate, type PackCandidate } from "../model";

import { installOrUpgrade } from "./install";
import { createMutationMetrics } from "../storage/sqlite/mutation-metrics";
import { uninstallPack } from "./uninstall";

function candidate(
  name: string,
  version: string,
  practices: Record<string, string>,
): PackCandidate {
  const input: UnvalidatedPackInput = {
    pack: { name, version },
    practices: Object.entries(practices).map(([id, body]) => ({
      id,
      title: id,
      stage: "api",
      tech_stack: ["typescript"],
      applies_when: "benchmarking mutation metrics",
      severity: "warn",
      body,
    })),
    decisions: [],
  };
  const sourcePaths = Object.fromEntries(
    Object.keys(practices).map((id) => [id, `practices/${id}.md`]),
  );
  return createPackCandidate(input, sourcePaths).candidate;
}

async function withRoot(run: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(join(tmpdir(), "lorelum-mutation-metrics-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

test("normal mutation metrics stay bounded to the affected Practice rows", async () => {
  await withRoot(async (rootPath) => {
    const base = candidate("base", "1.0.0", {
      "base.api": "Keep the baseline row.",
      "base.auth": "Keep the unrelated row.",
    });
    const targetV1 = candidate("target", "1.0.0", { "target.api": "Use the first rule." });
    const targetV2 = candidate("target", "2.0.0", { "target.api": "Use the changed rule." });

    await installOrUpgrade(rootPath, base, "install", undefined);

    const addMetrics = createMutationMetrics();
    const added = await installOrUpgrade(rootPath, targetV1, "install", undefined, [], addMetrics);
    const addedSnapshot = addMetrics.snapshot();
    expect(added).not.toHaveProperty("metrics");
    expect(addedSnapshot.materializedEffectivePractices).toBe(0);
    expect(addedSnapshot.materializedSourceRows).toBe(0);
    expect(addedSnapshot.writes.effective_practices).toBe(1);
    expect(addedSnapshot.writes.practice_sources).toBe(1);
    expect(addedSnapshot.writes.active_packs).toBe(1);
    expect(addedSnapshot.writes.local_store_metadata).toBe(1);
    expect(addedSnapshot.writes.effective_revision_log).toBe(1);

    const upgradeMetrics = createMutationMetrics();
    const upgraded = await installOrUpgrade(
      rootPath,
      targetV2,
      "upgrade",
      undefined,
      [],
      upgradeMetrics,
    );
    const upgradedSnapshot = upgradeMetrics.snapshot();
    expect(upgraded).not.toHaveProperty("metrics");
    expect(upgradedSnapshot.materializedEffectivePractices).toBe(1);
    expect(upgradedSnapshot.materializedSourceRows).toBe(1);
    expect(upgradedSnapshot.writes.effective_practices).toBe(2);
    expect(upgradedSnapshot.writes.practice_sources).toBe(2);
    expect(upgradedSnapshot.writes.active_packs).toBe(1);
    expect(upgradedSnapshot.writes.local_store_metadata).toBe(1);
    expect(upgradedSnapshot.writes.effective_revision_log).toBe(1);

    const uninstallMetrics = createMutationMetrics();
    const uninstalled = await uninstallPack(rootPath, "target", undefined, uninstallMetrics);
    const uninstalledSnapshot = uninstallMetrics.snapshot();
    expect(uninstalled).not.toHaveProperty("metrics");
    expect(uninstalledSnapshot.materializedEffectivePractices).toBe(1);
    expect(uninstalledSnapshot.materializedSourceRows).toBe(1);
    expect(uninstalledSnapshot.writes.effective_practices).toBe(1);
    expect(uninstalledSnapshot.writes.practice_sources).toBe(1);
    expect(uninstalledSnapshot.writes.active_packs).toBe(1);
    expect(uninstalledSnapshot.writes.local_store_metadata).toBe(1);
    expect(uninstalledSnapshot.writes.effective_revision_log).toBe(1);
  });
});
