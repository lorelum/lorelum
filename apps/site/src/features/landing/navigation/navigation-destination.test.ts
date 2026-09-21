import { describe, expect, test } from "bun:test";
import {
  destinationOf,
  destinationPath,
  isCurrentDestination,
  navigationDestinations,
} from "./navigation-destination";

const languages = ["en", "zh"];
const defaultLanguage = "en";

describe("navigation destination", () => {
  test("maps the unprefixed and the prefixed spelling to the same destination", () => {
    // Both spellings serve the same page: the prefixed routes exist for every
    // locale, including the default one. A current-page check that only knows
    // one of them leaves the reader without position feedback.
    expect(destinationOf("/blog", languages)).toBe("blog");
    expect(destinationOf("/en/blog", languages)).toBe("blog");
    expect(destinationOf("/en/blog/", languages)).toBe("blog");
    expect(destinationOf("/en/blog/practice-injection-measurement/", languages)).toBe("blog");
    expect(destinationOf("/zh/blog", languages)).toBe("blog");
  });

  test("maps the other destinations", () => {
    expect(destinationOf("/", languages)).toBe("home");
    expect(destinationOf("/en", languages)).toBe("home");
    expect(destinationOf("/zh", languages)).toBe("home");
    expect(destinationOf("/docs", languages)).toBe("docs");
    expect(destinationOf("/en/docs/create-pack", languages)).toBe("docs");
    expect(destinationOf("/zh/docs", languages)).toBe("docs");
  });

  test("returns undefined for paths the primary navigation does not own", () => {
    // Unmarked entries are what tells the navigation not to mark anything
    // current on a page it does not own.
    expect(destinationOf("/sitemap.xml", languages)).toBeUndefined();
    expect(destinationOf("/llms.txt", languages)).toBeUndefined();
    expect(destinationOf("/nope", languages)).toBeUndefined();
  });

  test("does not treat a locale-looking first segment as a locale when it is not configured", () => {
    // `/guide` is a page, not a locale: stripping it would map the path to home.
    expect(destinationOf("/guide/blog", languages)).toBeUndefined();
    expect(destinationOf("/guide", languages)).toBeUndefined();
  });

  test("builds one canonical href per destination per locale", () => {
    expect(destinationPath("home", "en", defaultLanguage)).toBe("/");
    expect(destinationPath("home", "zh", defaultLanguage)).toBe("/zh");
    expect(destinationPath("blog", "en", defaultLanguage)).toBe("/blog");
    expect(destinationPath("blog", "zh", defaultLanguage)).toBe("/zh/blog");
    expect(destinationPath("docs", "en", defaultLanguage)).toBe("/docs");
    expect(destinationPath("docs", "zh", defaultLanguage)).toBe("/zh/docs");
  });
});

describe("isCurrentDestination", () => {
  test("is true only for the destination the pathname belongs to", () => {
    // The whole marking rule in one place: a version that answered `true`
    // unconditionally would put every destination link in the "you are here"
    // state on every page, which is the defect this stage set out to remove.
    expect(isCurrentDestination("/blog", "blog", languages)).toBe(true);
    expect(isCurrentDestination("/blog/a-post", "blog", languages)).toBe(true);
    expect(isCurrentDestination("/en/blog", "blog", languages)).toBe(true);
    expect(isCurrentDestination("/zh/blog/a-post", "blog", languages)).toBe(true);

    expect(isCurrentDestination("/blog", "home", languages)).toBe(false);
    expect(isCurrentDestination("/blog", "docs", languages)).toBe(false);
    expect(isCurrentDestination("/en/docs", "blog", languages)).toBe(false);
    expect(isCurrentDestination("/en", "blog", languages)).toBe(false);
    expect(isCurrentDestination("/", "blog", languages)).toBe(false);
  });

  test("marks home on every spelling of the home page and nowhere else", () => {
    expect(isCurrentDestination("/", "home", languages)).toBe(true);
    expect(isCurrentDestination("/en", "home", languages)).toBe(true);
    expect(isCurrentDestination("/zh", "home", languages)).toBe(true);
    expect(isCurrentDestination("/blog", "home", languages)).toBe(false);
    expect(isCurrentDestination("/zh/blog", "home", languages)).toBe(false);
  });

  test("owns nothing on paths the navigation does not own", () => {
    for (const destination of navigationDestinations) {
      expect(isCurrentDestination("/sitemap.xml", destination, languages)).toBe(false);
      expect(isCurrentDestination("/nope", destination, languages)).toBe(false);
    }
  });
});
