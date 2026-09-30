import { lstat, realpath } from "node:fs/promises";

import type { Registry } from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { decodeRegistryDescriptor } from "./load-registry.js";
import { runLocalGit, type MaterializeGitRunner } from "./materialize-source.js";

const MAX_REGISTRY_BYTES = 256 * 1024;

export interface LocalRegistryRepository {
  readonly worktree: string;
}

export interface LoadedLocalRegistry {
  readonly registry: Registry;
  readonly repository: LocalRegistryRepository;
}

function unavailable(): CliError {
  return new CliError(cliErrorCodes.registryUnavailable, "The local Pack Registry is unavailable.");
}

async function canonicalWorktree(directory: string, git: MaterializeGitRunner): Promise<string> {
  let candidate: string;
  try {
    candidate = await realpath(directory);
    const info = await lstat(candidate);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("not a directory");
  } catch {
    throw unavailable();
  }
  let output: Uint8Array;
  try {
    output = await git(["-C", candidate, "rev-parse", "--show-toplevel"], {
      outputLimit: 16 * 1024,
    });
  } catch {
    throw unavailable();
  }
  const reported = new TextDecoder().decode(output).trim();
  if (reported === "") throw unavailable();
  try {
    return await realpath(reported);
  } catch {
    throw unavailable();
  }
}

/** Read a Registry descriptor from a local Git worktree without network fallback. */
export async function loadLocalRegistry(
  directory: string,
  git: MaterializeGitRunner = runLocalGit,
): Promise<LoadedLocalRegistry> {
  const worktree = await canonicalWorktree(directory, git);
  let descriptor: Uint8Array;
  try {
    descriptor = await git(["-C", worktree, "show", "HEAD:.lorelum/registry.yaml"], {
      outputLimit: MAX_REGISTRY_BYTES,
    });
  } catch (error) {
    if (error instanceof CliError && error.code === cliErrorCodes.sourceInvalid) {
      throw new CliError(cliErrorCodes.registryInvalid, "The Pack Registry is invalid.");
    }
    throw unavailable();
  }
  return Object.freeze({
    registry: decodeRegistryDescriptor(new TextDecoder().decode(descriptor)),
    repository: Object.freeze({ worktree }),
  });
}
