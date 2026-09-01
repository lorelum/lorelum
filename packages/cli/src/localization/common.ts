import { join } from "node:path";
import {
  computeLocalizationSourceDigest,
  parseLocalizationManifest,
  validateLocalizationLocale,
  type LocalizationManifest,
} from "@lorelum/format";
import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { readOptionalFile, type DiscoveredPackFiles } from "./filesystem.js";

export function visibleLocalizationError(error: unknown): never {
  if (error instanceof CliError) throw error;
  throw new CliError(
    cliErrorCodes.localizationInvalid,
    "Localization source could not be processed.",
  );
}
export function mirrorPath(locale: string, path: string): string | undefined {
  const prefix = `i18n/${locale}/`;
  if (!path.startsWith(prefix)) return undefined;
  const mirrored = path.slice(prefix.length);
  return mirrored.startsWith("practices/") ? mirrored : undefined;
}
export function localizedForLocale(
  files: DiscoveredPackFiles,
  locale: string,
): ReadonlyMap<string, string> {
  const mirrored = new Map<string, string>();
  for (const [path, text] of files.localized.get(locale) ?? []) {
    const value = mirrorPath(locale, path);
    if (value !== undefined) mirrored.set(value, text);
  }
  return mirrored;
}
export function assertCanonicalLocaleDirectories(files: DiscoveredPackFiles): void {
  for (const locale of files.localized.keys()) {
    if (!validateLocalizationLocale(locale)) {
      throw new CliError(
        cliErrorCodes.localizationInvalid,
        "Locale directory is not canonical BCP 47.",
      );
    }
  }
}
export function assertLocalizedMarkdown(files: DiscoveredPackFiles): void {
  for (const localized of files.localized.values()) {
    for (const text of localized.values()) {
      if (/^---(?:\r?\n|$)/.test(text)) {
        throw new CliError(
          cliErrorCodes.localizationInvalid,
          "Localized Markdown must not contain runtime frontmatter.",
        );
      }
    }
  }
}
export async function loadManifest(packRoot: string): Promise<LocalizationManifest | undefined> {
  const raw = await readOptionalFile(join(packRoot, "i18n", "manifest.yaml"));
  return raw === undefined ? undefined : parseLocalizationManifest(raw);
}
export async function canonicalDigests(
  canonical: ReadonlyMap<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [path, text] of canonical) {
    // eslint-disable-next-line no-await-in-loop -- preserve deterministic digest traversal
    result[path] = await computeLocalizationSourceDigest(text);
  }
  return result;
}
