import { describe, expect, test } from "bun:test";

import { reactPack } from "../fixtures";
import { validatePack, validatePractice } from "./validate";

function findCode(
  report: { errors: { code: string }[]; warnings: { code: string }[]; infos: { code: string }[] },
  level: "errors" | "warnings" | "infos",
  code: string,
): boolean {
  return report[level].some((i) => i.code === code);
}

describe("validatePack — happy path", () => {
  test("valid pack returns valid:true with empty buckets", () => {
    const r = validatePack(reactPack());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.infos).toEqual([]);
  });
});

describe("validatePack — format errors", () => {
  test("pack missing name", () => {
    const input = reactPack();
    // @ts-expect-error: intentionally removing a required field
    delete input.pack.name;
    const r = validatePack(input);
    expect(r.valid).toBe(false);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("practice with non-dotted id", () => {
    const input = reactPack();
    input.practices[0]!.id = "notdotted";
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("pack with non-semver version", () => {
    const input = reactPack();
    input.pack.version = "1.2";
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("decision branch missing recommend", () => {
    const input = reactPack();
    // @ts-expect-error: intentionally removing a required field
    delete input.decisions[0]!.branches[0]!.recommend;
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("format errors short-circuit semantic checks (no duplicate-id noise)", () => {
    const input = reactPack();
    input.pack.version = "not-semver"; // format error
    // also add a duplicate id that would normally be flagged:
    input.practices[1]!.id = input.practices[0]!.id;
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
    expect(findCode(r, "errors", "duplicate-id")).toBe(false);
  });
});

describe("validatePack — reference integrity errors", () => {
  test("duplicate practice id", () => {
    const input = reactPack();
    input.practices[1]!.id = input.practices[0]!.id;
    const r = validatePack(input);
    expect(findCode(r, "errors", "duplicate-id")).toBe(true);
  });

  test("branch.recommend dangles (points to no practice)", () => {
    const input = reactPack();
    input.decisions[0]!.branches[0]!.recommend = ["does.not.exist"];
    const r = validatePack(input);
    expect(findCode(r, "errors", "dangling-ref")).toBe(true);
  });

  test("branch.next dangles (points to no decision)", () => {
    const input = reactPack();
    input.decisions[0]!.branches[0]!.next = "no.such.decision";
    const r = validatePack(input);
    expect(findCode(r, "errors", "dangling-ref")).toBe(true);
  });

  test("decision cycle via next edges", () => {
    const input = reactPack();
    // Three decisions in a cycle: choice-a → choice-b → choice-c → choice-a.
    input.decisions = [
      {
        id: "state.choice-a",
        question: "q",
        branches: [
          { when: "w", recommend: ["react.state.redux"], reason: "r", next: "state.choice-b" },
        ],
      },
      {
        id: "state.choice-b",
        question: "q",
        branches: [
          { when: "w", recommend: ["react.state.redux"], reason: "r", next: "state.choice-c" },
        ],
      },
      {
        id: "state.choice-c",
        question: "q",
        branches: [
          { when: "w", recommend: ["react.state.redux"], reason: "r", next: "state.choice-a" },
        ],
      },
    ];
    const r = validatePack(input);
    expect(findCode(r, "errors", "cycle")).toBe(true);
  });
});

describe("validatePack — warnings", () => {
  test("non-empty depends_on → depends-on-ignored", () => {
    const input = reactPack();
    input.pack.depends_on = ["core"];
    const r = validatePack(input);
    expect(findCode(r, "warnings", "depends-on-ignored")).toBe(true);
  });

  test("practice without severity → missing-severity", () => {
    const input = reactPack();
    delete input.practices[0]!.severity;
    const r = validatePack(input);
    expect(findCode(r, "warnings", "missing-severity")).toBe(true);
  });

  test("applies_when shorter than 10 chars → applies-when-too-short", () => {
    const input = reactPack();
    input.practices[0]!.applies_when = "short";
    const r = validatePack(input);
    expect(findCode(r, "warnings", "applies-when-too-short")).toBe(true);
  });

  test("empty body → empty-guidance", () => {
    const input = reactPack();
    input.practices[0]!.body = "   ";
    const r = validatePack(input);
    expect(findCode(r, "warnings", "empty-guidance")).toBe(true);
  });
});

describe("validatePack — infos", () => {
  test("two practices with identical titles → similar-practice", () => {
    const input = reactPack();
    input.practices[1]!.title = input.practices[0]!.title;
    const r = validatePack(input);
    expect(findCode(r, "infos", "similar-practice")).toBe(true);
  });

  test("fewer than 3 practices → small-pack", () => {
    const input = reactPack();
    input.practices = input.practices.slice(0, 1)!;
    const r = validatePack(input);
    expect(findCode(r, "infos", "small-pack")).toBe(true);
  });
});

describe("validatePractice", () => {
  test("valid practice returns empty list", () => {
    const issues = validatePractice(reactPack().practices[0]);
    expect(issues).toEqual([]);
  });

  test("invalid practice returns format errors", () => {
    const issues = validatePractice({ id: "bad", title: "x" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.code === "format")).toBe(true);
  });
});
