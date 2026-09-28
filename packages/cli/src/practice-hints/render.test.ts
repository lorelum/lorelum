import { expect, test } from "bun:test";
import type { ReadHint } from "@lorelum/backend/client";

import { renderReadHints } from "./render";

test("keeps subagent candidate context bounded and metadata-only", () => {
  const hints: ReadHint[] = Array.from({ length: 50 }, (_, index) => ({
    id: `sample.practice-${index}`,
    digest: `private-digest-${index}`,
    title: "A".repeat(200),
    appliesWhen: "B".repeat(200),
  }));
  const rendered = renderReadHints(hints);
  expect(rendered).toBeDefined();
  expect(rendered!.length).toBeLessThanOrEqual(1800);
  expect(rendered).toContain("sample.practice-0");
  expect(rendered).not.toContain("sample.practice-49");
  expect(rendered).not.toContain("private-digest");
  expect(rendered).not.toContain("packName");
});
