import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { guidanceProfiles, type GuidanceProfiles } from "./profiles.ts";
import { renderGuidance, type GuidanceSources } from "./render.ts";

export type GuidanceMode = "check" | "write";

export interface GuidanceFileSystem {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  listDirectories(path: string): Promise<readonly string[]>;
  isDirectory(path: string): Promise<boolean>;
  ensureDirectory(path: string): Promise<void>;
}

export interface SynchronizeGuidanceOptions {
  readonly repositoryRoot: string;
  readonly mode: GuidanceMode;
  readonly fileSystem?: GuidanceFileSystem;
  readonly profiles?: GuidanceProfiles;
}

const skillTemplatePath = "scripts/skill-guidance/content/skill.md.tmpl";
const recoverySourcePath = "scripts/skill-guidance/content/recovery.md";
const skillFilePath = "SKILL.md";
const recoveryFilePath = "references/semantic-query-recovery.md";

export function createNodeFileSystem(repositoryRoot: string): GuidanceFileSystem {
  const root = resolve(repositoryRoot);
  const fullPath = (path: string): string => resolve(root, path);

  return {
    async readTextFile(path) {
      return readFile(fullPath(path), "utf8");
    },
    async writeTextFile(path, content) {
      await writeFile(fullPath(path), content, "utf8");
    },
    async listDirectories(path) {
      const entries = await readdir(fullPath(path), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    },
    async isDirectory(path) {
      try {
        return (await stat(fullPath(path))).isDirectory();
      } catch (error) {
        if (isMissingPath(error)) return false;
        throw error;
      }
    },
    async ensureDirectory(path) {
      await mkdir(fullPath(path), { recursive: true });
    },
  };
}

export async function assertGuidanceTargetCoverage(
  fileSystem: GuidanceFileSystem,
  profiles: GuidanceProfiles = guidanceProfiles,
): Promise<void> {
  const profileTargets = Object.keys(profiles).sort();
  if (!profileTargets.includes("generic")) {
    throw new Error("Skill guidance profiles must include the generic target.");
  }

  const pluginDirectories = await fileSystem.listDirectories("plugins");
  const artifactHosts = (
    await Promise.all(
      pluginDirectories.map(async (plugin) =>
        (await fileSystem.isDirectory(join("plugins", plugin, "lorelum"))) ? plugin : undefined,
      ),
    )
  )
    .filter((plugin): plugin is string => plugin !== undefined)
    .sort();

  const missingProfiles = artifactHosts.filter((host) => !profileTargets.includes(host));
  const orphanProfiles = profileTargets.filter(
    (target) => target !== "generic" && !artifactHosts.includes(target),
  );
  if (missingProfiles.length > 0 || orphanProfiles.length > 0) {
    const problems = [
      ...missingProfiles.map((host) => `Plugin artifact has no Skill guidance profile: ${host}.`),
      ...orphanProfiles.map(
        (host) => `Skill guidance profile has no plugins/${host}/lorelum artifact.`,
      ),
    ];
    throw new Error(problems.join("\n"));
  }
}

export async function synchronizeGuidance({
  repositoryRoot,
  mode,
  fileSystem = createNodeFileSystem(repositoryRoot),
  profiles = guidanceProfiles,
}: SynchronizeGuidanceOptions): Promise<readonly string[]> {
  const sources: GuidanceSources = {
    skillTemplate: await fileSystem.readTextFile(skillTemplatePath),
    recovery: await fileSystem.readTextFile(recoverySourcePath),
  };
  await assertGuidanceTargetCoverage(fileSystem, profiles);

  const expected = new Map<string, string>();
  for (const [target, profile] of Object.entries(profiles).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const rendered = renderGuidance(sources, profile);
    const targetRoot =
      target === "generic"
        ? "skills/lorelum"
        : join("plugins", target, "lorelum", "skills", "lorelum");
    expected.set(join(targetRoot, skillFilePath), rendered.skill);
    expected.set(join(targetRoot, recoveryFilePath), rendered.recovery);
  }

  const paths = [...expected.keys()].sort();
  if (mode === "check") {
    const differences = await Promise.all(
      paths.map(async (path) => {
        try {
          return (await fileSystem.readTextFile(path)) === expected.get(path) ? undefined : path;
        } catch (error) {
          if (isMissingPath(error)) return path;
          throw error;
        }
      }),
    );
    return differences.filter((path): path is string => path !== undefined);
  }

  await Promise.all(
    [...expected]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([path, content]) => {
        await fileSystem.ensureDirectory(dirname(path));
        await fileSystem.writeTextFile(path, content);
      }),
  );
  return paths;
}

function isMissingPath(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  return code === "ENOENT" || code === "ENOTDIR";
}
