import { SeverityEnum } from "@lorelum/format";

import type { JsonSchema } from "../output/protocol.js";

const stringSchema: JsonSchema = { type: "string" };
const severitySchema: JsonSchema = { enum: SeverityEnum.options };

export const queryResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "results"],
  properties: {
    mode: { const: "keyword" },
    results: {
      type: "array",
      items: {
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
      },
    },
  },
};
