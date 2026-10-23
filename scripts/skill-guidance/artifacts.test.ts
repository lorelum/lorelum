import { expect, test } from "bun:test";
import { basename, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertGuidanceTargetCoverage,
  createNodeFileSystem,
  synchronizeGuidance,
  type GuidanceFileSystem,
} from "./artifacts.ts";
import { guidanceProfiles } from "./profiles.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourcePaths = [
  "scripts/skill-guidance/content/skill.md.tmpl",
  "scripts/skill-guidance/content/recovery.md",
];

class MemoryFileSystem implements GuidanceFileSystem {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  readonly writes: string[] = [];

  addDirectory(path: string): void {
    let current = normalizePath(path);
    while (current !== ".") {
      this.directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  addFile(path: string, content: string): void {
    const normalized = normalizePath(path);
    this.addDirectory(dirname(normalized));
    this.files.set(normalized, content);
  }

  async readTextFile(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const content = this.files.get(normalized);
    if (content !== undefined) return content;
    throw Object.assign(new Error(`Missing file: ${normalized}`), { code: "ENOENT" });
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    this.addDirectory(dirname(normalized));
    this.files.set(normalized, content);
    this.writes.push(normalized);
  }

  async listDirectories(path: string): Promise<readonly string[]> {
    const normalized = normalizePath(path);
    return [...this.directories]
      .filter((directory) => dirname(directory) === normalized)
      .map((directory) => basename(directory))
      .sort();
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.directories.has(normalizePath(path));
  }

  async ensureDirectory(path: string): Promise<void> {
    this.addDirectory(path);
  }
}

function normalizePath(path: string): string {
  return normalize(path).replaceAll("\\", "/");
}

function snapshot(fileSystem: MemoryFileSystem): string {
  return JSON.stringify({
    files: [...fileSystem.files.entries()].sort(([left], [right]) => left.localeCompare(right)),
    directories: [...fileSystem.directories].sort(),
  });
}

async function createFixture(): Promise<MemoryFileSystem> {
  const memory = new MemoryFileSystem();
  const real = createNodeFileSystem(repositoryRoot);
  memory.addDirectory("plugins");
  const sources = await Promise.all(
    sourcePaths.map(async (path) => [path, await real.readTextFile(path)] as const),
  );
  for (const [sourcePath, content] of sources) memory.addFile(sourcePath, content);

  const plugins = await real.listDirectories("plugins");
  const artifactRoots = await Promise.all(
    plugins.map(async (plugin) => {
      const artifactRoot = join("plugins", plugin, "lorelum");
      return (await real.isDirectory(artifactRoot)) ? artifactRoot : undefined;
    }),
  );
  for (const artifactRoot of artifactRoots) {
    if (artifactRoot !== undefined) memory.addDirectory(artifactRoot);
  }
  return memory;
}

function pathEnding(paths: readonly string[], suffix: string): string {
  const path = paths.find((candidate) => candidate.endsWith(suffix));
  if (!path) throw new Error(`Expected a generated path ending in ${suffix}.`);
  return path;
}

test("target coverage finds missing profiles and unadapted Plugin artifacts", async () => {
  const real = createNodeFileSystem(repositoryRoot);
  const profilesWithoutOmp = Object.fromEntries(
    Object.entries(guidanceProfiles).filter(([target]) => target !== "omp"),
  );
  await expect(assertGuidanceTargetCoverage(real, profilesWithoutOmp)).rejects.toThrow("omp");

  const fixture = await createFixture();
  fixture.addDirectory("plugins/future-host/lorelum");
  await expect(assertGuidanceTargetCoverage(fixture)).rejects.toThrow("future-host");
});

test("target coverage rejects an extra profile without a Plugin artifact", async () => {
  const fixture = await createFixture();
  const profilesWithOrphan = {
    ...guidanceProfiles,
    orphan: {
      description: "unused profile",
      catalog: "unused catalog",
      readHints: "",
    },
  };

  await expect(assertGuidanceTargetCoverage(fixture, profilesWithOrphan)).rejects.toThrow(
    "plugins/orphan/lorelum artifact",
  );
});

test("check is read-only and reports missing or manually edited artifacts", async () => {
  const fileSystem = await createFixture();
  const writtenPaths = await synchronizeGuidance({
    repositoryRoot,
    mode: "write",
    fileSystem,
  });
  expect(writtenPaths).toHaveLength(Object.keys(guidanceProfiles).length * 2);

  fileSystem.writes.length = 0;
  const beforeCheck = snapshot(fileSystem);
  expect(await synchronizeGuidance({ repositoryRoot, mode: "check", fileSystem })).toEqual([]);
  expect(snapshot(fileSystem)).toBe(beforeCheck);
  expect(fileSystem.writes).toEqual([]);

  const missingSkill = pathEnding(writtenPaths, "/SKILL.md");
  const missingReference = pathEnding(writtenPaths, "/references/semantic-query-recovery.md");
  fileSystem.files.delete(missingSkill);
  fileSystem.files.delete(missingReference);
  const missing = await synchronizeGuidance({ repositoryRoot, mode: "check", fileSystem });
  expect(missing).toContain(missingSkill);
  expect(missing).toContain(missingReference);

  fileSystem.files.set(missingSkill, "hand-edited\n");
  const stale = await synchronizeGuidance({ repositoryRoot, mode: "check", fileSystem });
  expect(stale).toContain(missingSkill);
});

test("write updates managed files without removing other Plugin resources", async () => {
  const fileSystem = await createFixture();
  const plugin = (await fileSystem.listDirectories("plugins"))[0];
  if (!plugin) throw new Error("Expected a Plugin artifact root.");
  const otherResource = join("plugins", plugin, "lorelum", "host-owned-resource.txt");
  fileSystem.addFile(otherResource, "keep this file\n");

  await synchronizeGuidance({ repositoryRoot, mode: "write", fileSystem });

  expect(fileSystem.files.get(otherResource)).toBe("keep this file\n");
  expect(await synchronizeGuidance({ repositoryRoot, mode: "check", fileSystem })).toEqual([]);
});

test("the current checkout has no generated-guidance drift", async () => {
  const differences = await synchronizeGuidance({
    repositoryRoot,
    mode: "check",
  });
  expect(differences).toEqual([]);
});
