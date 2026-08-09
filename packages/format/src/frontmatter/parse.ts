import matter from "gray-matter";
import yaml from "js-yaml";

/**
 * This module is the workspace's single YAML dependency point. Both
 * `parseFrontmatter` (via gray-matter) and `parseYaml` run the same js-yaml
 * engine; switching YAML libraries (per ADR 0002) means changing this one
 * file and `@lorelum/format`'s declared dependency, nothing else.
 */

// Pack files are external input. js-yaml 4.x never instantiates custom JS
// types and bounds merge keys, but it resolves aliases lazily — a bomb
// document parses fine and only explodes on the first full traversal by a
// consumer. These guardrails reject both bomb shapes before that happens.
const MAX_YAML_INPUT_BYTES = 512 * 1024;
const MAX_ALIAS_REUSES = 16;
const MAX_STRUCTURE_NODES = 100_000;
const MAX_STRUCTURE_DEPTH = 64;

function assertInputSize(text: string): void {
  // TextEncoder is a Web-standard global (available in Bun and Node), so the
  // format package does not depend on Node-specific globals.
  if (new TextEncoder().encode(text).length > MAX_YAML_INPUT_BYTES) {
    throw new RangeError(`YAML input exceeds ${MAX_YAML_INPUT_BYTES} bytes`);
  }
}

/**
 * Reject documents whose shared subtrees would expand exponentially on
 * traversal. A parsed object may be re-reached via YAML aliases at most
 * `MAX_ALIAS_REUSES` times (its first definition visit does not count);
 * normal Pack files never share subtrees, so this only ever trips on alias
 * bombs.
 */
function assertAliasBudget(value: unknown): void {
  const visits = new Map<object, number>();
  let nodes = 0;
  function walk(node: unknown, depth: number): void {
    if (typeof node !== "object" || node === null) return;
    if (depth > MAX_STRUCTURE_DEPTH) {
      throw new RangeError("YAML document exceeds the nesting depth budget");
    }
    const previous = visits.get(node);
    if (previous !== undefined) {
      // previous counts total visits including the first; reuse budget is
      // exhausted when the next visit would be the (MAX_ALIAS_REUSES + 1)th.
      if (previous > MAX_ALIAS_REUSES) {
        throw new RangeError("YAML document exceeds the alias reference budget");
      }
      visits.set(node, previous + 1);
    } else {
      visits.set(node, 1);
    }
    nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES) {
      throw new RangeError("YAML document exceeds the structure node budget");
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
    } else {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) walk(record[key], depth + 1);
    }
  }
  walk(value, 0);
}

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
 * to `front-matter` (same API shape), per ADR 0002. The YAML engine is
 * overridden with the same guarded parser `parseYaml` uses, so frontmatter
 * gets identical safety without depending on gray-matter's internal defaults.
 *
 * Malformed YAML propagates the underlying `YAMLException` — this wrapper
 * does not catch it. Callers (CLI/MCP) translate it into user-facing output.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const result = matter(markdown, {
    // Override gray-matter's YAML engine with the guarded parser and a
    // matching serializer. js-yaml 4.x removed safeLoad/safeDump, so the
    // default engine would throw on either path; ours keeps parse and
    // stringify consistent and both on the same engine.
    engines: {
      yaml: {
        // gray-matter's engine interface types the parse result as `object`;
        // the guarded parser returns `unknown` because the input is untrusted.
        parse: (input: string) => parseYaml(input) as object,
        // Output path: data is trusted (already validated), so no guardrails.
        stringify: (data: object) => yaml.dump(data),
      },
    },
  });
  return { data: result.data, content: result.content };
}

/** Parse a standalone YAML document used by Pack metadata. */
export function parseYaml(text: string): unknown {
  assertInputSize(text);
  // js-yaml 4.x's `load` is safe by default: no JS-type tags, bounded merge
  // keys, bounded nesting depth. (`safeLoad` was removed in 4.x.)
  const value = yaml.load(text);
  assertAliasBudget(value);
  return value;
}
