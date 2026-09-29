import { expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly displayName?: string;
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
  readonly owner: { readonly name: string; readonly url?: string };
  readonly plugins: readonly MarketplaceEntry[];
}

test("Claude Code marketplace exposes the lorelum Plugin from the lorelum-plugins namespace", async () => {
  const [manifest, marketplace] = await Promise.all([
    readFile(join(import.meta.dir, "../.claude-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as PluginManifest,
    ),
    readFile(join(import.meta.dir, "../../../../.claude-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as MarketplaceConfig,
    ),
  ]);

  expect(manifest.name).toBe("lorelum");
  expect(manifest.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
  expect(manifest.version).toBe("0.1.0-alpha.5");
  expect(manifest.description).toContain("Claude Code");
  expect(manifest.license).toBe("Apache-2.0");
  expect(manifest.displayName).toBe("Lorelum");
  expect(manifest.mcpServers).toBeUndefined();
  // Claude Code discovers skills/ and hooks/hooks.json from their conventional
  // directories. A manifest `hooks` entry means an inline Hook object or an
  // exact Hook-file path, so leaving it undefined avoids a double declaration;
  // no path pointers are needed and `commands/` is deliberately not shipped
  // (Claude Code positions commands as the legacy form of skills).
  expect(manifest.hooks).toBeUndefined();
  expect(manifest.skills).toBeUndefined();
  expect(manifest.commands).toBeUndefined();
  const skillFile = await stat(join(import.meta.dir, "../skills/lorelum/SKILL.md"));
  expect(skillFile.isFile()).toBe(true);
  const hookConfiguration = await stat(join(import.meta.dir, "../hooks/hooks.json"));
  expect(hookConfiguration.isFile()).toBe(true);
  await expect(stat(join(import.meta.dir, "../commands"))).rejects.toThrow();
  await readFile(join(import.meta.dir, "../assets/lorelum-icon.svg"), "utf8");

  expect(marketplace.name).toBe("lorelum-plugins");
  expect(marketplace.owner).toEqual({ name: "Lorelum", url: "https://lorelum.com" });
  expect(marketplace.plugins).toEqual([
    expect.objectContaining({
      name: "lorelum",
      source: "./plugins/claude/lorelum",
      version: manifest.version,
    }),
  ]);
  const marketplaceDirectory = await stat(
    join(import.meta.dir, "../../../..", marketplace.plugins[0]!.source),
  );
  expect(marketplaceDirectory.isDirectory()).toBe(true);
  expect(`${manifest.name}@${marketplace.name}`).toBe("lorelum@lorelum-plugins");
});
