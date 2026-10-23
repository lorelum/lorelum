import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const productId = "lorelum";

interface NativeManifest {
  readonly name: string;
  readonly version: string;
}

interface CodexMarketplace {
  readonly name: string;
  readonly plugins: readonly {
    readonly name: string;
    readonly source: { readonly path: string };
  }[];
}

interface ZCodeMarketplace {
  readonly name: string;
  readonly plugins: readonly {
    readonly name: string;
    readonly source: string;
    readonly version?: string;
  }[];
}

interface CursorMarketplace {
  readonly name: string;
  readonly plugins: readonly {
    readonly name: string;
    readonly source: string;
    readonly version?: string;
  }[];
}

interface WorkbuddyMarketplace {
  readonly name: string;
  readonly plugins: readonly {
    readonly name: string;
    readonly source: string;
    readonly version?: string;
  }[];
}

interface ClaudeMarketplace {
  readonly name: string;
  readonly plugins: readonly {
    readonly name: string;
    readonly source: string;
    readonly version?: string;
  }[];
}

interface OmpMarketplace {
  readonly name: string;
  readonly owner: { readonly name: string };
  readonly plugins: readonly {
    readonly name: string;
    readonly source: string;
    readonly version: string;
  }[];
}

interface OmpPackage {
  readonly name: string;
  readonly version: string;
  readonly files: readonly string[];
  readonly omp: { readonly extensions: readonly string[] };
}

function assertHostPluginIdentity(input: {
  readonly hostKey: string;
  readonly manifestName: string;
  readonly source: string;
}): void {
  if (!/^[a-z][a-z0-9-]*$/.test(input.hostKey)) {
    throw new Error(`Invalid host key: ${input.hostKey}`);
  }
  if (input.manifestName !== productId) {
    throw new Error(`Plugin ID must remain ${productId}.`);
  }
  const expectedSource = `./plugins/${input.hostKey}/${productId}`;
  if (input.source !== expectedSource) {
    throw new Error(`Expected ${expectedSource}, received ${input.source}.`);
  }
}

function assertMarketplaceVersion(
  marketplaceVersion: string | undefined,
  manifestVersion: string,
): void {
  if (marketplaceVersion === undefined || marketplaceVersion !== manifestVersion) {
    throw new Error("Marketplace entry version must match the Plugin manifest version.");
  }
}

test("host adapters use a stable product ID and host-specific source roots", async () => {
  const root = join(import.meta.dir, "../..");
  const [
    codexManifest,
    zcodeManifest,
    cursorManifest,
    workbuddyManifest,
    claudeManifest,
    codexMarketplace,
    zcodeMarketplace,
    cursorMarketplace,
    workbuddyMarketplace,
    claudeMarketplace,
  ] = await Promise.all([
    readFile(join(root, "plugins/codex/lorelum/.codex-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as NativeManifest,
    ),
    readFile(join(root, "plugins/zcode/lorelum/.zcode-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as NativeManifest,
    ),
    readFile(join(root, "plugins/cursor/lorelum/.cursor-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as NativeManifest,
    ),
    readFile(join(root, "plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as NativeManifest,
    ),
    readFile(join(root, "plugins/claude/lorelum/.claude-plugin/plugin.json"), "utf8").then(
      (content) => JSON.parse(content) as NativeManifest,
    ),
    readFile(join(root, ".agents/plugins/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as CodexMarketplace,
    ),
    readFile(join(root, "marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as ZCodeMarketplace,
    ),
    readFile(join(root, ".cursor-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as CursorMarketplace,
    ),
    readFile(join(root, ".codebuddy-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as WorkbuddyMarketplace,
    ),
    readFile(join(root, ".claude-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as ClaudeMarketplace,
    ),
  ]);

  expect(codexMarketplace.name).toBe("lorelum-plugins");
  expect(workbuddyMarketplace.name).toBe("lorelum-plugins");
  expect(zcodeMarketplace.name).toBe("lorelum-plugins");
  expect(cursorMarketplace.name).toBe("lorelum-plugins");
  expect(claudeMarketplace.name).toBe("lorelum-plugins");
  assertHostPluginIdentity({
    hostKey: "codex",
    manifestName: codexManifest.name,
    source: codexMarketplace.plugins[0]?.source.path ?? "",
  });
  assertHostPluginIdentity({
    hostKey: "workbuddy",
    manifestName: workbuddyManifest.name,
    source: workbuddyMarketplace.plugins[0]?.source ?? "",
  });
  assertHostPluginIdentity({
    hostKey: "zcode",
    manifestName: zcodeManifest.name,
    source: zcodeMarketplace.plugins[0]?.source ?? "",
  });
  assertHostPluginIdentity({
    hostKey: "cursor",
    manifestName: cursorManifest.name,
    source: cursorMarketplace.plugins[0]?.source ?? "",
  });
  assertHostPluginIdentity({
    hostKey: "claude",
    manifestName: claudeManifest.name,
    source: claudeMarketplace.plugins[0]?.source ?? "",
  });
  assertMarketplaceVersion(zcodeMarketplace.plugins[0]?.version, zcodeManifest.version);
  assertMarketplaceVersion(cursorMarketplace.plugins[0]?.version, cursorManifest.version);
  assertMarketplaceVersion(workbuddyMarketplace.plugins[0]?.version, workbuddyManifest.version);
  assertMarketplaceVersion(claudeMarketplace.plugins[0]?.version, claudeManifest.version);
});

test("each host registration declares only its own host artifact", async () => {
  const root = join(import.meta.dir, "../..");
  const [
    codexMarketplace,
    zcodeMarketplace,
    cursorMarketplace,
    workbuddyMarketplace,
    claudeMarketplace,
    ompMarketplace,
  ] = await Promise.all([
    readFile(join(root, ".agents/plugins/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as CodexMarketplace,
    ),
    readFile(join(root, "marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as ZCodeMarketplace,
    ),
    readFile(join(root, ".cursor-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as CursorMarketplace,
    ),
    readFile(join(root, ".codebuddy-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as WorkbuddyMarketplace,
    ),
    readFile(join(root, ".claude-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as ClaudeMarketplace,
    ),
    readFile(join(root, ".omp-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as OmpMarketplace,
    ),
  ]);

  const declaredSources = [
    ...codexMarketplace.plugins.map((plugin) => plugin.source.path),
    ...zcodeMarketplace.plugins.map((plugin) => plugin.source),
    ...cursorMarketplace.plugins.map((plugin) => plugin.source),
    ...workbuddyMarketplace.plugins.map((plugin) => plugin.source),
    ...claudeMarketplace.plugins.map((plugin) => plugin.source),
    ...ompMarketplace.plugins.map((plugin) => plugin.source),
  ];

  expect(codexMarketplace.plugins.map((plugin) => plugin.source.path)).toEqual([
    "./plugins/codex/lorelum",
  ]);
  expect(zcodeMarketplace.plugins.map((plugin) => plugin.source)).toEqual([
    "./plugins/zcode/lorelum",
  ]);
  expect(cursorMarketplace.plugins.map((plugin) => plugin.source)).toEqual([
    "./plugins/cursor/lorelum",
  ]);
  expect(workbuddyMarketplace.plugins.map((plugin) => plugin.source)).toEqual([
    "./plugins/workbuddy/lorelum",
  ]);
  expect(claudeMarketplace.plugins.map((plugin) => plugin.source)).toEqual([
    "./plugins/claude/lorelum",
  ]);
  expect(ompMarketplace.plugins.map((plugin) => plugin.source)).toEqual(["./plugins/omp/lorelum"]);
  for (const source of declaredSources) {
    expect(source).toMatch(
      new RegExp(`^\\./plugins/(codex|zcode|cursor|workbuddy|claude|omp)/${productId}$`),
    );
  }
});

test("omp registration keeps its package identity, version and complete native Skill", async () => {
  const root = join(import.meta.dir, "../..");
  const [marketplace, manifest] = await Promise.all([
    readFile(join(root, ".omp-plugin/marketplace.json"), "utf8").then(
      (content) => JSON.parse(content) as OmpMarketplace,
    ),
    readFile(join(root, "plugins/omp/lorelum/package.json"), "utf8").then(
      (content) => JSON.parse(content) as OmpPackage,
    ),
  ]);
  expect(marketplace.name).toBe("lorelum-plugins");
  expect(marketplace.owner.name).toBe("Lorelum");
  expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual([productId]);
  assertHostPluginIdentity({
    hostKey: "omp",
    manifestName: manifest.name,
    source: marketplace.plugins[0]?.source ?? "",
  });
  assertMarketplaceVersion(marketplace.plugins[0]?.version, manifest.version);
  expect(manifest.files).toContain("skills");
  expect(manifest.omp.extensions).toEqual(["./extensions/catalog.ts"]);
  const installedFiles = await Promise.all(
    ["SKILL.md", "references/semantic-query-recovery.md"].map((path) =>
      Bun.file(join(root, "plugins/omp/lorelum/skills/lorelum", path)).exists(),
    ),
  );
  expect(installedFiles).toEqual([true, true]);
});

test("layout validation rejects public host suffixes, cross-host sources, and version drift", () => {
  expect(() =>
    assertHostPluginIdentity({
      hostKey: "zcode",
      manifestName: "lorelum-zcode",
      source: "./plugins/zcode/lorelum",
    }),
  ).toThrow("Plugin ID must remain lorelum.");
  expect(() =>
    assertHostPluginIdentity({
      hostKey: "zcode",
      manifestName: "lorelum",
      source: "./plugins/codex/lorelum",
    }),
  ).toThrow("Expected ./plugins/zcode/lorelum");
  expect(() => assertMarketplaceVersion(undefined, "0.1.0-alpha.2")).toThrow(
    "Marketplace entry version",
  );
  expect(() => assertMarketplaceVersion("0.1.0-alpha.1", "0.1.0-alpha.2")).toThrow(
    "Marketplace entry version",
  );
  expect(() =>
    assertHostPluginIdentity({
      hostKey: "workbuddy",
      manifestName: "lorelum",
      source: "./plugins/zcode/lorelum",
    }),
  ).toThrow("Expected ./plugins/workbuddy/lorelum");
});
