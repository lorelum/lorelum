import { expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

interface PiManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly pi: {
    readonly extensions: readonly string[];
    readonly skills: readonly string[];
  };
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly mcpServers?: unknown;
}

async function readManifest(): Promise<PiManifest> {
  const content = await readFile(join(import.meta.dir, "../package.json"), "utf8");
  return JSON.parse(content) as PiManifest;
}

test("declares the lorelum product identity with exactly one Extension and Skill entry", async () => {
  const manifest = await readManifest();

  expect(manifest.name).toBe("lorelum");
  expect(manifest.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
  expect(manifest.version).toBe("0.1.0-alpha.5");
  expect(manifest.description).toContain("Pi");
  expect(manifest.license).toBe("Apache-2.0");
  expect(manifest.pi.extensions).toEqual(["./extensions/lorelum.ts"]);
  expect(manifest.pi.skills).toEqual(["./skills/lorelum"]);
  expect(manifest.mcpServers).toBeUndefined();
});

test("keeps the host package a type-only peer and adds no runtime dependencies", async () => {
  const manifest = await readManifest();

  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.peerDependencies).toEqual({ "@earendil-works/pi-coding-agent": "*" });
});

test("names the Extension entry so helper modules and tests cannot be auto-discovered", async () => {
  const manifest = await readManifest();
  const directory = join(import.meta.dir, "../extensions");
  const entries = await readdir(directory);

  expect(entries).toContain("lorelum.ts");
  expect(entries).toContain("cli-catalog.ts");
  expect(entries.some((entry) => entry.endsWith(".test.ts"))).toBe(true);
  expect(manifest.pi.extensions).not.toContain("./extensions/cli-catalog.ts");
  expect(manifest.pi.extensions.every((entry) => !entry.endsWith(".test.ts"))).toBe(true);
  const entrypoint = await stat(join(directory, "lorelum.ts"));
  expect(entrypoint.isFile()).toBe(true);
});

test("ships the lorelum Skill with its recovery reference", async () => {
  const skill = await readFile(join(import.meta.dir, "../skills/lorelum/SKILL.md"), "utf8");
  expect(skill).toContain("name: lorelum");
  expect(skill).toContain("/skill:lorelum");
  const reference = await stat(
    join(import.meta.dir, "../skills/lorelum/references/semantic-query-recovery.md"),
  );
  expect(reference.isFile()).toBe(true);
});

test("extends the shared base typecheck configuration", async () => {
  const config = JSON.parse(await readFile(join(import.meta.dir, "../tsconfig.json"), "utf8")) as {
    extends?: string;
    include?: readonly string[];
  };
  expect(config.extends).toBe("../../../tsconfig.base.json");
  expect(config.include).toEqual(["extensions", "scripts", "test"]);
});
