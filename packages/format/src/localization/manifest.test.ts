import { describe, expect, test } from "bun:test";

import {
  LocalizationManifestSchema,
  parseLocalizationManifest,
  serializeLocalizationManifest,
} from "./manifest";

const digest = "sha256:" + "a".repeat(64);

describe("localization manifest", () => {
  test("parses the strict manifest contract", () => {
    const manifest = parseLocalizationManifest(`schema_version: 1
source_locale: en
locales:
  zh-CN:
    entries:
      - path: practices/z.md
        source_digest: ${digest}
`);
    expect(manifest.locales["zh-CN"]!.entries[0]!.path).toBe("practices/z.md");
  });

  test.each([
    "practices/../x.md",
    "/practices/x.md",
    "practices\\x.md",
    "docs/x.md",
    "practices/x.txt",
  ])("rejects unsafe path %s", (path) => {
    expect(() =>
      LocalizationManifestSchema.parse({
        schema_version: 1,
        source_locale: "en",
        locales: { "zh-CN": { entries: [{ path, source_digest: digest }] } },
      }),
    ).toThrow();
  });

  test("rejects duplicate paths and unknown fields", () => {
    expect(() =>
      LocalizationManifestSchema.parse({
        schema_version: 1,
        source_locale: "en",
        locales: {
          "zh-CN": {
            entries: [
              { path: "practices/x.md", source_digest: digest },
              { path: "practices/x.md", source_digest: digest },
            ],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseLocalizationManifest("schema_version: 1\nsource_locale: en\nextra: x\nlocales: {}\n"),
    ).toThrow();
    expect(() =>
      LocalizationManifestSchema.parse({
        schema_version: 1,
        source_locale: "en",
        locales: { en: { entries: [] } },
      }),
    ).toThrow();
  });

  test("serializes locale and path keys deterministically", () => {
    const manifest = {
      schema_version: 1 as const,
      source_locale: "en",
      locales: {
        "zh-CN": {
          entries: [
            { path: "practices/z.md", source_digest: digest },
            { path: "practices/a.md", source_digest: digest },
          ],
        },
        de: { entries: [{ path: "practices/b.md", source_digest: digest }] },
      },
    };
    const output = serializeLocalizationManifest(manifest);
    expect(output.indexOf("de:")).toBeLessThan(output.indexOf("zh-CN:"));
    expect(output.indexOf("practices/a.md")).toBeLessThan(output.indexOf("practices/z.md"));
    expect(serializeLocalizationManifest(parseLocalizationManifest(output))).toBe(output);
  });
});
