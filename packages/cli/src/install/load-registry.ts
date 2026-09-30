import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseYaml, RegistrySchema, type Registry } from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { runGit, type MaterializeGitRunner } from "./materialize-source.js";

const OFFICIAL_REGISTRY_REPOSITORY = "lorelum/lorelum-packs";
const MAX_REGISTRY_BYTES = 256 * 1024;
const GITHUB_SLUG_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const SCP_PATTERN = /^(?:([A-Za-z0-9._-]+)@)?([A-Za-z0-9._-]+):(.+)$/u;
const RAW_UNAVAILABLE_MESSAGE = "The Pack Registry is unavailable.";
const LEGACY_GIT_UNAVAILABLE_MESSAGE =
  "The Pack Registry is unavailable. Verify your SSH access to the repository " +
  "(e.g. `ssh -T git@github.com`), then retry.";
const GENERIC_GIT_UNAVAILABLE_MESSAGE =
  "The Pack Registry is unavailable. Verify non-interactive Git access to the selected " +
  "repository, then retry.";

export type RegistryTransport = "raw" | "git";

export interface RegistryRepository {
  /** Legacy GitHub sources retain owner/repository; generic sources include their host. */
  readonly slug: string;
  /** Clone URL handed to the descriptor and release materialization transports. */
  readonly gitUrl: string;
  /** Anonymous descriptor URL; present only for the legacy GitHub raw transport. */
  readonly descriptorUrl?: string;
  readonly transport: RegistryTransport;
  readonly legacyGithub: boolean;
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

function legacyInvalid(): CliError {
  return invalidRegistry("The Registry repository is not a valid GitHub repository.");
}

function genericInvalid(): CliError {
  return invalidRegistry("The Registry repository is not a valid Git repository.");
}

function hasForbiddenCharacters(value: string): boolean {
  return /[\p{Cc}\s\\]/u.test(value);
}

function rawPathFromUrlLocator(value: string): string {
  const authorityStart = value.indexOf("://");
  if (authorityStart === -1) return "";
  const pathnameStart = value.indexOf("/", authorityStart + 3);
  if (pathnameStart === -1) return "";
  return value.slice(pathnameStart).split(/[?#]/u, 1)[0] ?? "";
}

function validateRepositoryPath(pathname: string, invalid: () => CliError): void {
  if (!pathname.startsWith("/")) throw invalid();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) throw invalid();
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalid();
    }
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      hasForbiddenCharacters(decoded)
    ) {
      throw invalid();
    }
  }
  if (pathname.toLowerCase().includes("/.lorelum/registry.yaml")) throw invalid();
}

function githubSlugFromPath(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return undefined;
  const repository = segments[1]!.replace(/\.git$/iu, "");
  const slug = `${segments[0]}/${repository}`;
  return GITHUB_SLUG_PATTERN.test(slug) ? slug : undefined;
}

function legacyRawRepository(slug: string): RegistryRepository {
  return Object.freeze({
    slug,
    gitUrl: `https://github.com/${slug}.git`,
    descriptorUrl: `https://raw.githubusercontent.com/${slug}/HEAD/.lorelum/registry.yaml`,
    transport: "raw",
    legacyGithub: true,
  });
}

function gitRepository(gitUrl: string, slug: string, legacyGithub = false): RegistryRepository {
  return Object.freeze({ slug, gitUrl, transport: "git", legacyGithub });
}

function resolveHttpsLocator(candidate: string): RegistryRepository {
  if (hasForbiddenCharacters(candidate)) throw genericInvalid();
  const rawPath = rawPathFromUrlLocator(candidate);
  validateRepositoryPath(rawPath, genericInvalid);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw genericInvalid();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw genericInvalid();
  }
  const slug =
    url.hostname.toLowerCase() === "github.com" && url.port === ""
      ? githubSlugFromPath(url.pathname)
      : undefined;
  if (slug !== undefined) return legacyRawRepository(slug);
  return gitRepository(url.href, url.href);
}

function resolveSshUrlLocator(candidate: string): RegistryRepository {
  if (hasForbiddenCharacters(candidate)) throw genericInvalid();
  const rawPath = rawPathFromUrlLocator(candidate);
  validateRepositoryPath(rawPath, genericInvalid);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw genericInvalid();
  }
  if (
    url.protocol !== "ssh:" ||
    url.hostname === "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.username !== "" && !/^[A-Za-z0-9._-]+$/u.test(url.username))
  ) {
    throw genericInvalid();
  }
  const slug =
    url.hostname.toLowerCase() === "github.com" && url.port === "" && url.username === "git"
      ? githubSlugFromPath(url.pathname)
      : undefined;
  return gitRepository(url.href, slug ?? url.href, slug !== undefined);
}

function resolveScpLocator(candidate: string): RegistryRepository {
  if (hasForbiddenCharacters(candidate)) throw genericInvalid();
  const match = SCP_PATTERN.exec(candidate);
  if (match === null) throw genericInvalid();
  const [, user, host, rawPath] = match;
  if (host === undefined || rawPath === undefined || rawPath.startsWith("/"))
    throw genericInvalid();
  validateRepositoryPath(`/${rawPath}`, genericInvalid);
  const pathWithoutSuffix = rawPath.replace(/\.git$/iu, "");
  const legacySlug =
    host.toLowerCase() === "github.com" &&
    user === "git" &&
    GITHUB_SLUG_PATTERN.test(pathWithoutSuffix)
      ? pathWithoutSuffix
      : undefined;
  return gitRepository(candidate, legacySlug ?? candidate, legacySlug !== undefined);
}

/**
 * Resolve the official default or one explicit Git Registry repository.
 * GitHub shorthand and canonical GitHub HTTPS retain anonymous raw reads;
 * every other accepted HTTPS or SSH endpoint uses the constrained Git path.
 */
export function resolveRegistryRepository(locator?: string): RegistryRepository {
  const candidate = locator ?? OFFICIAL_REGISTRY_REPOSITORY;
  if (candidate === "") throw genericInvalid();
  if (GITHUB_SLUG_PATTERN.test(candidate)) return legacyRawRepository(candidate);
  if (candidate.startsWith("https://")) return resolveHttpsLocator(candidate);
  if (candidate.startsWith("ssh://")) return resolveSshUrlLocator(candidate);
  if (candidate.includes(":")) return resolveScpLocator(candidate);
  throw legacyInvalid();
}

async function fetchRawDescriptor(
  descriptorUrl: string,
  fetchRegistry: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchRegistry(descriptorUrl, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw unavailable(RAW_UNAVAILABLE_MESSAGE);
  }
  if (!response.ok) throw unavailable(RAW_UNAVAILABLE_MESSAGE);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REGISTRY_BYTES) throw invalidRegistry();
  return response.text();
}

function gitUnavailableMessage(repository: RegistryRepository): string {
  return repository.legacyGithub ? LEGACY_GIT_UNAVAILABLE_MESSAGE : GENERIC_GIT_UNAVAILABLE_MESSAGE;
}

async function readGitDescriptor(
  repository: RegistryRepository,
  git: MaterializeGitRunner,
): Promise<string> {
  let temporaryRoot: string;
  const unavailableMessage = gitUnavailableMessage(repository);
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), "lorelum-registry-"));
  } catch {
    throw unavailable(unavailableMessage);
  }
  try {
    const repositoryRoot = join(temporaryRoot, "repository");
    // A filter is a bounded-transfer request rather than a promise that every
    // server honours it. The descriptor output itself remains hard-limited.
    await git([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      "--filter=tree:0",
      "--no-checkout",
      "--",
      repository.gitUrl,
      repositoryRoot,
    ]);
    const output = await git(["-C", repositoryRoot, "show", "HEAD:.lorelum/registry.yaml"], {
      outputLimit: MAX_REGISTRY_BYTES,
    });
    return new TextDecoder().decode(output);
  } catch (error) {
    if (error instanceof CliError && error.code === cliErrorCodes.sourceInvalid)
      throw invalidRegistry();
    throw unavailable(unavailableMessage);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => undefined);
  }
}

/** Decode the bounded descriptor payload shared by remote and local sources. */
export function decodeRegistryDescriptor(raw: string): Registry {
  if (new TextEncoder().encode(raw).byteLength > MAX_REGISTRY_BYTES) throw invalidRegistry();
  try {
    return RegistrySchema.parse(parseYaml(raw));
  } catch {
    throw invalidRegistry();
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
      ? await readGitDescriptor(repository, git)
      : await fetchRawDescriptor(repository.descriptorUrl!, fetchRegistry);
  return Object.freeze({ registry: decodeRegistryDescriptor(raw), repository });
}
