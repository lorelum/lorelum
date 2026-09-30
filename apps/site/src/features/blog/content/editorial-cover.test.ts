import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const artwork = readFileSync(
  new URL("../../../../public/blog/covers/practice-injection-measurement.svg", import.meta.url),
  "utf8",
);

describe("measurement article artwork", () => {
  test("depicts three equally sized comparison paths, not numerical results", () => {
    expect(artwork).toContain('viewBox="0 0 1200 750"');
    for (const verticalPosition of [168, 333, 498]) {
      expect(artwork).toContain(`x="432" y="${verticalPosition}" width="84" height="84"`);
      expect(artwork).toContain(`x="744" y="${verticalPosition}" width="84" height="84"`);
    }
    expect(artwork).not.toMatch(/<text\b|<script\b|<animate\b|<foreignObject\b/);
    expect(artwork).not.toMatch(/oracle_precision|delta_lift|https?:\/\/(?!www\.w3\.org)/);
  });
});
