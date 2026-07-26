import matter from "gray-matter";
import { parse } from "yaml";

const yamlParseOptions = {
  maxAliasCount: 100,
  prettyErrors: false,
  strict: true,
  uniqueKeys: true,
} as const;

const yamlEngine = {
  parse: (source: string): object => parseYamlDocument(source) as object,
};

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
 * gray-matter owns delimiter extraction only. YAML values are parsed by the
 * same eemeli/yaml engine and limits as standalone pack documents.
 *
 * Malformed YAML propagates the parser error. Callers (CLI/MCP) translate it
 * into user-facing output.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const result = matter(markdown, { engines: { yaml: yamlEngine } });
  return { data: result.data, content: result.content };
}

/** Parse a standalone YAML document using the same YAML engine as frontmatter. */
export function parseYamlDocument(source: string): unknown {
  return parse(source, yamlParseOptions);
}
