import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../runtime/errors";
import {
  DEFAULT_QUERY_SETTINGS,
  loadQuerySettings,
  loadSemanticRetrievalSettings,
} from "./settings";

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

test("rejects invalid user query settings with an actionable message", async () => {
  await fixture(async (home, file) => {
    await writeFile(file, "query:\n  maxWaitMs: nope\n");
    try {
      await loadQuerySettings({ homeDirectory: home });
      throw new Error("Expected query configuration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      if (!(error instanceof CliError)) throw error;
      expect(error.code).toBe("query.config-invalid");
      expect(error.message).toContain("query.maxWaitMs");
      expect(error.message).toContain("integer");
      expect(error.message).toContain("0");
      expect(error.message).toContain("120000");
      expect(error.message).toContain(file);
      expect(error.message).toContain("string");
    }
  });
});

test("identifies the out-of-range setting in the same message", async () => {
  await fixture(async (home, file) => {
    await writeFile(file, "query:\n  minCoveragePercent: 200\n");
    try {
      await loadQuerySettings({ homeDirectory: home });
      throw new Error("Expected query configuration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      if (!(error instanceof CliError)) throw error;
      expect(error.code).toBe("query.config-invalid");
      expect(error.message).toContain("query.minCoveragePercent");
      expect(error.message).toContain("integer");
      expect(error.message).toContain("100");
      expect(error.message).toContain("200");
      expect(error.message).toContain(file);
    }
  });
});

test("keeps YAML syntax failures safe and actionable", async () => {
  await fixture(async (home, file) => {
    await writeFile(file, "query:\n  maxWaitMs: [broken\n");
    let caught: unknown;
    try {
      await loadQuerySettings({ homeDirectory: home });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).code).toBe("query.config-invalid");
    expect((caught as CliError).message).toContain(file);
    expect((caught as CliError).message).toContain("YAML");
    expect((caught as CliError).message).not.toContain("broken");
  });
});

test("defaults semantic retrieval to single-vector and reloads changes on each call", async () => {
  await fixture(async (home, file) => {
    expect(await loadSemanticRetrievalSettings({ homeDirectory: home })).toEqual({
      retrievalMethod: "single-vector",
    });
    await writeFile(file, "query:\n  retrievalMethod: multi-view-vector\n  maxWaitMs: invalid\n");
    expect(await loadSemanticRetrievalSettings({ homeDirectory: home })).toEqual({
      retrievalMethod: "multi-view-vector",
    });
    await writeFile(file, "query:\n  retrievalMethod: single-vector\n");
    expect(await loadSemanticRetrievalSettings({ homeDirectory: home })).toEqual({
      retrievalMethod: "single-vector",
    });
  });
});

test.each(["simple", "multi-view", "multiview", "null", "42", "true", "[]", "{}"])(
  "rejects invalid semantic retrieval method %s without aliases",
  async (value) => {
    await fixture(async (home, file) => {
      await writeFile(file, `query:\n  retrievalMethod: ${value}\n`);
      await expect(loadSemanticRetrievalSettings({ homeDirectory: home })).rejects.toMatchObject({
        code: "query.config-invalid",
        message: expect.stringContaining("query.retrievalMethod"),
      });
      expect(await loadQuerySettings({ homeDirectory: home })).toEqual(DEFAULT_QUERY_SETTINGS);
    });
  },
);

test.each(["null", "42", "[]"])("rejects an invalid semantic query section %s", async (value) => {
  await fixture(async (home, file) => {
    await writeFile(file, `query: ${value}\n`);
    await expect(loadSemanticRetrievalSettings({ homeDirectory: home })).rejects.toMatchObject({
      code: "query.config-invalid",
      message: expect.stringContaining("query section"),
    });
  });
});
