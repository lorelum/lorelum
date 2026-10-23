import { VECTOR_RETRIEVAL_METHOD_IDS } from "@lorelum/engine";
import { SeverityEnum } from "@lorelum/format";

import type { JsonSchema } from "../output/protocol.js";

const stringSchema: JsonSchema = { type: "string" };
const severitySchema: JsonSchema = { enum: SeverityEnum.options };
const retrievalMethodSchema: JsonSchema = { enum: [...VECTOR_RETRIEVAL_METHOD_IDS] };

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

const emptySchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "nextAction", "message"],
  properties: {
    reason: { enum: ["empty", "corpus-empty"] },
    nextAction: { const: "finish-lookup" },
    message: stringSchema,
  },
};

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
      required: ["state", "retrievalMethod", "preparationId", "message"],
      properties: {
        state: { const: "preparing" },
        retrievalMethod: retrievalMethodSchema,
        preparationId: stringSchema,
        message: stringSchema,
        context: contextSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "state",
        "retrievalMethod",
        "operationId",
        "indexedPracticeCount",
        "totalPracticeCount",
        "message",
      ],
      properties: {
        state: { const: "indexing" },
        retrievalMethod: retrievalMethodSchema,
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
        empty: emptySchema,
        context: contextSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "retrievalMethod", "profileId", "coverage", "results"],
      properties: {
        mode: { const: "semantic" },
        retrievalMethod: retrievalMethodSchema,
        profileId: stringSchema,
        coverage: { enum: ["complete", "partial"] },
        indexedPracticeCount: { type: "integer" },
        totalPracticeCount: { type: "integer" },
        operationId: stringSchema,
        results: resultsSchema,
        empty: emptySchema,
        context: contextSchema,
      },
    },
  ],
};
