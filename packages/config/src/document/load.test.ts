import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigError, loadConfig } from "./load";

async function fixture(run: (homeDirectory: string, filePath: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "lorelum-shared-config-"));
  try {
    await run(home, join(home, ".lorelum", "config.yaml"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
test("shared default path supports comments and independent sections", () =>
  fixture(async (homeDirectory, filePath) => {
    expect(await loadConfig({ homeDirectory })).toEqual({});
    expect(await readdir(homeDirectory)).toEqual([]);
    await mkdir(join(homeDirectory, ".lorelum"));
    await writeFile(
      filePath,
      "# shared config\nbackend:\n  requestTimeoutMs: 2000\nquery:\n  profile: local\n",
    );
    expect(await loadConfig({ homeDirectory })).toEqual({
      backend: { requestTimeoutMs: 2000 },
      query: { profile: "local" },
    });
  }));
for (const content of ["", "# comment only\n"]) {
  test("empty YAML uses an empty document", () =>
    fixture(async (homeDirectory, filePath) => {
      await mkdir(join(homeDirectory, ".lorelum"));
      await writeFile(filePath, content);
      expect(await loadConfig({ filePath })).toEqual({});
    }));
}
for (const content of [
  "null",
  "[]",
  "text",
  "backend: 1\nbackend: 2",
  "private: [secret",
  "---\na: 1\n---\nb: 2",
  " ".repeat(16385),
]) {
  test("invalid document produces a sanitized error: " + content.slice(0, 20), () =>
    fixture(async (homeDirectory, filePath) => {
      await mkdir(join(homeDirectory, ".lorelum"));
      await writeFile(filePath, content);
      await expect(loadConfig({ filePath })).rejects.toEqual(new ConfigError());
    }),
  );
}

test("global config treats consumer sections as data rather than validating backend fields", () =>
  fixture(async (homeDirectory, filePath) => {
    await mkdir(join(homeDirectory, ".lorelum"));
    await writeFile(
      filePath,
      "cli:\n  example: local\nstore:\n  example: offline\nbackend:\n  requestTimeoutMs: invalid\n",
    );
    const config = await loadConfig({ homeDirectory });
    expect(config.cli).toEqual({ example: "local" });
    expect(config.store).toEqual({ example: "offline" });
    expect(config.backend).toEqual({ requestTimeoutMs: "invalid" });
  }));
