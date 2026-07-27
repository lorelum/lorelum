import { expect, test } from "bun:test";

import { createPackCandidate } from "../../model";
import { createProjection, parseProjection, serializeProjection } from "./projection";

test("projection records canonical source data in source-path order", () => {
  const { candidate } = createPackCandidate(
    {
      pack: { name: "platform", version: "1.0.0", applies_to: ["typescript"] },
      practices: [
        {
          id: "platform.second",
          title: "Second",
          stage: "api",
          tech_stack: ["typescript"],
          applies_when: "always",
        },
        {
          id: "platform.first",
          title: "First",
          stage: "api",
          tech_stack: ["typescript"],
          applies_when: "always",
        },
      ],
      decisions: [],
    },
    {
      "platform.second": "practices/z.md",
      "platform.first": "practices/a.md",
    },
  );
  const projection = createProjection(candidate.pack, candidate.sources);

  expect(projection.practices.map((practice) => practice.sourcePath)).toEqual([
    "practices/a.md",
    "practices/z.md",
  ]);
  const parsed = parseProjection(serializeProjection(projection), "snapshot");
  expect(parsed).toEqual(projection);
  expect(Object.isFrozen(parsed.pack.applies_to)).toBe(true);
});

test("projection rejects untrusted JSON shapes", () => {
  expect(() =>
    parseProjection('{"projectionVersion":1,"pack":{},"practices":[{}]}', "snapshot"),
  ).toThrow("projection Pack metadata is invalid");
});

test("projection rejects a forged canonical payload or unsafe source metadata", () => {
  expect(() =>
    parseProjection(
      '{"projectionVersion":1,"pack":{"name":"platform","version":"1.0.0"},"practices":[{"id":"platform.api","contentDigest":"' +
        "a".repeat(64) +
        '","canonicalContent":"{}","sourcePath":"../api.md"}]}',
      "snapshot",
    ),
  ).toThrow("projection canonical content violates Practice schema");
});
