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

export const queryResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "results"],
      properties: {
        mode: { const: "keyword" },
        results: resultsSchema,
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
        results: resultsSchema,
      },
    },
  ],
};
