import { describe, expect, test } from "bun:test";

import type { PackInput } from "./validate";
import { validatePack, validatePractice } from "./validate";

/** A happy-path pack: 3 practices + 1 decision with a valid next edge. */
function validPack(): PackInput {
  return {
    pack: { name: "react-fullstack", version: "0.1.0" },
    practices: [
      {
        id: "react.api.layered-design",
        title: "Layered API Design",
        stage: "api-layer",
        tech_stack: ["react", "typescript"],
        applies_when: "building an API layer in a React SPA",
        severity: "warn",
        body: "Concrete guidance.",
      },
      {
        id: "react.state.redux",
        title: "Redux for heavy state",
        stage: "state",
        tech_stack: ["react"],
        applies_when: "managing heavy client-side state at scale",
        severity: "warn",
        body: "Use redux when state is large.",
      },
      {
        id: "react.auth.guard",
        title: "Route guard for auth",
        stage: "auth",
        tech_stack: ["react"],
        applies_when: "protecting routes that require authentication",
        severity: "warn",
        body: "Wrap protected routes.",
      },
    ],
    decisions: [
      {
        id: "state.client-vs-server",
        question: "How much client state?",
        branches: [
          {
            when: "heavy client state",
            recommend: ["react.state.redux"],
            reason: "Redux scales",
          },
        ],
      },
    ],
  };
}

function findCode(
  report: { errors: { code: string }[]; warnings: { code: string }[]; infos: { code: string }[] },
  level: "errors" | "warnings" | "infos",
  code: string,
): boolean {
  return report[level].some((i) => i.code === code);
}

describe("validatePack — happy path", () => {
  test("valid pack returns valid:true with empty buckets", () => {
    const r = validatePack(validPack());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.infos).toEqual([]);
  });
});

describe("validatePack — format errors", () => {
  test("pack missing name", () => {
    const input = validPack();
    // @ts-expect-error: intentionally removing a required field
    delete input.pack.name;
    const r = validatePack(input);
    expect(r.valid).toBe(false);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("practice with non-dotted id", () => {
    const input = validPack();
    input.practices[0]!.id = "notdotted";
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("pack with non-semver version", () => {
    const input = validPack();
    input.pack.version = "1.2";
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("decision branch missing recommend", () => {
    const input = validPack();
    // @ts-expect-error: intentionally removing a required field
    delete input.decisions[0]!.branches[0]!.recommend;
    const r = validatePack(input);
    expect(findCode(r, "errors", "format")).toBe(true);
  });

  test("format errors short-circuit semantic checks (no duplicate-id noise)", () => {
    const input = validPack();
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
    const input = validPack();
    input.practices[1]!.id = input.practices[0]!.id;
    const r = validatePack(input);
    expect(findCode(r, "errors", "duplicate-id")).toBe(true);
  });

  test("branch.recommend dangles (points to no practice)", () => {
    const input = validPack();
    input.decisions[0]!.branches[0]!.recommend = ["does.not.exist"];
    const r = validatePack(input);
    expect(findCode(r, "errors", "dangling-ref")).toBe(true);
  });

  test("branch.next dangles (points to no decision)", () => {
    const input = validPack();
    input.decisions[0]!.branches[0]!.next = "no.such.decision";
    const r = validatePack(input);
    expect(findCode(r, "errors", "dangling-ref")).toBe(true);
  });

  test("decision cycle via next edges", () => {
    const input = validPack();
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
    const input = validPack();
    input.pack.depends_on = ["core"];
    const r = validatePack(input);
    expect(findCode(r, "warnings", "depends-on-ignored")).toBe(true);
  });

  test("practice without severity → missing-severity", () => {
    const input = validPack();
    delete input.practices[0]!.severity;
    const r = validatePack(input);
    expect(findCode(r, "warnings", "missing-severity")).toBe(true);
  });

  test("applies_when shorter than 10 chars → applies-when-too-short", () => {
    const input = validPack();
    input.practices[0]!.applies_when = "short";
    const r = validatePack(input);
    expect(findCode(r, "warnings", "applies-when-too-short")).toBe(true);
  });

  test("empty body → empty-guidance", () => {
    const input = validPack();
    input.practices[0]!.body = "   ";
    const r = validatePack(input);
    expect(findCode(r, "warnings", "empty-guidance")).toBe(true);
  });
});

describe("validatePack — infos", () => {
  test("two practices with identical titles → similar-practice", () => {
    const input = validPack();
    input.practices[1]!.title = input.practices[0]!.title;
    const r = validatePack(input);
    expect(findCode(r, "infos", "similar-practice")).toBe(true);
  });

  test("fewer than 3 practices → small-pack", () => {
    const input = validPack();
    input.practices = input.practices.slice(0, 1)!;
    const r = validatePack(input);
    expect(findCode(r, "infos", "small-pack")).toBe(true);
  });
});

describe("validatePractice", () => {
  test("valid practice returns empty list", () => {
    const issues = validatePractice(validPack().practices[0]);
    expect(issues).toEqual([]);
  });

  test("invalid practice returns format errors", () => {
    const issues = validatePractice({ id: "bad", title: "x" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.code === "format")).toBe(true);
  });
});
