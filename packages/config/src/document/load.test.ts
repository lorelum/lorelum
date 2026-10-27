import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from "node:fs/promises";
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
for (const [content, reason] of [
  ["null", "root-shape"],
  ["[]", "root-shape"],
  ["text", "root-shape"],
  ["backend: 1\nbackend: 2", "yaml-syntax"],
  ["private: [secret", "yaml-syntax"],
  ["---\na: 1\n---\nb: 2", "yaml-syntax"],
  [" ".repeat(16385), "too-large"],
] as const) {
  test(`invalid document records its ${reason} category`, () =>
    fixture(async (homeDirectory, filePath) => {
      await mkdir(join(homeDirectory, ".lorelum"));
      await writeFile(filePath, content);
      await expect(loadConfig({ filePath })).rejects.toMatchObject({
        failure: { kind: "document", reason, source: { kind: "file", path: filePath } },
      });
    }));
}

test("YAML syntax exposes only a reliable one-based position and leaves the file unchanged", () =>
  fixture(async (homeDirectory, filePath) => {
    await mkdir(join(homeDirectory, ".lorelum"));
    const contents = "private-token: [secret";
    await writeFile(filePath, contents);
    const before = await readFile(filePath);

    let error: unknown;
    try {
      await loadConfig({ filePath });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) throw error;
    expect(error.failure).toEqual({
      kind: "document",
      source: { kind: "file", path: filePath },
      reason: "yaml-syntax",
      location: { line: 2, column: 1 },
    });
    expect(error.message).not.toContain("private-token");
    expect(error.message).not.toContain("secret");
    expect(error.cause).toBeUndefined();
    expect(Object.hasOwn(error, "cause")).toBe(false);
    expect(await readFile(filePath)).toEqual(before);
  }));

test("directory paths are categorized as not-file", () =>
  fixture(async (homeDirectory) => {
    const directory = join(homeDirectory, "config-directory");
    await mkdir(directory);
    await expect(loadConfig({ filePath: directory })).rejects.toMatchObject({
      failure: { kind: "document", reason: "not-file" },
    });
  }));

test("a non-directory parent produces a sanitized unreadable failure", () =>
  fixture(async (homeDirectory) => {
    const parent = join(homeDirectory, "not-a-directory");
    await writeFile(parent, "unchanged");
    await expect(loadConfig({ filePath: join(parent, "config.yaml") })).rejects.toMatchObject({
      failure: { kind: "document", reason: "unreadable" },
      message: expect.not.stringContaining("ENOTDIR"),
    });
  }));

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
