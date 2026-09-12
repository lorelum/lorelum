import { describe, expect, test } from "bun:test";
import { shouldRenderWebglAurora, AURORA_MIN_WIDTH, type AuroraGateInput } from "./aurora-gate";

const base: AuroraGateInput = {
  mounted: true,
  dark: true,
  touch: false,
  webgl: true,
  hardwareWebgl: "hardware",
  inView: true,
  viewportWidth: 1440,
};

describe("shouldRenderWebglAurora", () => {
  test("renders on desktop dark with WebGL, hero in view", () => {
    expect(shouldRenderWebglAurora(base)).toBe(true);
  });

  test("renders when renderer is unknown ('unknown') — never degrade an unclassified setup", () => {
    expect(shouldRenderWebglAurora({ ...base, hardwareWebgl: "unknown" })).toBe(true);
  });

  test("disabled under software rendering ('software')", () => {
    expect(shouldRenderWebglAurora({ ...base, hardwareWebgl: "software" })).toBe(false);
  });

  test("never renders during SSR (mounted=false)", () => {
    expect(shouldRenderWebglAurora({ ...base, mounted: false })).toBe(false);
  });

  test("disabled in light theme", () => {
    expect(shouldRenderWebglAurora({ ...base, dark: false })).toBe(false);
  });

  test("disabled on coarse pointer (mobile/tablet)", () => {
    expect(shouldRenderWebglAurora({ ...base, touch: true })).toBe(false);
  });

  test("disabled when WebGL is unavailable", () => {
    expect(shouldRenderWebglAurora({ ...base, webgl: false })).toBe(false);
  });

  test("disabled when hero is scrolled out of view", () => {
    expect(shouldRenderWebglAurora({ ...base, inView: false })).toBe(false);
  });

  test(`disabled below ${AURORA_MIN_WIDTH}px viewport`, () => {
    expect(shouldRenderWebglAurora({ ...base, viewportWidth: AURORA_MIN_WIDTH - 1 })).toBe(false);
  });

  test(`enabled exactly at ${AURORA_MIN_WIDTH}px`, () => {
    expect(shouldRenderWebglAurora({ ...base, viewportWidth: AURORA_MIN_WIDTH })).toBe(true);
  });
});
