import type { LocalizationManifestEntry } from "./manifest";

export interface LocalizationStateInput {
  /** Formatted canonical digest keyed by Pack-relative Practice path. */
  canonicalDigests: Readonly<Record<string, string>>;
  /** Entries recorded by the localization manifest for one locale. */
  entries: readonly LocalizationManifestEntry[];
  /** Existing localized files, including files not yet recorded in a manifest. */
  localizedPaths: readonly string[];
}

export interface LocalizationStateReport {
  current: string[];
  stale: string[];
  missing: string[];
  orphaned: string[];
}

/** Classify localization paths without reading or writing the filesystem. */
export function analyzeLocalizationState(input: LocalizationStateInput): LocalizationStateReport {
  const entryByPath = new Map<string, LocalizationManifestEntry>();
  const orphaned = new Set<string>();
  for (const entry of input.entries) {
    if (entryByPath.has(entry.path)) orphaned.add(entry.path);
    entryByPath.set(entry.path, entry);
    if (!(entry.path in input.canonicalDigests)) orphaned.add(entry.path);
  }
  const localizedSet = new Set(input.localizedPaths);
  for (const path of input.localizedPaths) {
    if (!(path in input.canonicalDigests)) orphaned.add(path);
  }

  const current: string[] = [];
  const stale: string[] = [];
  const missing: string[] = [];
  for (const path of Object.keys(input.canonicalDigests).sort()) {
    const entry = entryByPath.get(path);
    if (!localizedSet.has(path)) {
      missing.push(path);
    } else if (entry === undefined) {
      stale.push(path);
    } else if (entry.source_digest === input.canonicalDigests[path]) {
      current.push(path);
    } else {
      stale.push(path);
    }
  }
  return {
    current,
    stale,
    missing,
    orphaned: [...orphaned].sort(),
  };
}
