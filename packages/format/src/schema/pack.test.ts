import { describe, expect, test } from "bun:test";

import { PackSchema } from "./pack";

describe("PackSchema", () => {
  test("accepts a minimal pack (name + version)", () => {
    const r = PackSchema.safeParse({ name: "react-fullstack", version: "0.1.0" });
    expect(r.success).toBe(true);
  });

  test("accepts a full pack", () => {
    const r = PackSchema.safeParse({
      name: "react-fullstack",
      version: "1.2.3-beta.1",
      description: "React fullstack pack",
      author: { name: "Lorelum" },
      license: "CC-BY-4.0",
      applies_to: ["react"],
      depends_on: ["core"],
    });
    expect(r.success).toBe(true);
  });

  test("rejects missing name", () => {
    expect(PackSchema.safeParse({ version: "0.1.0" }).success).toBe(false);
  });

  test("rejects missing version", () => {
    expect(PackSchema.safeParse({ name: "react-fullstack" }).success).toBe(false);
  });

  test("rejects non-kebab name", () => {
    expect(PackSchema.safeParse({ name: "React_Fullstack", version: "0.1.0" }).success).toBe(false);
  });

  test("rejects non-semver version", () => {
    expect(PackSchema.safeParse({ name: "react-fullstack", version: "1.2" }).success).toBe(false);
  });
});
