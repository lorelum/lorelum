import { describe, expect, test } from "bun:test";
import { getStrings } from "./legacy-translations";

describe("translations", () => {
  test("en and zh dictionaries are in lockstep", () => {
    const en = getStrings("en");
    const zh = getStrings("zh");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  test("every string is non-empty and every list is non-empty", () => {
    for (const locale of ["en", "zh"]) {
      const t = getStrings(locale);
      for (const [key, value] of Object.entries(t)) {
        if (Array.isArray(value)) {
          expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
        } else {
          expect(String(value).trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
