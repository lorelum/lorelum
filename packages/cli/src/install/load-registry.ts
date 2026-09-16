import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseYaml, RegistrySchema, type Registry } from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { runGit, type MaterializeGitRunner } from "./materialize-source.js";

const OFFICIAL_REGISTRY_REPOSITORY = "lorelum/lorelum-packs";
const MAX_REGISTRY_BYTES = 256 * 1024;
const SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const SSH_SCP_PATTERN = /^git@github\.com:([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/i;
const SSH_PATH_PATTERN = /^\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/;
const RAW_UNAVAILABLE_MESSAGE = "The Pack Registry is unavailable.";
const GIT_UNAVAILABLE_MESSAGE =
  "The Pack Registry is unavailable. Verify your SSH access to the repository " +
  "(e.g. `ssh -T git@github.com`), then retry.";

export type RegistryTransport = "raw" | "git";

export interface RegistryRepository {
  readonly slug: string;
  /** Clone URL handed to the materialization transport. */
  readonly gitUrl: string;
  /** Anonymous descriptor URL; only read by the "raw" transport. */
  readonly descriptorUrl: string;
  readonly transport: RegistryTransport;
}

export interface LoadedRegistry {
  readonly registry: Registry;
  readonly repository: RegistryRepository;
}

function invalidRegistry(message = "The Pack Registry is invalid."): CliError {
  return new CliError(cliErrorCodes.registryInvalid, message);
}

function unavailable(message: string): CliError {
  return new CliError(cliErrorCodes.registryUnavailable, message);
}

function slugFromSshPath(pathname: string): string {
  const match = SSH_PATH_PATTERN.exec(pathname);
  if (match === null) {
    throw invalidRegistry("The Registry repository is not a valid GitHub repository.");
  }
  return `${match[1]}/${match[2]}`;
}

function gitRegistryRepository(locator: string, slug: string): RegistryRepository {
  if (!SLUG_PATTERN.test(slug)) {
    throw invalidRegistry("The Registry repository must be a GitHub owner/repository name.");
  }
  return Object.freeze({
    slug,
    gitUrl: locator,
    descriptorUrl: `https://raw.githubusercontent.com/${slug}/HEAD/.lorelum/registry.yaml`,
    transport: "git",
  });
}

/**
 * Resolve the official default or one explicit GitHub Registry repository.
 * Slug and HTTPS locators keep the anonymous raw transport; SSH locators
 * (github.com only) select the user-authenticated git transport.
 */
export function resolveRegistryRepository(locator?: string): RegistryRepository {
  const candidate = locator ?? OFFICIAL_REGISTRY_REPOSITORY;
  if (candidate.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw invalidRegistry("The Registry repository is not a valid GitHub repository.");
    }
    if (
      url.hostname !== "github.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw invalidRegistry("The Registry repository is not a valid GitHub repository.");
    }
    const slug = url.pathname
      .replace(/^\//, "")
      .replace(/\.git\/?$/, "")
      .replace(/\/$/, "");
    if (!SLUG_PATTERN.test(slug)) {
      throw invalidRegistry("The Registry repository must be a GitHub owner/repository name.");
    }
    return Object.freeze({
      slug,
      gitUrl: `https://github.com/${slug}.git`,
      descriptorUrl: `https://raw.githubusercontent.com/${slug}/HEAD/.lorelum/registry.yaml`,
      transport: "raw",
    });
  }
  if (candidate.toLowerCase().startsWith("git@github.com:")) {
    const match = SSH_SCP_PATTERN.exec(candidate);
    if (match === null) {
      throw invalidRegistry("The Registry repository is not a valid GitHub repository.");
    }
    return gitRegistryRepository(candidate, `${match[1]}/${match[2]}`);
  }
  if (candidate.startsWith("ssh://")) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw invalidRegistry("The Registry repository is not a valid GitHub repository.");
    }
    if (
      url.protocol !== "ssh:" ||
      url.hostname !== "github.com" ||
      url.username !== "git" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw invalidRegistry("The Registry repository is not a valid GitHub repository.");
    }
    // Derive the clone URL from the normalized href so the reported slug and
    // the repository git actually clones can never diverge (dot segments).
    return gitRegistryRepository(url.href, slugFromSshPath(url.pathname));
  }
  if (!SLUG_PATTERN.test(candidate)) {
    throw invalidRegistry("The Registry repository must be a GitHub owner/repository name.");
  }
  return Object.freeze({
    slug: candidate,
    gitUrl: `https://github.com/${candidate}.git`,
    descriptorUrl: `https://raw.githubusercontent.com/${candidate}/HEAD/.lorelum/registry.yaml`,
    transport: "raw",
  });
}

async function fetchRawDescriptor(
  descriptorUrl: string,
  fetchRegistry: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchRegistry(descriptorUrl, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw unavailable(RAW_UNAVAILABLE_MESSAGE);
  }
  if (!response.ok) throw unavailable(RAW_UNAVAILABLE_MESSAGE);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REGISTRY_BYTES) {
    throw invalidRegistry();
  }
  return response.text();
}

async function readGitDescriptor(
  gitUrl: string,
  git: MaterializeGitRunner,
): Promise<string> {
  let temporaryRoot: string;
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), "lorelum-registry-"));
  } catch {
    throw unavailable(GIT_UNAVAILABLE_MESSAGE);
  }
  try {
    const repositoryRoot = join(temporaryRoot, "repository");
    await git([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      "--no-checkout",
      "--",
      gitUrl,
      repositoryRoot,
    ]);
    const output = await git(["-C", repositoryRoot, "show", "HEAD:.lorelum/registry.yaml"], {
      outputLimit: MAX_REGISTRY_BYTES,
    });
    return new TextDecoder().decode(output);
  } catch (error) {
    if (error instanceof CliError && error.code === cliErrorCodes.sourceInvalid) {
      throw invalidRegistry();
    }
    throw unavailable(GIT_UNAVAILABLE_MESSAGE);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
  }
}

/** Load and validate a Registry descriptor from its repository. */
export async function loadRegistry(
  locator?: string,
  fetchRegistry: typeof fetch = fetch,
  git: MaterializeGitRunner = runGit,
): Promise<LoadedRegistry> {
  const repository = resolveRegistryRepository(locator);
  const raw =
    repository.transport === "git"
      ? await readGitDescriptor(repository.gitUrl, git)
      : await fetchRawDescriptor(repository.descriptorUrl, fetchRegistry);
  if (new TextEncoder().encode(raw).byteLength > MAX_REGISTRY_BYTES) throw invalidRegistry();
  try {
    return Object.freeze({ registry: RegistrySchema.parse(parseYaml(raw)), repository });
  } catch {
    throw invalidRegistry();
  }
}
