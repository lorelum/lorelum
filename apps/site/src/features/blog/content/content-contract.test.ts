import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { blogFrontmatterSchema } from "./frontmatter";

/** Checks authored content validity and reachable assets, not component spellings. */

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
        expect(
          data.updated >= data.date,
          `${name}: updated ${data.updated} < date ${data.date}`,
        ).toBe(true);
      }
    }
  });

  test("authored covers resolve to site-public assets", () => {
    for (const name of files) {
      const image = frontmatterOf(read(name)).match(/^image:\s*(\/[^\s]+)$/m)?.[1];
      if (image === undefined) continue;
      expect(
        existsSync(new URL(`../../../../public${image}`, import.meta.url)),
        `${name}: ${image}`,
      ).toBe(true);
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
});
