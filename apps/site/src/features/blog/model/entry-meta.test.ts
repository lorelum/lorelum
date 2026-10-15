import { describe, expect, test } from "bun:test";
import { languageHintKey } from "./entry-meta";

describe("languageHintKey", () => {
  test("stays silent when the content is in the page's language", () => {
    expect(languageHintKey("en", "en")).toBeUndefined();
    expect(languageHintKey("zh", "zh")).toBeUndefined();
  });

  test("names the content's language, not the missing one", () => {
    // The hint is read by someone on a page in *their* language, telling them
    // which language this entry is in.
    expect(languageHintKey("zh", "en")).toBe("blogOnlyInChinese");
    expect(languageHintKey("en", "zh")).toBe("blogOnlyInEnglish");
  });

  test("treats an unknown content locale as not the page's language", () => {
    expect(languageHintKey("fr", "en")).toBe("blogOnlyInEnglish");
  });
});
