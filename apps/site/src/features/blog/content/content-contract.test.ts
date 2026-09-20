import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { blogFrontmatterSchema } from "./frontmatter";

/**
 * Authoring contract for blog content.
 *
 * These are the rules a post has to satisfy before it can ship, expressed as
 * assertions rather than as prose in a guide, because each of them is a claim
 * the blog surface makes about itself:
 *
 * - the evidence appendix is a list, never a collapsed card, so a source is
 *   visible without interaction;
 * - the typography rejects italics and decorative "edition"/"overline" chrome;
 * - no positioning copy, which is what the voice rules rule out;
 * - a table of numbers carries the source and sample size next to it;
 * - both locales of a post cover the same sections.
 */

const CONTENT_DIR = new URL("../../../../content/blog/", import.meta.url);

const files = readdirSync(CONTENT_DIR)
  .filter((name) => name.endsWith(".mdx"))
  .sort();

/** `slug.mdx` and `slug.zh.mdx` are the two locales of one post. */
function localePairings() {
  const pairs = new Map<string, { en?: string; zh?: string }>();
  for (const name of files) {
    const zh = name.endsWith(".zh.mdx");
    const slug = name.replace(/\.zh\.mdx$|\.mdx$/, "");
    const entry = pairs.get(slug) ?? {};
    if (zh) entry.zh = name;
    else entry.en = name;
    pairs.set(slug, entry);
  }
  return pairs;
}

function read(name: string) {
  return readFileSync(new URL(name, CONTENT_DIR), "utf8");
}

function frontmatterOf(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  return match?.[1] ?? "";
}

/** The post body with every fenced code block removed. */
function bodyOf(source: string) {
  return source.replace(/```[\s\S]*?```/g, "");
}

const bannedPhrases: readonly [string, RegExp][] = [
  ["positioning verb (未解锁/unlock)", /unlock/i],
  ["marketing adjective (revolutionary)", /revolutionary/i],
  ["laurel claim (industry-leading)", /industry[- ]leading/i],
  ["营销语（重新定义）", /重新定义/],
  ["营销语（无限可能）", /无限可能/],
  ["营销语（行业领先）", /行业领先/],
];

/** Decorative tokens the design system rules out on sight. */
const bannedTokens: readonly [string, RegExp][] = [
  ["italic element", /<em\b|<i\b/],
  ["accordion (a collapsed evidence card)", /<Accordions?\b/],
  ["decorative edition marker", /\bedition\b/i],
  ["decorative overline/eyebrow marker", /overline|eyebrow/i],
  ["signal-dot decoration", /signal-dot/],
];

describe("blog content contract", () => {
  test("there is at least one post, in both locales", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const [slug, pair] of localePairings()) {
      expect(pair.en, `${slug} is missing its English file`).toBeDefined();
      expect(pair.zh, `${slug} is missing its Chinese file`).toBeDefined();
    }
  });

  test("frontmatter validates, and updated is never earlier than date", () => {
    for (const name of files) {
      const parsed = blogFrontmatterSchema.safeParse(
        Object.fromEntries(
          frontmatterOf(read(name))
            .split(/\r?\n/)
            .filter((line) => line.includes(":"))
            .map((line) => {
              const at = line.indexOf(":");
              const key = line.slice(0, at).trim();
              const raw = line.slice(at + 1).trim();
              if (raw === "true" || raw === "false") return [key, raw === "true"];
              return [key, raw];
            }),
        ),
      );
      expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      const data = parsed.data;
      if (data?.updated !== undefined) {
        // A provenance signal that runs backwards would make the metadata line
        // claim the post was revised before it was written.
        expect(data.updated >= data.date, `${name}: updated ${data.updated} < date ${data.date}`).toBe(
          true,
        );
      }
    }
  });

  test("no position-copy phrases or decorative markers", () => {
    for (const name of files) {
      const body = bodyOf(read(name));
      for (const [label, pattern] of [...bannedPhrases, ...bannedTokens]) {
        expect(pattern.test(body), `${name} contains ${label}`).toBe(false);
      }
    }
  });

  test("every external link is https", () => {
    for (const name of files) {
      for (const match of bodyOf(read(name)).matchAll(/\]\((http:\/\/[^)]*)\)/g)) {
        throw new Error(`${name}: insecure external link ${match[1]}`);
      }
    }
  });

  test("a table of numbers carries its source in the line below", () => {
    // The quantitative face of a post is its tables, and that is exactly where
    // a reader needs the sample size and provenance. The caption is a
    // blockquote, so it stays Markdown in the twin as well.
    for (const name of files) {
      const lines = bodyOf(read(name)).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!line.startsWith("|") || !line.includes("---")) continue;
        // Find the end of this table, then check every row for digits.
        let end = i + 1;
        let hasDigits = false;
        while (end < lines.length && (lines[end] ?? "").startsWith("|")) {
          if (/\d/.test(lines[end] ?? "")) hasDigits = true;
          end++;
        }
        if (!hasDigits) continue;
        const after = (lines[end] ?? "").trim();
        const caption = after === "" ? (lines[end + 1] ?? "").trim() : after;
        expect(
          /^>\s*(Source|来源)\s*[:：]/.test(caption),
          `${name}: table ending on line ${end} has numbers but no source caption below it (found ${JSON.stringify(caption)})`,
        ).toBe(true);
      }
    }
  });

  test("both locales of a post cover the same sections", () => {
    for (const [slug, pair] of localePairings()) {
      if (pair.en === undefined || pair.zh === undefined) continue;
      const countOf = (source: string) => (source.match(/^## /gm) ?? []).length;
      const en = countOf(bodyOf(read(pair.en)));
      const zh = countOf(bodyOf(read(pair.zh)));
      // The headings are not translations of each other, so counts are what can
      // be checked mechanically; equal counts keep the two tables of contents
      // comparable for a reader who switches language.
      expect(zh, `${slug}: EN has ${en} sections, ZH has ${zh}`).toBe(en);
    }
  });

  test("the evidence appendix is the blog's own list component", () => {
    for (const name of files) {
      const body = bodyOf(read(name));
      expect(body).toContain("<BlogEvidenceList>");
      // No orphan anchors: the accordions this replaced carried `id="evidence-*"`
      // with no inbound link anywhere in the repository.
      expect(/id="evidence-/.test(body), `${name} reintroduced an orphan evidence anchor`).toBe(
        false,
      );
    }
  });
});
