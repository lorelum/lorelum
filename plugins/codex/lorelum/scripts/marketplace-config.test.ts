import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly homepage: string;
  readonly interface: {
    readonly displayName: string;
    readonly websiteURL: string;
    readonly brandColor: string;
    readonly composerIcon: string;
    readonly logo: string;
  };
}

interface MarketplaceEntry {
  readonly name: string;
  readonly source: {
    readonly source: string;
    readonly path: string;
  };
  readonly policy: {
    readonly installation: string;
    readonly authentication: string;
  };
  readonly category: string;
}

interface MarketplaceConfig {
  readonly name: string;
  readonly plugins: readonly MarketplaceEntry[];
}

test("public marketplace exposes the lorelum Plugin from its distinct marketplace namespace", async () => {
  const [manifest, marketplace] = await Promise.all([
    readFile(join(import.meta.dir, "../.codex-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as PluginManifest,
    ),
    readFile(join(import.meta.dir, "../../../../.agents/plugins/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as MarketplaceConfig,
    ),
  ]);

  expect(manifest.name).toBe("lorelum");
  expect(manifest.version).toBe("0.1.0-alpha.5");
  expect(manifest.homepage).toBe("https://lorelum.com");
  expect(manifest.interface).toEqual(
    expect.objectContaining({
      displayName: "Lorelum",
      websiteURL: "https://lorelum.com",
      brandColor: "#35B88F",
      composerIcon: "./assets/lorelum-icon.svg",
      logo: "./assets/lorelum-icon.svg",
    }),
  );
  await Promise.all(
    [manifest.interface.composerIcon, manifest.interface.logo].map((assetPath) =>
      readFile(join(import.meta.dir, "..", assetPath), "utf8"),
    ),
  );
  expect(marketplace.name).toBe("lorelum-plugins");
  expect(marketplace.plugins).toEqual([
    {
      name: "lorelum",
      source: { source: "local", path: "./plugins/codex/lorelum" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    },
  ]);
  expect(`${manifest.name}@${marketplace.name}`).toBe("lorelum@lorelum-plugins");
});
