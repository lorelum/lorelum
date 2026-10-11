import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const artwork = readFileSync(
  new URL("../../../../public/blog/covers/practice-injection-measurement.svg", import.meta.url),
  "utf8",
);

describe("measurement article artwork", () => {
  test("is pure geometry: no text, no script, no external reference", () => {
    // The cover follows the reference blog's standard: abstract shapes on a
    // soft gradient, never lettering. Text would also fight the title that the
    // lead entry reveals over the image.
    expect(artwork).not.toMatch(/<text\b|<tspan\b|<script\b|<animate\b|<foreignObject\b|<image\b/);
    expect(artwork).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  test("keeps the subject inside the band every crop shows", () => {
    // The art is 8:5 but is cropped to 21:9 on the lead stage with object-cover,
    // which keeps only the middle 686px of its 1000px height. Everything that
    // matters is inside that band; the gradient bleeds to the edges.
    expect(artwork).toContain('viewBox="0 0 1600 1000"');
    for (const [, cy, r] of artwork.matchAll(/<circle cx="\d+" cy="(\d+)" r="(180|262|300)"/g)) {
      const radius = Number(r);
      if (radius === 180) {
        expect(Number(cy) - radius).toBeGreaterThanOrEqual(157);
        expect(Number(cy) + radius).toBeLessThanOrEqual(843);
      }
    }
  });

  test("is described for assistive technology", () => {
    expect(artwork).toContain('role="img"');
    expect(artwork).toContain("<title");
    expect(artwork).toContain("<desc");
  });
});
