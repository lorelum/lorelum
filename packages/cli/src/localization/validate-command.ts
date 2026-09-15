import { lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  decodePackDirectory,
  InvalidProjectRootError,
  PackValidationError,
  resolveProjectContext,
  SnapshotFormatError,
} from "@lorelum/engine";
import { analyzeLocalizationState, type ValidationIssue } from "@lorelum/format";
import type { CommandDefinition, CommandResult } from "../registry.js";
import type { JsonSchema, JsonValue } from "../output/protocol.js";
import { frameworkErrorCodes, cliErrorCodes } from "../runtime/errors.js";
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
  oneOf: [
    {
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
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["project"],
      properties: {
        project: {
          type: "object",
          additionalProperties: false,
          required: ["valid", "state", "diagnostics"],
          properties: {
            valid: { type: "boolean" },
            state: { enum: ["ready", "degraded"] },
            diagnostics: { type: "array", items: diagnosticSchema },
          },
        },
      },
    },
  ],
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

function diagnosticSnapshotPath(packRoot: string, snapshotPath: string): string {
  const path = relative(packRoot, snapshotPath);
  if (path === "" || path.split(sep).includes("..")) return ".";
  return path.split(sep).join("/");
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
      return {
        data: {
          pack: {
            valid: false,
            diagnostics: [
              {
                level: "error",
                code: "snapshot.invalid",
                path: diagnosticSnapshotPath(packRoot, error.snapshotPath),
                message: "Pack directory structure is invalid.",
              },
            ],
          },
          localization: { locales: [] },
        },
        exitCode: 1,
      };
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

async function isProjectRoot(path: string): Promise<boolean> {
  const marker = await lstat(join(path, ".lorelum")).catch(() => undefined);
  return marker?.isDirectory() === true && !marker.isSymbolicLink();
}

function projectDiagnostics(
  snapshot: NonNullable<Awaited<ReturnType<typeof resolveProjectContext>>>,
): JsonValue[] {
  return snapshot.warnings.map((warning) => {
    const prefix = `layers/${warning.layerDepth}`;
    if (warning.code === "config.invalid") {
      return {
        level: "error",
        code: "project.config.invalid",
        path: `${prefix}/.lorelum/config.yaml`,
        message: "Project layer configuration is invalid and was ignored by ordinary query.",
      };
    }
    if (warning.code === "pack.invalid" || warning.code === "source.unsafe") {
      return {
        level: "error",
        code: warning.code === "pack.invalid" ? "project.pack.invalid" : "project.source.unsafe",
        path:
          warning.packName === undefined
            ? `${prefix}/.lorelum/packs`
            : `${prefix}/.lorelum/packs/${warning.packName}`,
        message: "Project Pack source is invalid or unsafe and was ignored by ordinary query.",
      };
    }
    return {
      level: "error",
      code: "project.practice.invalid",
      path:
        warning.packName === undefined
          ? `${prefix}/.lorelum/packs`
          : `${prefix}/.lorelum/packs/${warning.packName}/practices/${warning.practiceId ?? "unknown"}`,
      message: "Project Practice is invalid and was ignored by ordinary query.",
    };
  });
}

async function validateProject(projectRoot: string): Promise<CommandResult<JsonValue>> {
  try {
    const snapshot = await resolveProjectContext({
      projectRoot,
      storageRoot: { rootPath: join(projectRoot, ".lorelum", ".validate-store") },
      store: {
        async readEffectivePracticeSnapshot() {
          return { practices: [] };
        },
      },
    });
    if (snapshot === undefined) throw new InvalidProjectRootError();
    const diagnostics = projectDiagnostics(snapshot);
    return {
      data: {
        project: {
          valid: diagnostics.length === 0,
          state: snapshot.state,
          diagnostics,
        },
      },
      exitCode: diagnostics.length === 0 ? 0 : 1,
    };
  } catch (error) {
    if (!(error instanceof InvalidProjectRootError)) throw error;
    return {
      data: {
        project: {
          valid: false,
          state: "degraded",
          diagnostics: [
            {
              level: "error",
              code: "project.root.invalid",
              path: ".",
              message: "Project root must directly contain a safe .lorelum directory.",
            },
          ],
        },
      },
      exitCode: 1,
    };
  }
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
        const root = positionals[0]!;
        return (await isProjectRoot(root)) ? await validateProject(root) : await validatePack(root);
      } catch (error) {
        visibleLocalizationError(error);
      }
    },
  };
}
