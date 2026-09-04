import type { JsonSchema } from "./protocol.js";

export const stringSchema: JsonSchema = { type: "string" };
export const stringArraySchema: JsonSchema = { type: "array", items: stringSchema };

/** Canonical severity values shared by Practice and anti-pattern schemas. */
export const severitySchema: JsonSchema = { enum: ["info", "warn", "critical"] };

/** One LocalStore source claim projected for retrieval consumers. */
export const sourceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pack", "sourcePath"],
  properties: { pack: stringSchema, sourcePath: stringSchema },
};

/** One structured anti-pattern in canonical get output. */
export const antiPatternSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "description", "severity"],
  properties: {
    id: stringSchema,
    name: stringSchema,
    description: stringSchema,
    severity: severitySchema,
  },
};

/** Summary Practice fields shared by retrieval result schemas (ADR 0010). */
export const practiceSummarySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "stage", "tech_stack", "applies_when"],
  properties: {
    id: stringSchema,
    title: stringSchema,
    stage: stringSchema,
    tech_stack: stringArraySchema,
    applies_when: stringSchema,
  },
};

/** Complete canonical Practice returned by `lore get` (ADR 0011). */
export const getPracticeSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "title",
    "stage",
    "tech_stack",
    "applies_when",
    "severity",
    "body",
    "anti_patterns",
  ],
  properties: {
    ...practiceSummarySchema.properties,
    severity: severitySchema,
    body: stringSchema,
    anti_patterns: { type: "array", items: antiPatternSchema },
  },
};
