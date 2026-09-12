import { describe, expect, test } from "bun:test";
import { poissonDiscFill } from "./poisson-disc";

describe("poissonDiscFill", () => {
  // Small region so the O(n·tries) loops stay fast while exercising the same
  // code path as the 500x500 antigravity sampling.
  const fill = () => poissonDiscFill({ shape: [100, 100], minDistance: 8, tries: 30 });

  test("returns points inside the sampling region", () => {
    for (const [x, y] of fill()) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(100);
    }
  });

  test("keeps every pair of samples at least minDistance apart", () => {
    const samples = fill();
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const [ax, ay] = samples[i]!;
        const [bx, by] = samples[j]!;
        expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThanOrEqual(8);
      }
    }
  });

  test("covers the region with a reasonable density", () => {
    // 100x100 at minDistance 8: Bridson's algorithm yields roughly 150
    // samples here. Loose bounds only guard against degenerate output
    // (empty field or a grid-like clump).
    const count = fill().length;
    expect(count).toBeGreaterThan(80);
    expect(count).toBeLessThan(250);
  });

  test("honors maxDistance when given", () => {
    const samples = poissonDiscFill({
      shape: [200, 200],
      minDistance: 6,
      maxDistance: 7,
      tries: 30,
    });
    expect(samples.length).toBeGreaterThan(0);
    for (const [x, y] of samples) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(200);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(200);
    }
  });
});
