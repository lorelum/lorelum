import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { MaterializeGitRunner } from "./materialize-source.js";
import { runGit } from "./materialize-source.js";

export interface DescriptorRepositoryFixture {
  /** Absolute path of the fixture working repository. */
  readonly path: string;
  /** file:// URL of the fixture repository, cloneable without any network. */
  readonly fileUrl: string;
}

interface FixtureGitOptions {
  readonly input?: Uint8Array;
}

/**
 * Spawn the real git binary against local fixture repositories. The
 * environment mirrors the production sandbox (no user config, no prompts)
 * plus a temporary HOME, so fixtures never touch the developer's machine
 * state and no network or real SSH is involved.
 */
export async function runFixtureGit(
  directory: string,
  arguments_: readonly string[],
  options: FixtureGitOptions = {},
): Promise<string> {
  const subprocess = Bun.spawn(["git", ...arguments_], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: directory,
      USERPROFILE: directory,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TMPDIR: process.env.TMPDIR,
      GIT_CONFIG_GLOBAL: "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    ...(options.input === undefined ? {} : { stdin: options.input }),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${arguments_[0] ?? "command"} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

/** Create a one-commit local repository that carries a Registry descriptor. */
export async function createDescriptorRepository(
  descriptor?: string,
): Promise<DescriptorRepositoryFixture> {
  const root = await mkdtemp(join(tmpdir(), "lorelum-registry-fixture-"));
  const path = join(root, "repository");
  await mkdir(join(path, ".lorelum"), { recursive: true });
  await writeFile(
    join(path, ".lorelum", descriptor === undefined ? ".gitkeep" : "registry.yaml"),
    descriptor ?? "",
  );
  await runFixtureGit(path, ["init", "-b", "main"]);
  await runFixtureGit(path, ["add", "."]);
  await runFixtureGit(path, [
    "-c",
    "user.name=Lorelum Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "fixture descriptor",
  ]);
  return { path, fileUrl: pathToFileURL(path).href };
}

export async function removeDescriptorRepository(
  fixture: DescriptorRepositoryFixture,
): Promise<void> {
  await rm(fixture.path, { force: true, recursive: true });
}

/**
 * Production git runner with fixture indirection: exact repository URL
 * arguments (e.g. an SSH locator) are swapped for local fixture URLs, so the
 * full production clone/show path runs against local repositories only.
 */
export function gitRunnerMappingLocators(
  locators: Readonly<Record<string, string>>,
  base: MaterializeGitRunner = runGit,
): MaterializeGitRunner {
  return (arguments_, options) =>
    base(
      arguments_.map((argument) => locators[argument] ?? argument),
      options,
    );
}
