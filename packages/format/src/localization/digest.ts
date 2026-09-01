import { createHash } from "node:crypto";

import { formatPracticeMarkdown } from "./formatter";

/** SHA-256 over UTF-8 bytes of the deterministic formatted canonical file. */
export async function computeLocalizationSourceDigest(markdown: string): Promise<string> {
  const formatted = await formatPracticeMarkdown(markdown);
  const digest = createHash("sha256").update(new TextEncoder().encode(formatted)).digest("hex");
  return `sha256:${digest}`;
}
