import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { BuildInfo, BuildProvenance } from "../protocol/build-provenance";
import { currentBuildIdentity, isCompiledEntrypoint } from "./build-identity";

declare const LORELUM_BUILD_PROVENANCE: BuildProvenance;

/** Build metadata embedded by the release compiler; source runs collect Git at the entrypoint's checkout. */
export async function currentBuildInfo(
  entrypoint: string,
  toolVersion: string,
): Promise<BuildInfo> {
  if (isCompiledEntrypoint(entrypoint)) {
    const buildIdentity = await currentBuildIdentity(entrypoint);
    return Object.freeze({ ...LORELUM_BUILD_PROVENANCE, buildIdentity });
  }
  const [buildIdentity, provenance] = await Promise.all([
    currentBuildIdentity(entrypoint),
    sourceBuildProvenance(entrypoint, toolVersion),
  ]);
  return Object.freeze({ ...provenance, buildIdentity });
}

/** Read revision and worktree state without exposing checkout-specific details. */
export async function readBuildProvenance(
  checkoutRoot: string,
  toolVersion: string,
  buildKind: BuildProvenance["buildKind"],
): Promise<BuildProvenance> {
  const [revision, dirty] = await Promise.all([
    gitOutput(checkoutRoot, ["rev-parse", "--verify", "HEAD"]).then((value) =>
      value === null || value.trim().length === 0 ? null : value.trim(),
    ),
    gitOutput(checkoutRoot, ["status", "--porcelain", "--untracked-files=normal"]).then((value) =>
      value === null ? null : value.length > 0,
    ),
  ]);
  return Object.freeze({ toolVersion, revision, dirty, buildKind });
}

async function sourceBuildProvenance(
  entrypoint: string,
  toolVersion: string,
): Promise<BuildProvenance> {
  const checkoutRoot = await realpath(resolve(dirname(entrypoint), "../../.."));
  return readBuildProvenance(checkoutRoot, toolVersion, "source");
}

async function gitOutput(checkoutRoot: string, args: readonly string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(["git", "-C", checkoutRoot, ...args], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return exitCode === 0 ? stdout : null;
  } catch {
    return null;
  }
}
