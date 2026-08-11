/**
 * Canonical JSON Schemas for the decide result contract (single source).
 * The CLI `describe` metadata and future MCP adapters reference these instead
 * of re-declaring the engine contract (ADR 0008 §6).
 */

import type { JsonSchema } from "@lorelum/shared";

const stringSchema: JsonSchema = { type: "string" };

/** Trace entry schema; mirrors the DecisionTraceEntry shape. */
export const decisionTraceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decisionId", "question", "matchedWhen", "nextDecision"],
  properties: {
    decisionId: stringSchema,
    question: stringSchema,
    matchedWhen: { oneOf: [stringSchema, { const: null }] },
    nextDecision: { oneOf: [stringSchema, { const: null }] },
  },
};

/** Recommendation schema; mirrors the DecisionRecommendation shape. */
export const decisionRecommendationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["practiceId", "reasons"],
  properties: {
    practiceId: stringSchema,
    reasons: { type: "array", items: stringSchema },
  },
};

/** Recommendations list shared by both result branches (always empty under no_match). */
const decisionRecommendationsSchema: JsonSchema = {
  type: "array",
  items: decisionRecommendationSchema,
};

/** Ordered trace list shared by both result branches. */
const decisionTraceListSchema: JsonSchema = {
  type: "array",
  items: decisionTraceSchema,
};

/** Result envelope: matched or no_match (no_match adds noMatchReason). */
export const decisionResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "entryDecision", "recommendations", "trace"],
      properties: {
        status: { const: "matched" },
        entryDecision: stringSchema,
        recommendations: decisionRecommendationsSchema,
        trace: decisionTraceListSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "entryDecision", "recommendations", "trace", "noMatchReason"],
      properties: {
        status: { const: "no_match" },
        entryDecision: stringSchema,
        recommendations: decisionRecommendationsSchema,
        trace: decisionTraceListSchema,
        noMatchReason: stringSchema,
      },
    },
  ],
};
