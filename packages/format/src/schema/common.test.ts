import { describe, expect, test } from "bun:test";

import { AuthorSchema, ID_REGEX, PACK_NAME_REGEX, SEMVER_REGEX, SeverityEnum } from "./common";

describe("ID_REGEX", () => {
  test.each([
    "react.api.layered-design",
    "a.b",
    "a.b.c",
    "api.direct-axios-in-component",
    "state.client-vs-server",
  ])("accepts %p", (id) => {
    expect(ID_REGEX.test(id)).toBe(true);
  });

  test.each([
    "React.api", // uppercase
    "react..api", // empty segment
    "react", // single segment
    "react.api.", // trailing dot
    ".react.api", // leading dot
    "react.api_x", // underscore
    "", // empty
  ])("rejects %p", (id) => {
    expect(ID_REGEX.test(id)).toBe(false);
  });
});

describe("PACK_NAME_REGEX", () => {
  test.each(["react-fullstack", "react", "a", "go-kit-v2"])("accepts %p", (name) => {
    expect(PACK_NAME_REGEX.test(name)).toBe(true);
  });

  test.each(["React", "react_fullstack", "react--x", ""])("rejects %p", (name) => {
    expect(PACK_NAME_REGEX.test(name)).toBe(false);
  });
});

describe("SEMVER_REGEX", () => {
  test.each(["0.1.0", "1.2.3", "1.2.3-beta.1", "0.0.0+build.1", "1.0.0-alpha+x"])(
    "accepts %p",
    (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(true);
    },
  );

  test.each(["1.2", "v1.2.3", "01.2.3", "1.2.3.beta", ""])("rejects %p", (v) => {
    expect(SEMVER_REGEX.test(v)).toBe(false);
  });
});

describe("SeverityEnum", () => {
  test("accepts the three levels", () => {
    expect(SeverityEnum.safeParse("info").success).toBe(true);
    expect(SeverityEnum.safeParse("warn").success).toBe(true);
    expect(SeverityEnum.safeParse("critical").success).toBe(true);
  });

  test("rejects other values", () => {
    expect(SeverityEnum.safeParse("error").success).toBe(false);
  });
});

describe("AuthorSchema", () => {
  test("accepts a string", () => {
    expect(AuthorSchema.safeParse("Jane Doe").success).toBe(true);
  });

  test("accepts an object with name", () => {
    expect(AuthorSchema.safeParse({ name: "Jane Doe" }).success).toBe(true);
  });

  test("rejects an object without name", () => {
    expect(AuthorSchema.safeParse({ handle: "jane" }).success).toBe(false);
  });
});
