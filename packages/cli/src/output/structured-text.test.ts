import { expect, test } from "bun:test";

import { renderStructuredText } from "./structured-text.js";

test("renders every JSON-safe shape in a readable tree", () => {
  const text = renderStructuredText({
    id: "practice.example",
    enabled: true,
    count: 2,
    nothing: null,
    emptyString: "",
    emptyArray: [],
    emptyObject: {},
    body: "first\r\nsecond\n",
    nested: { source: "local", labels: ["one", "two"] },
    sources: [{ packName: "agentic-coding", paths: ["a", "b"] }],
  });

  expect(text).toBe(
    [
      "id: practice.example",
      "enabled: true",
      "count: 2",
      "nothing: null",
      'emptyString: ""',
      "emptyArray: []",
      "emptyObject: {}",
      "body: |",
      "  first",
      "  second",
      "  ",
      "nested:",
      "  source: local",
      "  labels:",
      "    - one",
      "    - two",
      "sources:",
      "  -",
      "    packName: agentic-coding",
      "    paths:",
      "      - a",
      "      - b",
    ].join("\n"),
  );
});

test("keeps root scalar and empty collection values visible", () => {
  expect(renderStructuredText(null)).toBe("null");
  expect(renderStructuredText("line")).toBe("line");
  expect(renderStructuredText([])).toBe("[]");
  expect(renderStructuredText({})).toBe("{}");
});
