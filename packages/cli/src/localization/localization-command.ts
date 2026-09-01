import { decodePackDirectory, PackValidationError, SnapshotFormatError } from "@lorelum/engine";
import {
  analyzeLocalizationState,
  canonicalizeLocalizationLocale,
  computeLocalizationSourceDigest,
  formatPracticeMarkdown,
  parseFrontmatter,
  parseLocalizationManifest,
  serializeLocalizationManifest,
  validateLocalizationLocale,
  type LocalizationManifest,
  type LocalizationManifestEntry,
  type ValidationIssue,
} from "@lorelum/format";
import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, cliErrorCodes, frameworkErrorCodes } from "../runtime/errors.js";
import {
  discoverPackFiles,
  readOptionalFile,
  writeAtomic,
  type DiscoveredPackFiles,
} from "./filesystem.js";
import { join } from "node:path";

const stringSchema: JsonSchema = { type: "string" };
const stringArraySchema: JsonSchema = { type: "array", items: stringSchema };
const formatResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["formattedFiles", "manifestFormatted"],
  properties: { formattedFiles: stringArraySchema, manifestFormatted: { type: "boolean" } },
};
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
const packResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "diagnostics"],
  properties: {
    valid: { type: "boolean" },
    diagnostics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["level", "code", "path", "message"],
        properties: {
          level: { enum: ["error", "warning", "info"] },
          code: stringSchema,
          path: stringSchema,
          message: stringSchema,
        },
      },
    },
  },
};
const localizationResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["locales"],
  properties: {
    locales: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["locale", "total", "localized", "current", "stale", "missing", "orphaned"],
        properties: {
          locale: stringSchema,
          total: { type: "integer" },
          localized: { type: "integer" },
          current: stringArraySchema,
          stale: stringArraySchema,
          missing: stringArraySchema,
          orphaned: stringArraySchema,
        },
      },
    },
  },
};
const validateResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pack", "localization"],
  properties: { pack: packResultSchema, localization: localizationResultSchema },
};

const formatErrors = Object.freeze([...frameworkErrorCodes, cliErrorCodes.localizationInvalid]);
const syncErrors = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.localizationInvalid,
  cliErrorCodes.localizationPracticeNotFound,
  cliErrorCodes.packInvalid,
]);
const validateErrors = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.localizationInvalid,
  cliErrorCodes.packInvalid,
]);

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
function visibleLocalizationError(error: unknown): never {
  if (error instanceof CliError) throw error;
  throw new CliError(
    cliErrorCodes.localizationInvalid,
    "Localization source could not be processed.",
  );
}
function asManifestEntry(path: string, digest: string): LocalizationManifestEntry {
  return { path, source_digest: digest };
}
function mirrorPath(locale: string, path: string): string | undefined {
  const prefix = `i18n/${locale}/`;
  if (!path.startsWith(prefix)) return undefined;
  const mirrored = path.slice(prefix.length);
  return mirrored.startsWith("practices/") ? mirrored : undefined;
}
function localizedForLocale(
  files: DiscoveredPackFiles,
  locale: string,
): ReadonlyMap<string, string> {
  const source = files.localized.get(locale) ?? new Map<string, string>();
  const mirrored = new Map<string, string>();
  for (const [path, text] of source) {
    const value = mirrorPath(locale, path);
    if (value !== undefined) mirrored.set(value, text);
  }
  return mirrored;
}
function assertCanonicalLocaleDirectories(files: DiscoveredPackFiles): void {
  for (const locale of files.localized.keys()) {
    if (!validateLocalizationLocale(locale) || canonicalizeLocalizationLocale(locale) !== locale) {
      throw new CliError(
        cliErrorCodes.localizationInvalid,
        "Locale directory is not canonical BCP 47.",
      );
    }
  }
}
function assertLocalizedMarkdown(files: DiscoveredPackFiles): void {
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
async function loadManifest(packRoot: string): Promise<LocalizationManifest | undefined> {
  const raw = await readOptionalFile(join(packRoot, "i18n", "manifest.yaml"));
  return raw === undefined ? undefined : parseLocalizationManifest(raw);
}
async function canonicalDigests(
  canonical: ReadonlyMap<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [path, text] of canonical) {
    // eslint-disable-next-line no-await-in-loop -- preserve deterministic digest traversal
    result[path] = await computeLocalizationSourceDigest(text);
  }
  return result;
}

async function formatPack(packRoot: string): Promise<JsonValue> {
  const files = await discoverPackFiles(packRoot);
  assertCanonicalLocaleDirectories(files);
  assertLocalizedMarkdown(files);
  const writes: { path: string; content: string }[] = [];
  const formattedFiles: string[] = [];
  for (const [path, raw] of files.canonical) {
    // eslint-disable-next-line no-await-in-loop -- formatter ordering is deterministic
    const content = await formatPracticeMarkdown(raw);
    if (content !== raw) writes.push({ path: join(packRoot, path), content });
    if (content !== raw) formattedFiles.push(path);
  }
  for (const [locale, localized] of files.localized) {
    for (const [path, raw] of localized) {
      // eslint-disable-next-line no-await-in-loop -- formatter ordering is deterministic
      const content = await formatPracticeMarkdown(raw);
      if (content !== raw) {
        const relativePath = mirrorPath(locale, path);
        if (relativePath !== undefined) {
          formattedFiles.push(path);
          writes.push({ path: join(packRoot, path), content });
        }
      }
    }
  }
  let manifestFormatted = false;
  const manifestPath = join(packRoot, "i18n", "manifest.yaml");
  const manifestRaw = await readOptionalFile(manifestPath);
  if (manifestRaw !== undefined) {
    const formatted = serializeLocalizationManifest(parseLocalizationManifest(manifestRaw));
    manifestFormatted = formatted !== manifestRaw;
    if (manifestFormatted) writes.push({ path: manifestPath, content: formatted });
  }
  for (const write of writes) {
    // eslint-disable-next-line no-await-in-loop -- avoid concurrent replacement races
    await writeAtomic(write.path, write.content);
  }
  return { formattedFiles: formattedFiles.sort(), manifestFormatted };
}

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
  if (locale === "") throw new CliError(cliErrorCodes.localizationInvalid, "Locale is required.");
  let sourceLocale: string;
  const existing = await loadManifest(packRoot);
  try {
    if (existing === undefined) {
      if (sourceLocaleInput === undefined || !validateLocalizationLocale(sourceLocaleInput))
        throw new Error("source locale required");
      sourceLocale = canonicalizeLocalizationLocale(sourceLocaleInput);
    } else {
      sourceLocale = existing.source_locale;
      if (
        !validateLocalizationLocale(sourceLocale) ||
        canonicalizeLocalizationLocale(sourceLocale) !== sourceLocale
      )
        throw new Error("invalid manifest source locale");
      if (
        sourceLocaleInput !== undefined &&
        (!validateLocalizationLocale(sourceLocaleInput) ||
          canonicalizeLocalizationLocale(sourceLocaleInput) !== sourceLocale)
      )
        throw new Error("source locale mismatch");
    }
  } catch {
    throw new CliError(cliErrorCodes.localizationInvalid, "Source locale is missing or invalid.");
  }
  if (sourceLocale === locale)
    throw new CliError(cliErrorCodes.localizationInvalid, "Source and target locales must differ.");
  const localized = localizedForLocale(files, locale);
  const selected = new Set<string>();
  if (all) for (const path of localized.keys()) selected.add(path);
  if (all && selected.size === 0)
    throw new CliError(
      cliErrorCodes.localizationInvalid,
      "No localized Practices were found for this locale.",
    );
  if (practice !== undefined) {
    for (const [path, raw] of files.canonical) {
      try {
        const id = parseFrontmatter(raw).data.id;
        if (id === practice) selected.add(path);
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
  const oldEntries = manifest.locales[locale]?.entries ?? [];
  const updates = new Map(oldEntries.map((entry) => [entry.path, entry]));
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

async function validatePack(packRoot: string): Promise<CommandResultLike> {
  let decoded;
  try {
    decoded = await decodePackDirectory(packRoot);
  } catch (error) {
    if (error instanceof PackValidationError) {
      return {
        data: {
          pack: { valid: false, diagnostics: flattenValidationReport(error.report) },
          localization: { locales: [] },
        },
        exitCode: 1,
      };
    }
    if (error instanceof SnapshotFormatError)
      throw new CliError(cliErrorCodes.packInvalid, "The selected Pack is invalid.");
    throw error;
  }
  const files = await discoverPackFiles(packRoot);
  assertCanonicalLocaleDirectories(files);
  assertLocalizedMarkdown(files);
  const manifest = await loadManifest(packRoot);
  if (manifest !== undefined) {
    if (
      !validateLocalizationLocale(manifest.source_locale) ||
      canonicalizeLocalizationLocale(manifest.source_locale) !== manifest.source_locale
    ) {
      throw new CliError(
        cliErrorCodes.localizationInvalid,
        "Manifest source locale is not canonical BCP 47.",
      );
    }
    for (const locale of Object.keys(manifest.locales)) {
      if (
        !validateLocalizationLocale(locale) ||
        canonicalizeLocalizationLocale(locale) !== locale ||
        locale === manifest.source_locale
      ) {
        throw new CliError(
          cliErrorCodes.localizationInvalid,
          "Manifest locale is invalid or matches source locale.",
        );
      }
    }
  }
  const locales = new Set<string>([
    ...files.localized.keys(),
    ...(manifest === undefined ? [] : Object.keys(manifest.locales)),
  ]);
  const digests = await canonicalDigests(files.canonical);
  const localeResults = [];
  let localizationProblems = false;
  for (const locale of [...locales].sort()) {
    const entries = manifest?.locales[locale]?.entries ?? [];
    const state = analyzeLocalizationState({
      canonicalDigests: digests,
      entries,
      localizedPaths: [...localizedForLocale(files, locale).keys()],
    });
    localizationProblems ||=
      state.stale.length > 0 || state.missing.length > 0 || state.orphaned.length > 0;
    localeResults.push({
      locale,
      total: Object.keys(digests).length,
      localized: Object.keys(digests).length - state.missing.length,
      ...state,
    });
  }
  const diagnostics = [...decoded.diagnostics].map((diagnostic) => ({ ...diagnostic }));
  return {
    data: { pack: { valid: true, diagnostics }, localization: { locales: localeResults } },
    exitCode: localizationProblems ? 1 : 0,
  };
}

function flattenValidationReport(report: {
  errors: readonly ValidationIssue[];
  warnings: readonly ValidationIssue[];
  infos: readonly ValidationIssue[];
}): JsonValue[] {
  return [...report.errors, ...report.warnings, ...report.infos].map((diagnostic) => ({
    ...diagnostic,
  }));
}

interface CommandResultLike {
  readonly data: JsonValue;
  readonly exitCode?: 0 | 1;
}

export function createLocalizationCommands(): readonly CommandDefinition[] {
  return [
    {
      name: "format",
      summary: "Format canonical and localized Pack source files.",
      positionals: [{ name: "pack-root", required: true }],
      options: [],
      resultSchema: formatResultSchema,
      errorCodes: formatErrors,
      exitCodes: [0, 2],
      async handler({ positionals }) {
        try {
          return { data: await formatPack(positionals[0]!) };
        } catch (error) {
          visibleLocalizationError(error);
        }
      },
    },
    {
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
    },
    {
      name: "validate",
      summary: "Validate a Pack and report localization state.",
      positionals: [{ name: "pack-root", required: true }],
      options: [],
      resultSchema: validateResultSchema,
      errorCodes: validateErrors,
      exitCodes: [0, 1, 2],
      async handler({ positionals }) {
        try {
          return await validatePack(positionals[0]!);
        } catch (error) {
          visibleLocalizationError(error);
        }
      },
    },
  ];
}
