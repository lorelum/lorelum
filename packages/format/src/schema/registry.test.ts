import { describe, expect, test } from "bun:test";

import { RegistrySchema } from "./registry";

function registry(): {
  schema_version: 1;
  name: string;
  extra?: boolean;
  packs: Array<{
    name: string;
    releases: Array<{ version: string; ref: string; path: string }>;
  }>;
} {
  return {
    schema_version: 1,
    name: "lorelum-official",
    packs: [
      {
        name: "agentic-coding",
        releases: [
          {
            version: "0.1.0",
            ref: "agentic-coding-v0.1.0",
            path: "packs/agentic-coding",
          },
        ],
      },
    ],
  };
}

describe("RegistrySchema", () => {
  test("accepts a version, ref, and Pack path", () => {
    expect(RegistrySchema.parse(registry()).packs[0]?.releases[0]?.version).toBe("0.1.0");
  });

  test("rejects unknown fields", () => {
    const input = registry();
    input.extra = true;
    expect(RegistrySchema.safeParse(input).success).toBe(false);
  });

  test("rejects duplicate pack names", () => {
    const input = registry();
    input.packs.push(structuredClone(input.packs[0]!));
    const result = RegistrySchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("duplicate pack"))).toBe(
        true,
      );
    }
  });

  test("rejects duplicate semver precedence", () => {
    const input = registry();
    input.packs[0]!.releases.push({
      version: "0.1.0+rebuilt",
      ref: "rebuilt",
      path: "packs/agentic-coding",
    });
    expect(RegistrySchema.safeParse(input).success).toBe(false);
  });

  test("rejects numeric prerelease identifiers with leading zeros", () => {
    const input = registry();
    input.packs[0]!.releases[0]!.version = "1.0.0-01";
    expect(RegistrySchema.safeParse(input).success).toBe(false);
  });

  test("rejects traversal paths and malformed refs", () => {
    const badPath = registry();
    badPath.packs[0]!.releases[0]!.path = "packs/../agentic-coding";
    expect(RegistrySchema.safeParse(badPath).success).toBe(false);

    const badRef = registry();
    badRef.packs[0]!.releases[0]!.ref = "refs//main";
    expect(RegistrySchema.safeParse(badRef).success).toBe(false);
  });
});
