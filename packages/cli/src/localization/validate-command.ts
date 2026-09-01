import { decodePackDirectory, PackValidationError, SnapshotFormatError } from "@lorelum/engine";
import { analyzeLocalizationState, type ValidationIssue } from "@lorelum/format";
import type { CommandDefinition, CommandResult } from "../registry.js";
import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { frameworkErrorCodes, cliErrorCodes, CliError } from "../runtime/errors.js";
import { discoverPackFiles } from "./filesystem.js";
import {
  assertCanonicalLocaleDirectories,
  assertLocalizedMarkdown,
  canonicalDigests,
  loadManifest,
  localizedForLocale,
  visibleLocalizationError,
} from "./common.js";

const stringSchema: JsonSchema = { type: "string" };
const diagnosticSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["level", "code", "path", "message"],
  properties: {
    level: { enum: ["error", "warning", "info"] },
    code: stringSchema,
    path: stringSchema,
    message: stringSchema,
  },
};
const packResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "diagnostics"],
  properties: {
    valid: { type: "boolean" },
    diagnostics: { type: "array", items: diagnosticSchema },
  },
};
const localeStateSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["locale", "total", "localized", "current", "stale", "missing", "orphaned"],
  properties: {
    locale: stringSchema,
    total: { type: "integer" },
    localized: { type: "integer" },
    current: { type: "array", items: stringSchema },
    stale: { type: "array", items: stringSchema },
    missing: { type: "array", items: stringSchema },
    orphaned: { type: "array", items: stringSchema },
  },
};
const validateResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pack", "localization"],
  properties: {
    pack: packResultSchema,
    localization: {
      type: "object",
      additionalProperties: false,
      required: ["locales"],
      properties: { locales: { type: "array", items: localeStateSchema } },
    },
  },
};
const validateErrors = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.localizationInvalid,
  cliErrorCodes.packInvalid,
]);

function flattenValidationReport(report: {
  errors: readonly ValidationIssue[];
  warnings: readonly ValidationIssue[];
  infos: readonly ValidationIssue[];
}): JsonValue[] {
  return [...report.errors, ...report.warnings, ...report.infos].map((diagnostic) => ({
    ...diagnostic,
  }));
}

async function validatePack(packRoot: string): Promise<CommandResult<JsonValue>> {
  let decoded;
  try {
    decoded = await decodePackDirectory(packRoot);
  } catch (error) {
    if (error instanceof PackValidationError)
      return {
        data: {
          pack: { valid: false, diagnostics: flattenValidationReport(error.report) },
          localization: { locales: [] },
        },
        exitCode: 1,
      };
    if (error instanceof SnapshotFormatError)
      throw new CliError(cliErrorCodes.packInvalid, "The selected Pack is invalid.");
    throw error;
  }
  const files = await discoverPackFiles(packRoot);
  assertCanonicalLocaleDirectories(files);
  assertLocalizedMarkdown(files);
  const manifest = await loadManifest(packRoot);
  const locales = new Set<string>([
    ...files.localized.keys(),
    ...(manifest === undefined ? [] : Object.keys(manifest.locales)),
  ]);
  const digests = await canonicalDigests(files.canonical);
  const localeResults = [];
  let localizationProblems = false;
  for (const locale of [...locales].sort()) {
    const state = analyzeLocalizationState({
      canonicalDigests: digests,
      entries: manifest?.locales[locale]?.entries ?? [],
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
  return {
    data: {
      pack: {
        valid: true,
        diagnostics: decoded.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      },
      localization: { locales: localeResults },
    },
    exitCode: localizationProblems ? 1 : 0,
  };
}

export function createValidateCommand(): CommandDefinition {
  return {
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
  };
}
