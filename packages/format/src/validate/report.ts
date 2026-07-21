/**
 * Validation report shape — consumed by validate.ts and (later) by the CLI
 * `lore validate` command and MCP server to format output. Pure types plus a
 * small constructor; no validation logic lives here.
 */

export type ValidationLevel = "error" | "warning" | "info";

export interface ValidationIssue {
  /** Severity bucket. */
  level: ValidationLevel;
  /** Machine-readable code, e.g. "format" / "dangling-ref" / "cycle". */
  code: string;
  /** Dot path to the offending location, e.g. "practices[1].applies_when". */
  path: string;
  /** Human-readable explanation. */
  message: string;
}

export interface ValidationReport {
  /** True iff errors is empty — warnings/infos never affect validity. */
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
}

/** Convenience constructor: pack a level+code+path+message into an issue. */
export function issue(
  level: ValidationLevel,
  code: string,
  path: string,
  message: string,
): ValidationIssue {
  return { level, code, path, message };
}

/** Bucket a flat issue list into a report. valid is derived from errors.length. */
export function buildReport(allIssues: ValidationIssue[]): ValidationReport {
  const errors = allIssues.filter((i) => i.level === "error");
  const warnings = allIssues.filter((i) => i.level === "warning");
  const infos = allIssues.filter((i) => i.level === "info");
  return { valid: errors.length === 0, errors, warnings, infos };
}
