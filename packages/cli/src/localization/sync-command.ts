import { join } from "node:path";
import { decodePackDirectory, PackValidationError, SnapshotFormatError } from "@lorelum/engine";
import {
  canonicalizeLocalizationLocale,
  parseFrontmatter,
  serializeLocalizationManifest,
  validateLocalizationLocale,
  type LocalizationManifest,
  type LocalizationManifestEntry,
} from "@lorelum/format";
import type { CommandDefinition } from "../registry.js";
import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { frameworkErrorCodes, cliErrorCodes, CliError } from "../runtime/errors.js";
import { discoverPackFiles, writeAtomic } from "./filesystem.js";
import {
  assertCanonicalLocaleDirectories,
  assertLocalizedMarkdown,
  canonicalDigests,
  loadManifest,
  localizedForLocale,
  visibleLocalizationError,
} from "./common.js";

function optionString(
  options: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}
function optionBoolean(options: Readonly<Record<string, unknown>>, name: string): boolean {
  return options[name] === true;
}
function asManifestEntry(path: string, digest: string): LocalizationManifestEntry {
  return { path, source_digest: digest };
}

const stringSchema: JsonSchema = { type: "string" };
const syncResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["locale", "synchronized", "manifestPath"],
  properties: {
    locale: stringSchema,
    synchronized: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "sourceDigest"],
        properties: { path: stringSchema, sourceDigest: stringSchema },
      },
    },
    manifestPath: stringSchema,
  },
};
const syncErrors = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.localizationInvalid,
  cliErrorCodes.localizationPracticeNotFound,
  cliErrorCodes.packInvalid,
]);

async function syncLocalization(
  packRoot: string,
  localeInput: string,
  sourceLocaleInput: string | undefined,
  practice: string | undefined,
  all: boolean,
): Promise<JsonValue> {
  if (all === (practice !== undefined))
    throw new CliError(cliErrorCodes.usageInvalid, "Specify exactly one of --all or --practice.");
  try {
    await decodePackDirectory(packRoot);
  } catch (error) {
    if (error instanceof PackValidationError || error instanceof SnapshotFormatError)
      throw new CliError(cliErrorCodes.packInvalid, "The selected Pack is invalid.");
    throw error;
  }
  let locale: string;
  try {
    if (!validateLocalizationLocale(localeInput)) throw new Error("invalid locale");
    locale = canonicalizeLocalizationLocale(localeInput);
  } catch {
    throw new CliError(
      cliErrorCodes.localizationInvalid,
      "Locale is not a valid BCP 47 identifier.",
    );
  }
  const files = await discoverPackFiles(packRoot);
  assertCanonicalLocaleDirectories(files);
  assertLocalizedMarkdown(files);
  const existing = await loadManifest(packRoot);
  let sourceLocale: string;
  try {
    if (existing === undefined) {
      if (sourceLocaleInput === undefined || !validateLocalizationLocale(sourceLocaleInput))
        throw new Error("source locale required");
      sourceLocale = canonicalizeLocalizationLocale(sourceLocaleInput);
    } else {
      sourceLocale = existing.source_locale;
      if (
        sourceLocaleInput !== undefined &&
        (!validateLocalizationLocale(sourceLocaleInput) || sourceLocaleInput !== sourceLocale)
      )
        throw new Error("source locale mismatch");
    }
  } catch {
    throw new CliError(cliErrorCodes.localizationInvalid, "Source locale is missing or invalid.");
  }
  if (sourceLocale === locale)
    throw new CliError(cliErrorCodes.localizationInvalid, "Source and target locales must differ.");
  const localized = localizedForLocale(files, locale);
  const selected = new Set<string>(all ? localized.keys() : []);
  if (all && selected.size === 0)
    throw new CliError(
      cliErrorCodes.localizationInvalid,
      "No localized Practices were found for this locale.",
    );
  if (practice !== undefined) {
    for (const [path, raw] of files.canonical) {
      try {
        if (parseFrontmatter(raw).data.id === practice) selected.add(path);
      } catch {
        throw new CliError(
          cliErrorCodes.localizationInvalid,
          `Cannot parse canonical Practice ${path}.`,
        );
      }
    }
    if (selected.size === 0)
      throw new CliError(
        cliErrorCodes.localizationPracticeNotFound,
        `Practice "${practice}" was not found.`,
      );
    for (const path of selected)
      if (!localized.has(path))
        throw new CliError(
          cliErrorCodes.localizationInvalid,
          `Localized Practice ${path} is missing.`,
        );
  }
  const manifest: LocalizationManifest = existing ?? {
    schema_version: 1,
    source_locale: sourceLocale,
    locales: {},
  };
  const updates = new Map(
    (manifest.locales[locale]?.entries ?? []).map((entry) => [entry.path, entry]),
  );
  const digests = await canonicalDigests(files.canonical);
  const synchronized: { path: string; sourceDigest: string }[] = [];
  for (const path of [...selected].sort()) {
    const digest = digests[path];
    if (digest === undefined)
      throw new CliError(
        cliErrorCodes.localizationInvalid,
        `Canonical Practice ${path} is missing.`,
      );
    updates.set(path, asManifestEntry(path, digest));
    synchronized.push({ path, sourceDigest: digest });
  }
  const nextManifest: LocalizationManifest = {
    ...manifest,
    locales: {
      ...manifest.locales,
      [locale]: { entries: [...updates.values()].sort((a, b) => a.path.localeCompare(b.path)) },
    },
  };
  await writeAtomic(
    join(packRoot, "i18n", "manifest.yaml"),
    serializeLocalizationManifest(nextManifest),
  );
  return { locale, synchronized, manifestPath: "i18n/manifest.yaml" };
}

export function createSyncCommand(): CommandDefinition {
  return {
    name: "i18n.sync",
    summary: "Synchronize selected localized Practices with canonical sources.",
    positionals: [{ name: "pack-root", required: true }],
    options: [
      {
        longFlag: "--locale",
        description: "BCP 47 locale to synchronize.",
        value: { name: "locale", required: true },
        optionRequired: true,
      },
      {
        longFlag: "--source-locale",
        description: "Canonical source BCP 47 locale (required for a new manifest).",
        value: { name: "locale", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--practice",
        description: "Synchronize one Practice by id.",
        value: { name: "id", required: true },
        optionRequired: false,
      },
      {
        longFlag: "--all",
        description: "Synchronize all existing localized Practices.",
        optionRequired: false,
      },
    ],
    resultSchema: syncResultSchema,
    errorCodes: syncErrors,
    exitCodes: [0, 2],
    async handler({ options, positionals }) {
      try {
        return {
          data: await syncLocalization(
            positionals[0]!,
            optionString(options, "locale")!,
            optionString(options, "sourceLocale"),
            optionString(options, "practice"),
            optionBoolean(options, "all"),
          ),
        };
      } catch (error) {
        visibleLocalizationError(error);
      }
    },
  };
}
