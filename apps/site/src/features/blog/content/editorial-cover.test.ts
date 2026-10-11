import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const artwork = readFileSync(
  new URL("../../../../public/blog/covers/practice-injection-measurement.svg", import.meta.url),
  "utf8",
);

describe("measurement article artwork", () => {
  test("depicts three equally sized comparison paths, not numerical results", () => {
    expect(artwork).toContain('viewBox="0 0 1200 750"');
    for (const condition of ["baseline", "placebo", "oracle"]) {
      expect(artwork).toContain(`data-condition="${condition}"`);
      expect(artwork).toContain(`>${condition.toUpperCase()}</text>`);
    }
    expect(artwork.match(/width="520" height="96"/g)).toHaveLength(3);
    // Full-bleed: a ground rect covers the whole viewBox, with no inner plate
    // or rounded corner that would show a seam when the cover is cropped.
    expect(artwork).toContain('<rect width="1200" height="750" fill="url(#ground)"/>');
    expect(artwork).not.toMatch(/<rect width="1200" height="750" rx=/);
    expect(artwork).not.toMatch(/<script\b|<animate\b|<foreignObject\b/);
    expect(artwork).not.toMatch(/oracle_precision|delta_lift|https?:\/\/(?!www\.w3\.org)/);
  });

  test("explains the real intervention without implying numerical outcomes", () => {
    for (const label of ["Same task", "Three contexts", "Same criteria", "No Practice", "Unrelated Practice", "Relevant Practice", "not measured results"]) {
      expect(artwork).toContain(label);
    }
    expect(artwork).toContain('data-stage="task"');
    expect(artwork).toContain('data-stage="evaluation"');
    expect(artwork).toContain("aria-labelledby=");
    expect(artwork).toContain("<desc");
    expect(artwork).not.toMatch(/\d+(?:\.\d+)?\s*%|<image\b|<a\b|<iframe\b/);
  });
});
