import { SeverityEnum } from "@lorelum/format";

import type { JsonSchema } from "../output/protocol.js";

const stringSchema: JsonSchema = { type: "string" };
const severitySchema: JsonSchema = { enum: SeverityEnum.options };

/** The canonical runtime Practice has defaults expanded by LocalStore. */
export const getResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["practice", "contentDigest", "sources"],
  properties: {
    practice: {
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
        id: stringSchema,
        title: stringSchema,
        stage: stringSchema,
        tech_stack: { type: "array", items: stringSchema },
        applies_when: stringSchema,
        severity: severitySchema,
        body: stringSchema,
        anti_patterns: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "description", "severity"],
            properties: {
              id: stringSchema,
              name: stringSchema,
              description: stringSchema,
              severity: severitySchema,
            },
          },
        },
      },
    },
    contentDigest: stringSchema,
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["packName", "sourcePath"],
        properties: { packName: stringSchema, sourcePath: stringSchema },
      },
    },
  },
};
