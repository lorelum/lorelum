import yaml from "js-yaml";
import { z } from "zod";

import { parseYaml } from "../frontmatter";
import { validateLocalizationLocale } from "./locale";

/** Safe Pack-relative path mirrored by a localization entry. */
export const LOCALIZATION_PRACTICE_PATH_REGEX =
  /^practices\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
export const LOCALIZATION_SOURCE_DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

export const LocalizationManifestEntrySchema = z
  .object({
    path: z.string().regex(LOCALIZATION_PRACTICE_PATH_REGEX, "path must mirror practices/**/*.md"),
    source_digest: z
      .string()
      .regex(LOCALIZATION_SOURCE_DIGEST_REGEX, "source_digest must be sha256:<64 lowercase hex>"),
  })
  .strict();

export const LocalizationManifestLocaleSchema = z
  .object({
    entries: z.array(LocalizationManifestEntrySchema),
  })
  .strict()
  .superRefine((locale, context) => {
    const paths = new Set<string>();
    locale.entries.forEach((entry, index) => {
      if (paths.has(entry.path)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "path"],
          message: `duplicate localization path: ${entry.path}`,
        });
      }
      paths.add(entry.path);
    });
  });

export const LocalizationManifestSchema = z
  .object({
    schema_version: z.literal(1),
    source_locale: z.string().superRefine((locale, context) => {
      if (!validateLocalizationLocale(locale)) {
        context.addIssue({ code: "custom", message: "source_locale must be canonical BCP 47" });
      }
    }),
    locales: z.record(z.string(), LocalizationManifestLocaleSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const locale of Object.keys(manifest.locales)) {
      if (!validateLocalizationLocale(locale)) {
        context.addIssue({
          code: "custom",
          path: ["locales", locale],
          message: "locale key must be canonical BCP 47",
        });
      } else if (locale === manifest.source_locale) {
        context.addIssue({
          code: "custom",
          path: ["locales", locale],
          message: "locale must differ from source_locale",
        });
      }
    }
  });

export type LocalizationManifestEntry = z.infer<typeof LocalizationManifestEntrySchema>;
export type LocalizationManifestLocale = z.infer<typeof LocalizationManifestLocaleSchema>;
export type LocalizationManifest = z.infer<typeof LocalizationManifestSchema>;

/** Parse and strictly validate an i18n/manifest.yaml document. */
export function parseLocalizationManifest(input: string): LocalizationManifest {
  return LocalizationManifestSchema.parse(parseYaml(input));
}

/** Build a deterministic YAML representation, sorting locale/path keys. */
export function serializeLocalizationManifest(manifest: LocalizationManifest): string {
  const parsed = LocalizationManifestSchema.parse(manifest);
  const locales: Record<string, LocalizationManifestLocale> = {};
  for (const locale of Object.keys(parsed.locales).sort(compareCodePoints)) {
    const entries = [...parsed.locales[locale]!.entries].sort((left, right) =>
      compareCodePoints(left.path, right.path),
    );
    locales[locale] = { entries };
  }
  // Keep top-level ordering stable and human-readable instead of relying on
  // js-yaml's global sortKeys behavior.
  const ordered = {
    schema_version: parsed.schema_version,
    source_locale: parsed.source_locale,
    locales,
  };
  return dumpYaml(ordered);
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dumpYaml(value: object): string {
  return yaml.dump(value, {
    noRefs: true,
    noCompatMode: true,
    lineWidth: -1,
    sortKeys: false,
  });
}
