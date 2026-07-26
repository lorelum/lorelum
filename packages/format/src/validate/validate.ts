/**
 * validatePack / validatePractice — the validation entry points.
 *
 * Pipeline: format check (zod safeParse) → reference integrity → cycle
 * detection → warning/info rules → buildReport. Each stage pushes issues
 * into a single flat list; buildReport buckets them by level at the end.
 *
 * Reference and cycle checks only run when format passes — otherwise the
 * data is too broken for semantic checks to produce meaningful signals
 * (e.g. a missing `id` field can't be checked for duplicates).
 */

import type { DecisionNode, Pack, Practice } from "../schema";
import { DecisionNodeSchema, PackSchema, PracticeSchema } from "../schema";
import { detectCycles } from "./cycle";
import { buildReport, issue, type ValidationIssue, type ValidationReport } from "./report";

/** The three sources validate needs: pack.yaml metadata + scanned practices + decisions.yaml. */
export interface UnvalidatedPackInput {
  pack: unknown;
  practices: unknown;
  decisions: unknown;
}

/** A PackInput whose three sources have passed their format schemas. */
export interface PackInput extends UnvalidatedPackInput {
  pack: Pack;
  practices: Practice[];
  decisions: DecisionNode[];
}

const PracticeListSchema = PracticeSchema.array();
const DecisionListSchema = DecisionNodeSchema.array();

/** Turn a zod path array (["branches",0,"recommend"]) into a readable dot path. */
function toDotPath(path: PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out === "" ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
}

function withBasePath(basePath: string, path: PropertyKey[]): string {
  const nestedPath = toDotPath(path);
  if (nestedPath === "(root)") return basePath || nestedPath;
  if (basePath === "") return nestedPath;
  return `${basePath}${nestedPath.startsWith("[") ? "" : "."}${nestedPath}`;
}

/** Convert every zod issue from a failed safeParse into a "format" error issue. */
function zodIssuesToFormatErrors(
  result: { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
  basePath: string,
): ValidationIssue[] {
  return result.error.issues.map((zi) =>
    issue("error", "format", withBasePath(basePath, zi.path), zi.message),
  );
}

/**
 * Validate a full pack. Returns a report bucketed by error/warning/info.
 * Pure: no filesystem, no network, no side effects.
 */
export function validatePack(input: UnvalidatedPackInput): ValidationReport {
  const issues: ValidationIssue[] = [];

  // Stage 1 — format check.
  const packParsed = PackSchema.safeParse(input.pack);
  const practicesParsed = PracticeListSchema.safeParse(input.practices);
  const decisionsParsed = DecisionListSchema.safeParse(input.decisions);
  if (!packParsed.success) {
    issues.push(...zodIssuesToFormatErrors(packParsed, "pack"));
  }
  if (!practicesParsed.success) {
    issues.push(...zodIssuesToFormatErrors(practicesParsed, "practices"));
  }
  if (!decisionsParsed.success) {
    issues.push(...zodIssuesToFormatErrors(decisionsParsed, "decisions"));
  }

  // If anything failed format, stop here — semantic checks would only noise.
  if (!packParsed.success || !practicesParsed.success || !decisionsParsed.success) {
    return buildReport(issues);
  }
  const pack = packParsed.data;
  const practices = practicesParsed.data;
  const decisions = decisionsParsed.data;

  // Stage 2 — reference integrity.
  const practiceIds = new Set<string>();
  const decisionIds = new Set<string>();
  practices.forEach((p, i) => {
    if (practiceIds.has(p.id)) {
      issues.push(
        issue("error", "duplicate-id", `practices[${i}].id`, `duplicate practice id "${p.id}"`),
      );
    } else {
      practiceIds.add(p.id);
    }
  });

  decisions.forEach((d, i) => {
    if (decisionIds.has(d.id)) {
      issues.push(
        issue("error", "duplicate-id", `decisions[${i}].id`, `duplicate decision id "${d.id}"`),
      );
    } else {
      decisionIds.add(d.id);
    }
  });

  // Collect all ids before checking edges so valid forward references are order-independent.
  decisions.forEach((d, i) => {
    d.branches.forEach((b, bi) => {
      b.recommend.forEach((rid) => {
        if (!practiceIds.has(rid)) {
          issues.push(
            issue(
              "error",
              "dangling-ref",
              `decisions[${i}].branches[${bi}].recommend`,
              `recommend "${rid}" matches no practice`,
            ),
          );
        }
      });
      if (b.next !== undefined && !decisionIds.has(b.next)) {
        issues.push(
          issue(
            "error",
            "dangling-ref",
            `decisions[${i}].branches[${bi}].next`,
            `next "${b.next}" matches no decision`,
          ),
        );
      }
    });
  });
  // TODO(v2): Practice→Practice body references (spec §2.3) are not validated
  //   until the in-body reference syntax is defined (ADR 0003 v1 gap).

  // Stage 3 — cycle detection over the `next` edges.
  const edges = new Map<string, string[]>();
  for (const d of decisions) {
    const nexts = d.branches.map((b) => b.next).filter((n): n is string => n !== undefined);
    if (nexts.length > 0) edges.set(d.id, nexts);
  }
  for (const cycle of detectCycles(edges)) {
    issues.push(issue("error", "cycle", "decisions", `cycle detected: ${cycle.join(" → ")}`));
  }

  // Stage 4 — warnings (quality risks).
  if (pack.depends_on !== undefined && pack.depends_on.length > 0) {
    issues.push(
      issue(
        "warning",
        "depends-on-ignored",
        "pack.depends_on",
        "v1 ignores pack-to-pack deps; this field will be ignored",
      ),
    );
  }
  practices.forEach((p, i) => {
    if (p.severity === undefined) {
      issues.push(
        issue(
          "warning",
          "missing-severity",
          `practices[${i}].severity`,
          "severity not set; lore check ordering may degrade",
        ),
      );
    }
    if (p.applies_when.length < 10) {
      issues.push(
        issue(
          "warning",
          "applies-when-too-short",
          `practices[${i}].applies_when`,
          "applies_when shorter than 10 chars; recall may degrade",
        ),
      );
    }
    if (p.body === undefined || p.body.trim() === "") {
      issues.push(
        issue(
          "warning",
          "empty-guidance",
          `practices[${i}].body`,
          "guidance body is empty; nothing to inject",
        ),
      );
    }
  });

  // Stage 5 — infos (advisory).
  const titles = new Map<string, number>();
  practices.forEach((p, i) => {
    const prev = titles.get(p.title);
    if (prev !== undefined) {
      issues.push(
        issue(
          "info",
          "similar-practice",
          `practices[${i}].title`,
          `title identical to practices[${prev}] — possible duplicate`,
        ),
      );
    } else {
      titles.set(p.title, i);
    }
  });
  if (practices.length < 3) {
    issues.push(
      issue(
        "info",
        "small-pack",
        "practices",
        `pack has ${practices.length} practice(s); fewer than 3`,
      ),
    );
  }

  return buildReport(issues);
}

/**
 * Validate a single Practice object. Runs only the format check (no pack
 * context, so no reference or cycle checks). Returns the issue list — empty
 * when valid.
 */
export function validatePractice(practice: unknown): ValidationIssue[] {
  const r = PracticeSchema.safeParse(practice);
  if (r.success) return [];
  return r.error.issues.map((zi) => issue("error", "format", toDotPath(zi.path), zi.message));
}

// Re-export report types so consumers can `import { ValidationReport } from "@lorelum/format"`.
export type { ValidationIssue, ValidationLevel, ValidationReport } from "./report";
