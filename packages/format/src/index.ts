/**
 * @lorelum/format — Practice & Knowledge Pack schema + validation.
 *
 * zod schemas for pack.yaml, Practice frontmatter, Decision Nodes, and
 * anti-patterns; validatePack / validatePractice for the authoring CI tool
 * (format checks, reference integrity, cycle detection, graded reporting);
 * parseFrontmatter thin wrapper over gray-matter; seed fixtures.
 */

export const PACKAGE_NAME = "@lorelum/format";

export * from "./schema";
export * from "./validate";
export * from "./frontmatter";
export * from "./fixtures";
