import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_QUERY_SETTINGS, loadQuerySettings } from "./settings";

async function fixture(run: (home: string, file: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "lorelum-query-settings-"));
  const file = join(home, ".lorelum", "config.yaml");
  try {
    await mkdir(join(home, ".lorelum"));
    await run(home, file);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("uses integer millisecond and coverage defaults when query settings are omitted", async () => {
  await fixture(async (home) => {
    await expect(loadQuerySettings({ homeDirectory: home })).resolves.toEqual(
      DEFAULT_QUERY_SETTINGS,
    );
  });
});

test("loads project-independent user query settings", async () => {
  await fixture(async (home, file) => {
    await writeFile(file, "query:\n  maxWaitMs: 5000\n  minCoveragePercent: 80\n");
    await expect(loadQuerySettings({ homeDirectory: home })).resolves.toEqual({
      maxWaitMs: 5_000,
      minCoveragePercent: 80,
    });
  });
});

test("rejects invalid user query settings without exposing YAML details", async () => {
  await fixture(async (home, file) => {
    await writeFile(file, "query:\n  maxWaitMs: nope\n");
    await expect(loadQuerySettings({ homeDirectory: home })).rejects.toMatchObject({
      code: "query.config-invalid",
    });
  });
});
