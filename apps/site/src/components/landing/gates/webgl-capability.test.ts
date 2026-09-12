import { describe, expect, test } from "bun:test";
import { isSoftwareRenderer } from "./webgl-capability";

describe("isSoftwareRenderer", () => {
  test("flags Windows software fallback (Microsoft Basic Render Driver)", () => {
    expect(isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)")).toBe(
      true,
    );
  });

  test("flags Chrome SwiftShader software GL", () => {
    expect(isSoftwareRenderer("Google SwiftShader (ANGLE)")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Google, SwiftShader Device (ANGLE))")).toBe(true);
  });

  test("flags Mesa llvmpipe software rasterizer", () => {
    expect(isSoftwareRenderer("llvmpipe (LLVM 14.0.0, 256 bits)")).toBe(true);
  });

  test("does not flag real hardware GPUs", () => {
    expect(
      isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11)"),
    ).toBe(false);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)")).toBe(false);
    expect(isSoftwareRenderer("Apple M1 Pro")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11)")).toBe(false);
  });

  test("handles case-insensitively and empty input", () => {
    expect(isSoftwareRenderer("MICROSOFT BASIC RENDER DRIVER")).toBe(true);
    expect(isSoftwareRenderer("")).toBe(false);
  });
});
