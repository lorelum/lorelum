import { describe, expect, test } from "bun:test";

import { canonicalContent, contentDigest, normalizeSnapshotPath } from "./canonicalize";
import { InvalidPreparedPackError } from "./errors";

const practice = {
  id: "react.api.layered-design",
  title: "Layered API Design",
  stage: "api-layer",
  tech_stack: ["react", "typescript"],
  applies_when: "building an API layer in a React SPA",
  body: "Use a client\r\nwith clear module boundaries.\r",
};

describe("LocalStore canonical content", () => {
  test("normalizes line endings and expands the Practice severity default", () => {
    expect(canonicalContent(practice)).toBe(
      JSON.stringify({
        id: "react.api.layered-design",
        title: "Layered API Design",
        stage: "api-layer",
        tech_stack: ["react", "typescript"],
        applies_when: "building an API layer in a React SPA",
        severity: "warn",
        body: "Use a client\nwith clear module boundaries.\n",
        anti_patterns: [],
      }),
    );
  });

  test("treats omitted severity and explicit warn as the same Practice content", () => {
    expect(contentDigest(practice)).toBe(contentDigest({ ...practice, severity: "warn" }));
  });

  test("retains array order as part of canonical Practice content", () => {
    expect(contentDigest(practice)).not.toBe(
      contentDigest({ ...practice, tech_stack: ["typescript", "react"] }),
    );
  });

  test("rejects Windows drive paths as snapshot-relative paths", () => {
    expect(() => normalizeSnapshotPath("C:\\outside.md")).toThrow(InvalidPreparedPackError);
  });
});
