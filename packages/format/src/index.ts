/**
 * @lorelum/format — Practice & Knowledge Pack schema (the public contract).
 *
 * zod schemas for pack.yaml, Practice frontmatter, Decision Nodes, and
 * anti-patterns. Validation (reference integrity, cycle detection,
 * severity-graded reports) lands in a follow-up.
 */

export const PACKAGE_NAME = "@lorelum/format";

export * from "./schema";
