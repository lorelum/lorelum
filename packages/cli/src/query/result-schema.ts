import { SeverityEnum } from "@lorelum/format";

import type { JsonSchema } from "../output/protocol.js";

const stringSchema: JsonSchema = { type: "string" };
const severitySchema: JsonSchema = { enum: SeverityEnum.options };

const queryHitSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "practiceId",
    "title",
    "stage",
    "techStack",
    "appliesWhen",
    "severity",
    "contentDigest",
  ],
  properties: {
    practiceId: stringSchema,
    title: stringSchema,
    stage: stringSchema,
    techStack: { type: "array", items: stringSchema },
    appliesWhen: stringSchema,
    severity: severitySchema,
    contentDigest: stringSchema,
  },
};

const resultsSchema: JsonSchema = { type: "array", items: queryHitSchema };

const contextWarningSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "layerDepth"],
  properties: {
    code: { enum: ["config.invalid", "pack.invalid", "practice.invalid", "source.unsafe"] },
    layerDepth: { type: "integer" },
    packName: stringSchema,
    practiceId: stringSchema,
  },
};

const contextSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "warnings"],
  properties: {
    state: { enum: ["ready", "degraded"] },
    warnings: { type: "array", items: contextWarningSchema },
  },
};

export const queryResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "preparationId", "message"],
      properties: {
        state: { const: "preparing" },
        preparationId: stringSchema,
        message: stringSchema,
        context: contextSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "operationId", "indexedPracticeCount", "totalPracticeCount", "message"],
      properties: {
        state: { const: "indexing" },
        operationId: stringSchema,
        indexedPracticeCount: { type: "integer" },
        totalPracticeCount: { type: "integer" },
        message: stringSchema,
        context: contextSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "results"],
      properties: {
        mode: { const: "keyword" },
        results: resultsSchema,
        context: contextSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "profileId", "coverage", "results"],
      properties: {
        mode: { const: "semantic" },
        profileId: stringSchema,
        coverage: { enum: ["complete", "partial"] },
        indexedPracticeCount: { type: "integer" },
        totalPracticeCount: { type: "integer" },
        operationId: stringSchema,
        results: resultsSchema,
        context: contextSchema,
      },
    },
  ],
};
