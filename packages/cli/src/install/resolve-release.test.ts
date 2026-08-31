import { describe, expect, test } from "bun:test";

import { RegistrySchema } from "@lorelum/format";

import { resolveRegistryRelease } from "./resolve-release.js";

function registry() {
  return RegistrySchema.parse({
    schema_version: 1,
    name: "lorelum-official",
    packs: [
      {
        name: "agentic-coding",
        releases: [
          { version: "2.0.0-beta.2", ref: "v2-beta", path: "packs/agentic-coding" },
          { version: "1.2.0", ref: "v1.2", path: "packs/agentic-coding" },
          { version: "1.10.0", ref: "v1.10", path: "packs/agentic-coding" },
          { version: "1.0.0", ref: "v1", path: "packs/agentic-coding" },
        ],
      },
    ],
  });
}

describe("resolveRegistryRelease", () => {
  test("selects the highest stable semver independent of YAML order", () => {
    expect(resolveRegistryRelease(registry(), "agentic-coding").release.version).toBe("1.10.0");
  });

  test("selects an explicitly requested prerelease", () => {
    expect(
      resolveRegistryRelease(registry(), "agentic-coding", "2.0.0-beta.2").release.version,
    ).toBe("2.0.0-beta.2");
  });

  test("does not fall back when an exact version is absent", () => {
    expect(() => resolveRegistryRelease(registry(), "agentic-coding", "9.0.0")).toThrow(
      'no release for version "9.0.0"',
    );
  });
});
