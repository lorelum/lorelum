import type { Registry, RegistryPack, RegistryRelease } from "@lorelum/format";

import { CliError, cliErrorCodes } from "../runtime/errors.js";

interface ResolvedRegistryRelease {
  readonly pack: RegistryPack;
  readonly release: RegistryRelease;
}

export function resolveRegistryRelease(
  registry: Registry,
  packName: string,
  requestedVersion?: string,
): ResolvedRegistryRelease {
  const pack = registry.packs.find((candidate) => candidate.name === packName);
  if (pack === undefined) {
    throw new CliError(
      cliErrorCodes.registryPackNotFound,
      `Pack "${packName}" is not present in the selected Registry.`,
    );
  }

  const release =
    requestedVersion === undefined
      ? [...pack.releases]
          .filter((candidate) => !candidate.version.split("+", 1)[0]!.includes("-"))
          .sort((left, right) => Bun.semver.order(right.version, left.version))[0]
      : pack.releases.find((candidate) => candidate.version === requestedVersion);
  if (release === undefined) {
    const message =
      requestedVersion === undefined
        ? `Pack "${packName}" has no stable release in the selected Registry.`
        : `Pack "${packName}" has no release for version "${requestedVersion}".`;
    throw new CliError(cliErrorCodes.registryVersionNotFound, message);
  }
  return { pack, release };
}
