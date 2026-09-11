import { readFile } from "node:fs/promises";
import { sep } from "node:path";

export interface ThirdPartyPackageNotice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
}

/** Derive the npm notices from the files that Bun actually bundled into the CLI. */
export async function collectBundledPackageNotices(
  bundledInputs: readonly string[],
): Promise<readonly ThirdPartyPackageNotice[]> {
  const manifests = new Set<string>();
  for (const input of bundledInputs) {
    const manifest = packageManifestForInput(input);
    if (manifest) manifests.add(manifest);
  }
  const notices = await Promise.all([...manifests].sort().map(readPackageNotice));
  const byIdentity = new Map<string, ThirdPartyPackageNotice>();
  for (const notice of notices) {
    const identity = `${notice.name}@${notice.version}`;
    const existing = byIdentity.get(identity);
    if (existing && existing.license !== notice.license)
      throw new Error(`bundled package license is inconsistent: ${identity}`);
    byIdentity.set(identity, notice);
  }
  return Object.freeze(
    [...byIdentity.values()].sort((left, right) =>
      `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
    ),
  );
}

export function renderThirdPartyNotices(
  bunVersion: string,
  packages: readonly ThirdPartyPackageNotice[],
): string {
  const lines = [
    "Lorelum CLI third-party notices",
    "",
    `Bun runtime ${bunVersion} — MIT`,
    ...packages.map((entry) => `${entry.name}@${entry.version} — ${entry.license}`),
    "",
  ];
  return lines.join("\n");
}

function packageManifestForInput(input: string): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  const markerIndex = input.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const packageStart = markerIndex + marker.length;
  const remaining = input.slice(packageStart).split(sep);
  const packageLength = remaining[0]?.startsWith("@") ? 2 : 1;
  if (remaining.length < packageLength || remaining.slice(0, packageLength).some((part) => !part))
    return undefined;
  return `${input.slice(0, packageStart)}${remaining.slice(0, packageLength).join(sep)}${sep}package.json`;
}

async function readPackageNotice(path: string): Promise<ThirdPartyPackageNotice> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`cannot read bundled package manifest: ${path}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`bundled package manifest is invalid: ${path}`);
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.name !== "string" ||
    manifest.name.length === 0 ||
    typeof manifest.version !== "string" ||
    manifest.version.length === 0 ||
    typeof manifest.license !== "string" ||
    manifest.license.length === 0
  ) {
    throw new Error(`bundled package lacks name, version, or license: ${path}`);
  }
  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
  });
}
