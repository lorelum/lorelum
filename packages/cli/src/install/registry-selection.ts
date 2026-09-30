import {
  readRegistryCatalog,
  RegistryCatalogBusyError,
  RegistryCatalogError,
  type RegistryCatalog,
  type RegistryCatalogSource,
} from "@lorelum/config";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { resolveRegistryRepository } from "./load-registry.js";

const ALIAS_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export type RegistrySelection =
  | Readonly<{ kind: "remote"; alias?: string; locator?: string }>
  | Readonly<{ kind: "local"; alias: string; worktree: string }>;

export type RegistryCatalogReader = () => Promise<RegistryCatalog>;

function catalogError(error: unknown): never {
  if (error instanceof RegistryCatalogBusyError) {
    throw new CliError(cliErrorCodes.registryCatalogBusy, "The Registry source catalog is busy.");
  }
  if (error instanceof RegistryCatalogError) {
    throw new CliError(
      cliErrorCodes.registryCatalogInvalid,
      "The Registry source catalog is invalid or unreadable.",
    );
  }
  throw error;
}

async function catalog(reader: RegistryCatalogReader): Promise<RegistryCatalog> {
  try {
    return await reader();
  } catch (error) {
    return catalogError(error);
  }
}

function fromSavedSource(alias: string, source: RegistryCatalogSource): RegistrySelection {
  if (source.kind === "remote-git")
    return Object.freeze({ kind: "remote", alias, locator: source.locator });
  return Object.freeze({ kind: "local", alias, worktree: source.worktree });
}

/** Select exactly one source without probing or falling back to another Registry. */
export async function selectRegistry(
  selector: string | undefined,
  reader: RegistryCatalogReader = readRegistryCatalog,
): Promise<RegistrySelection> {
  if (selector === undefined) {
    const stored = await catalog(reader);
    if (stored.defaultAlias === undefined)
      return Object.freeze({ kind: "remote", alias: "official" });
    const source = stored.registries[stored.defaultAlias];
    if (source === undefined) {
      throw new CliError(
        cliErrorCodes.registryCatalogInvalid,
        "The Registry source catalog is invalid or unreadable.",
      );
    }
    return fromSavedSource(stored.defaultAlias, source);
  }

  if (selector === "official") return Object.freeze({ kind: "remote", alias: "official" });
  if (ALIAS_PATTERN.test(selector)) {
    const stored = await catalog(reader);
    const source = stored.registries[selector];
    if (source === undefined) {
      throw new CliError(
        cliErrorCodes.registryAliasNotFound,
        "The Registry alias is not configured.",
      );
    }
    return fromSavedSource(selector, source);
  }

  // Validate without changing the user-provided transient spelling. A direct
  // locator is intentionally never persisted or made the default.
  resolveRegistryRepository(selector);
  return Object.freeze({ kind: "remote", locator: selector });
}
