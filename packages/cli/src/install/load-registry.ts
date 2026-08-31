import { parseYaml, RegistrySchema, type Registry } from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";

const OFFICIAL_REGISTRY_REPOSITORY = "lorelum/lorelum-packs";
const MAX_REGISTRY_BYTES = 256 * 1024;

export interface RegistryRepository {
  readonly slug: string;
  readonly gitUrl: string;
  readonly descriptorUrl: string;
}

export interface LoadedRegistry {
  readonly registry: Registry;
  readonly repository: RegistryRepository;
}

function invalidRegistry(message = "The Pack Registry is invalid."): CliError {
  return new CliError(cliErrorCodes.registryInvalid, message);
}

/** Resolve the official default or one explicit public GitHub Registry repository. */
export function resolveRegistryRepository(locator?: string): RegistryRepository {
  let slug = locator ?? OFFICIAL_REGISTRY_REPOSITORY;
  if (slug.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(slug);
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
    slug = url.pathname
      .replace(/^\//, "")
      .replace(/\.git\/?$/, "")
      .replace(/\/$/, "");
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(slug)) {
    throw invalidRegistry("The Registry repository must be a GitHub owner/repository name.");
  }
  return Object.freeze({
    slug,
    gitUrl: `https://github.com/${slug}.git`,
    descriptorUrl: `https://raw.githubusercontent.com/${slug}/HEAD/.lorelum/registry.yaml`,
  });
}

/** Load and validate a Registry descriptor from its repository. */
export async function loadRegistry(
  locator?: string,
  fetchRegistry: typeof fetch = fetch,
): Promise<LoadedRegistry> {
  const repository = resolveRegistryRepository(locator);
  let response: Response;
  try {
    response = await fetchRegistry(repository.descriptorUrl, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CliError(cliErrorCodes.registryUnavailable, "The Pack Registry is unavailable.");
  }
  if (!response.ok) {
    throw new CliError(cliErrorCodes.registryUnavailable, "The Pack Registry is unavailable.");
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REGISTRY_BYTES) {
    throw invalidRegistry();
  }
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REGISTRY_BYTES) throw invalidRegistry();
  try {
    return Object.freeze({ registry: RegistrySchema.parse(parseYaml(raw)), repository });
  } catch {
    throw invalidRegistry();
  }
}
