import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBackendConfig } from "@lorelum/backend/config";
import { loadConfig } from "@lorelum/config";
import { initializeApplicationConfig } from "./initialize";

async function fixture(run: (homeDirectory: string, filePath: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lore-app-config-")));
  try {
    await run(root, join(root, "config.yaml"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("explicit initialization creates editable defaults and resolves all paths from the supplied home", () =>
  fixture(async (homeDirectory) => {
    await initializeApplicationConfig({ homeDirectory });
    const config = await loadBackendConfig({ homeDirectory, environment: {} });
    expect(config.embedding).toMatchObject({
      threads: 4,
      cacheDirectory: join(homeDirectory, ".lorelum", "models"),
    });
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(homeDirectory, ".lorelum", "config.yaml"), "utf8");
    expect(source).toContain("threads: 4");
    expect(source).not.toContain(homeDirectory);
    const url = config.embedding?.download?.url;
    if (!url) throw new Error("Expected initialized default model URL");
    expect(url).toContain("/resolve/7a8af1473a747268bbb3968b77d5b822a6506667/");
    expect(source).toContain(url);
    expect(await loadBackendConfig({ homeDirectory, environment: {} })).toEqual(config);
  }));

test("initialization does not overwrite other modules, user comments, or invalid configuration", () =>
  fixture(async (homeDirectory, filePath) => {
    const { readFile } = await import("node:fs/promises");
    const source =
      "# owner comment\nquery:\n  profile: custom\nbackend:\n  requestTimeoutMs: 2000\n";
    await writeFile(filePath, source);
    await initializeApplicationConfig({ homeDirectory, filePath });
    const config = await loadBackendConfig({ homeDirectory, filePath, environment: {} });
    expect(config.settings.requestTimeoutMs).toBe(2000);
    expect(await readFile(filePath, "utf8")).toBe(source);
    await writeFile(filePath, "broken: [");
    await expect(
      loadBackendConfig({ homeDirectory, filePath, environment: {} }),
    ).rejects.toMatchObject({ code: "backend.config-invalid" });
    expect(await readFile(filePath, "utf8")).toBe("broken: [");
  }));

test("CLI reads its section without validating or contacting the backend", () =>
  fixture(async (homeDirectory, filePath) => {
    await writeFile(
      filePath,
      "cli:\n  example: local-only\nbackend:\n  requestTimeoutMs: invalid\n",
    );
    const document = await loadConfig({ homeDirectory, filePath });
    expect(document.cli).toEqual({ example: "local-only" });
    await expect(
      loadBackendConfig({ homeDirectory, filePath, environment: {} }),
    ).rejects.toMatchObject({ code: "backend.config-invalid" });
  }));
