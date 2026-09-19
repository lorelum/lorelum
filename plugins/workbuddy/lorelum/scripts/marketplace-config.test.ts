import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly skills?: string;
  readonly commands?: string;
  readonly hooks?: unknown;
  readonly mcpServers?: unknown;
}

interface MarketplaceEntry {
  readonly name: string;
  readonly source: string;
  readonly version: string;
}

interface MarketplaceConfig {
  readonly name: string;
  readonly plugins: readonly MarketplaceEntry[];
}

test("WorkBuddy marketplace exposes the lorelum Plugin from the lorelum-plugins namespace", async () => {
  const [manifest, marketplace] = await Promise.all([
    readFile(join(import.meta.dir, "../.codebuddy-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as PluginManifest,
    ),
    readFile(
      join(import.meta.dir, "../../../../.codebuddy-plugin/marketplace.json"),
      "utf8",
    ).then((content) => JSON.parse(content) as MarketplaceConfig),
  ]);

  expect(manifest.name).toBe("lorelum");
  expect(manifest.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
  expect(manifest.version).toBe("0.1.0-alpha.3");
  expect(manifest.description).toContain("WorkBuddy");
  expect(manifest.license).toBe("Apache-2.0");
  expect(manifest.mcpServers).toBeUndefined();
  // WorkBuddy discovers a Plugin's hooks/hooks.json automatically. A manifest
  // `hooks` entry means an inline Hook object or an exact Hook-file path, so a
  // directory value would be diagnosed as an unreadable Hook file.
  expect(manifest.hooks).toBeUndefined();
  const componentDirectories = await Promise.all(
    [manifest.commands, manifest.skills].map((component) =>
      stat(join(import.meta.dir, "..", component ?? "")),
    ),
  );
  for (const directory of componentDirectories) {
    expect(directory).toBeTruthy();
  }
  const hookConfiguration = await stat(join(import.meta.dir, "../hooks/hooks.json"));
  expect(hookConfiguration.isFile()).toBe(true);
  await readFile(join(import.meta.dir, "../assets/lorelum-icon.svg"), "utf8");

  expect(marketplace.name).toBe("lorelum-plugins");
  expect(marketplace.plugins).toEqual([
    expect.objectContaining({
      name: "lorelum",
      source: "./plugins/workbuddy/lorelum",
      version: manifest.version,
    }),
  ]);
  const marketplaceDirectory = await stat(
    join(import.meta.dir, "../../../..", marketplace.plugins[0]!.source),
  );
  expect(marketplaceDirectory.isDirectory()).toBe(true);
  expect(`${manifest.name}@${marketplace.name}`).toBe("lorelum@lorelum-plugins");
});
