import { describe, expect, test } from "bun:test";

import { validateLocalizationLocale } from "./locale";

describe("localization locale", () => {
  test.each(["en", "zh-CN", "sr-Latn-RS", "de-CH-1996", "en-u-ca-gregory", "zh-Hant-x-private"])(
    "accepts canonical BCP 47 tag %s",
    (locale) => expect(validateLocalizationLocale(locale)).toBe(true),
  );

  test.each(["ZH-cn", "zh-cn", "en_US", "en-u", "en-a-foo-a-bar", "e"])(
    "rejects non-canonical or malformed locale %s",
    (locale) => expect(validateLocalizationLocale(locale)).toBe(false),
  );
});
