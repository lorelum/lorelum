import { describe, expect, test } from "bun:test";

import { computeLocalizationSourceDigest } from "./digest";
import { formatPracticeMarkdown } from "./formatter";

describe("Practice Markdown formatter and digest", () => {
  test("normalizes frontmatter ordering, line endings, and surrounding blanks", async () => {
    const first = "---\ntitle: Example\nid: a.b\n---\n\n# Heading\n\nHello world\n";
    const mechanical =
      "---\r\nid: a.b\r\ntitle: Example\r\n---\r\n\r\n\r\n# Heading\r\n\r\nHello   world";
    expect(await formatPracticeMarkdown(mechanical)).toBe(await formatPracticeMarkdown(first));
    const formatted = await formatPracticeMarkdown(first);
    expect(await formatPracticeMarkdown(formatted)).toBe(formatted);
  });

  test("digest is stable for mechanical differences and changes for content", async () => {
    const first = "---\ntitle: Example\nid: a.b\n---\n\n# Heading\n\nBody\n";
    const mechanical = "---\r\nid: a.b\r\ntitle: Example\r\n---\r\n# Heading\r\n\r\nBody";
    expect(await computeLocalizationSourceDigest(first)).toBe(
      await computeLocalizationSourceDigest(mechanical),
    );
    expect(await computeLocalizationSourceDigest(first)).not.toBe(
      await computeLocalizationSourceDigest(first.replace("Body", "Changed")),
    );
  });

  test("formats Markdown without frontmatter without inventing runtime metadata", async () => {
    expect(await formatPracticeMarkdown("\r\n# Localized\r\n\r\nText\r\n")).toBe(
      "# Localized\n\nText\n",
    );
  });
});
