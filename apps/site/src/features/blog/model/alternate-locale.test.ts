import { describe, expect, test } from "bun:test";
import { pickAlternateLocale } from "./alternate-locale";

describe("pickAlternateLocale", () => {
  test("returns the locale that has a translation", () => {
    const has = new Set(["en", "zh"]);
    expect(pickAlternateLocale("en", ["en", "zh"], (l) => has.has(l))).toBe("zh");
  });

  test("returns undefined when only the current locale exists", () => {
    // This is the case that matters: a pill offering a translation the route
    // cannot serve sends the reader to a 404.
    expect(pickAlternateLocale("en", ["en", "zh"], (l) => l === "en")).toBeUndefined();
  });

  test("never returns the current locale itself", () => {
    expect(pickAlternateLocale("en", ["en"], () => true)).toBeUndefined();
  });

  test("picks the first other locale that exists, in configuration order", () => {
    const has = new Set(["ja"]);
    expect(pickAlternateLocale("en", ["en", "zh", "ja"], (l) => has.has(l))).toBe("ja");
  });

  test("an unknown current locale still resolves to a real translation", () => {
    expect(pickAlternateLocale("de", ["en", "zh"], (l) => l === "en")).toBe("en");
  });
});
