import matter from "gray-matter";

/**
 * Result of parsing a markdown file with YAML frontmatter. Mirrors the two
 * fields consumers need from gray-matter; `.excerpt`/`.orig`/`.matter` are
 * intentionally not surfaced (exposing them leaks the parser choice).
 */
export interface ParsedFrontmatter {
  /** Parsed YAML frontmatter. Empty object when the file has no frontmatter. */
  data: Record<string, unknown>;
  /** Markdown body after the frontmatter (delimiters stripped). */
  content: string;
}

/**
 * Parse a markdown string with `---` YAML frontmatter.
 *
 * Thin wrapper over gray-matter — this is the single swap point if we move
 * to `front-matter` (same API shape), per ADR 0002.
 *
 * Malformed YAML propagates the underlying `YAMLException` — this wrapper
 * does not catch it. Callers (CLI/MCP) translate it into user-facing output.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const result = matter(markdown);
  return { data: result.data, content: result.content };
}
