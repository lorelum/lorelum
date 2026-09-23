import { describe, expect, test } from "bun:test";
import { coverCells, coverGrid } from "./cover-pattern";

describe("coverCells", () => {
  test("is deterministic for a slug", () => {
    // The pattern is server-rendered and client-rendered, prerendered and
    // rebuilt; any drift would change a post's art between visits.
    expect(coverCells("practice-injection-measurement")).toEqual(
      coverCells("practice-injection-measurement"),
    );
  });

  test("distinguishes different posts", () => {
    const alpha = coverCells("alpha-notes").map((cell) => cell.opacity);
    const beta = coverCells("beta-notes").map((cell) => cell.opacity);

    expect(alpha).not.toEqual(beta);
  });

  test("is seeded by the slug alone, so both locales of one post share art", () => {
    // The signature is `coverCells(slug)`; there is no locale parameter to
    // accidentally pass, and this test is the reason: the zh and en entries of
    // one slug are the same post and their cards carry the same title, so they
    // carry the same art.
    expect(coverCells.length).toBe(1);
  });

  test("fills the grid exactly once, with tiered opacities only", () => {
    const cells = coverCells("practice-injection-measurement");

    expect(cells).toHaveLength(coverGrid.columns * coverGrid.rows);

    const positions = new Set(cells.map((cell) => `${cell.column},${cell.row}`));
    expect(positions.size).toBe(cells.length);

    for (const cell of cells) {
      expect(cell.column).toBeGreaterThanOrEqual(0);
      expect(cell.column).toBeLessThan(coverGrid.columns);
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(coverGrid.rows);
      expect((coverGrid.tiers as readonly number[])).toContain(cell.opacity);
    }
  });

  test("keeps the pattern calm: most cells faint, a few lit", () => {
    // The cover is decoration beside a title, so the distribution matters as
    // much as the vocabulary: mostly-faint with two or three lit cells reads as
    // a field; half lit would read as noise.
    const opacities = coverCells("practice-injection-measurement").map((cell) => cell.opacity);
    const [faint, , , high] = coverGrid.tiers;

    const lit = opacities.filter((value) => value === high).length;
    const quiet = opacities.filter((value) => value === faint).length;

    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(4);
    expect(quiet).toBeGreaterThan(opacities.length / 3);
  });
});
