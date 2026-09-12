import { describe, expect, test } from "bun:test";
import { shouldEnableCanvasEffects } from "./motion-gate";

describe("shouldEnableCanvasEffects", () => {
  test("enables for fine pointer", () => {
    expect(shouldEnableCanvasEffects({ finePointer: true })).toBe(true);
  });

  test("disables on touch (coarse pointer)", () => {
    expect(shouldEnableCanvasEffects({ finePointer: false })).toBe(false);
  });
});
