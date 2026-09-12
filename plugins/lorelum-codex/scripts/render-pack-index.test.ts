import { describe, expect, test } from "bun:test";

import { renderPackIndex } from "./render-pack-index";

describe("renderPackIndex", () => {
  test("renders an explicit empty state", () => {
    expect(renderPackIndex([])).toContain("No installed Knowledge Packs");
  });

  test("sorts, deduplicates, and normalizes summaries", () => {
    const output = renderPackIndex([
      {
        name: "react-fullstack",
        version: "0.1.0",
        appliesTo: ["react", "typescript"],
        description: "React\nengineering   practices.",
      },
      {
        name: "agentic-coding",
        version: "0.2.0",
        appliesTo: ["agentic-coding"],
      },
      {
        name: "react-fullstack",
        version: "9.9.9",
        appliesTo: [],
      },
    ]);

    expect(output.indexOf("agentic-coding")).toBeLessThan(output.indexOf("react-fullstack"));
    expect(output.match(/react-fullstack/g)).toHaveLength(1);
    expect(output).toContain("Description: React engineering practices.");
  });

  test("honors the context budget", () => {
    const output = renderPackIndex(
      [{ name: "frontend", version: "0.1.0", appliesTo: [], description: "x".repeat(500) }],
      { maxCharacters: 128 },
    );
    expect(output.length).toBeLessThanOrEqual(128);
    expect(output).toContain("Pack Index truncated");
  });
});
