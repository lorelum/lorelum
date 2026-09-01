import { describe, expect, test } from "bun:test";

import { canonicalizeLocalizationLocale, validateLocalizationLocale } from "./locale";

describe("localization locale", () => {
  test.each(["en", "zh-CN", "sr-Latn-RS", "de-CH-1996", "en-u-ca-gregory", "zh-Hant-x-private"])(
    "accepts canonical BCP 47 tag %s",
    (locale) => expect(validateLocalizationLocale(locale)).toBe(true),
  );

  test.each(["ZH-cn", "zh-cn", "en_US", "en-u", "en-a-foo-a-bar", "e"])(
    "rejects non-canonical or malformed locale %s",
    (locale) => expect(validateLocalizationLocale(locale)).toBe(false),
  );

  test("canonicalizes casing without accepting it as canonical input", () => {
    expect(canonicalizeLocalizationLocale("ZH-cn")).toBe("zh-CN");
    expect(validateLocalizationLocale("ZH-cn")).toBe(false);
  });
});
