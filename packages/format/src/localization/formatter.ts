import yaml from "js-yaml";
import markdownPlugin from "prettier/plugins/markdown";
import { format } from "prettier/standalone";

import { parseFrontmatter } from "../frontmatter";

const PRETTIER_OPTIONS = {
  parser: "markdown" as const,
  plugins: [markdownPlugin],
  endOfLine: "lf" as const,
  proseWrap: "always" as const,
  printWidth: 100,
};

function trimBoundaryBlankLines(value: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  return lines.join("\n");
}

/**
 * Deterministically format a Pack Practice Markdown document. Frontmatter is
 * parsed and emitted with sorted YAML keys, then the complete document is
 * passed through oxfmt's Markdown formatter. Files without frontmatter stay
 * plain Markdown (localized files intentionally carry no runtime metadata).
 */
export async function formatPracticeMarkdown(markdown: string): Promise<string> {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const hasFrontmatter = normalized.startsWith("---\n") || normalized === "---";
  const source = hasFrontmatter
    ? (() => {
        const parsed = parseFrontmatter(normalized);
        const frontmatter = yaml.dump(parsed.data, {
          noRefs: true,
          noCompatMode: true,
          lineWidth: -1,
          sortKeys: true,
        });
        const body = trimBoundaryBlankLines(parsed.content);
        return `---\n${frontmatter}---\n${body ? `\n${body}\n` : ""}`;
      })()
    : normalized;
  const result = await format(source, PRETTIER_OPTIONS);
  return result.endsWith("\n") ? result : `${result}\n`;
}
