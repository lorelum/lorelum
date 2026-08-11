/**
 * `lore decide` command: owns argument parsing and pack loading only;
 * evaluation is the pure engine call (ADR 0008 §1).
 */
import { evaluateDecisions } from "@lorelum/engine";

import type { JsonSchema } from "../output/protocol.js";
import type { CommandDefinition, CommandOption } from "../registry.js";
import { cliErrorCodes, frameworkErrorCodes, invalidInvocationError } from "../runtime/errors.js";
import { readDecisionsDocument } from "./load.js";

/** Required options for one decide invocation: entry decision id and structured context JSON. */
const decideOptions: readonly CommandOption[] = [
  {
    longFlag: "--decision",
    description: "Decision node id at which evaluation starts.",
    value: { name: "id", required: true },
    optionRequired: true,
  },
  {
    longFlag: "--context",
    description: "Structured JSON object used to evaluate conditions.",
    value: { name: "json", required: true },
    optionRequired: true,
  },
];

/** Trace entry schema, mirroring the engine DecisionTraceEntry shape. */
const decisionTraceSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decisionId", "question", "matchedWhen", "nextDecision"],
  properties: {
    decisionId: { type: "string" },
    question: { type: "string" },
    matchedWhen: { oneOf: [{ type: "string" }, { const: null }] },
    nextDecision: { oneOf: [{ type: "string" }, { const: null }] },
  },
};
/** Recommendation schema, mirroring the engine DecisionRecommendation shape. */
const decisionRecommendationSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["practiceId", "reasons"],
  properties: {
    practiceId: { type: "string" },
    reasons: { type: "array", items: { type: "string" } },
  },
};
// Mirrors the engine DecideResult contract (ADR 0008 §6): no_match adds
// noMatchReason; trace entries expose the matched when and next edge.
const decisionResultSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "entryDecision", "recommendations", "trace"],
      properties: {
        status: { const: "matched" },
        entryDecision: { type: "string" },
        recommendations: { type: "array", items: decisionRecommendationSchema },
        trace: { type: "array", items: decisionTraceSchema },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "entryDecision", "recommendations", "trace", "noMatchReason"],
      properties: {
        status: { const: "no_match" },
        entryDecision: { type: "string" },
        recommendations: { type: "array" },
        trace: { type: "array", items: decisionTraceSchema },
        noMatchReason: { type: "string" },
      },
    },
  ],
};

/**
 * Evaluate a local pack's decisions.yaml along one deterministic path. The
 * engine evaluator is pure; this handler owns only argument parsing and pack
 * loading (ADR 0008).
 */
export const decideCommand: CommandDefinition = {
  name: "decide",
  summary: "Evaluate a local knowledge pack decision tree for a structured context.",
  positionals: [{ name: "pack-path", required: true }],
  options: decideOptions,
  resultSchema: decisionResultSchema,
  errorCodes: [
    ...frameworkErrorCodes,
    cliErrorCodes.packPathInvalid,
    cliErrorCodes.packUnreadable,
    cliErrorCodes.packParseError,
    cliErrorCodes.decideUnknownDecision,
    cliErrorCodes.decideInvalidCondition,
    cliErrorCodes.decideDuplicateDecision,
    cliErrorCodes.decideCycle,
  ],
  exitCodes: [0, 2],
  handler: async (invocation) => {
    // The handler owns only argument parsing and pack loading; evaluation is
    // the pure engine call below (ADR 0008 §1).
    const entryDecision = requiredStringOption(invocation.options, "decision");
    const context = parseDecisionContext(requiredStringOption(invocation.options, "context"));
    const packPath = invocation.positionals[0];
    // `pack-path` is a Commander-required positional; the guard keeps TS
    // narrowing under noUncheckedIndexedAccess and defends the invocation
    // contract against a framework regression.
    if (packPath === undefined) throw invalidInvocationError();
    const decisions = await readDecisionsDocument(packPath);
    return { data: evaluateDecisions({ context, decisions, entryDecision }) };
  },
};

/** Read a required string option; a missing or empty value is a usage error. */
function requiredStringOption(options: Readonly<Record<string, unknown>>, name: string): string {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw invalidInvocationError();
  }
  return value;
}

/**
 * Parse the JSON object passed via --context. Only a JSON object is valid:
 * dotted when-paths resolve fields off it, so arrays, scalars, and null are
 * usage errors instead of silently evaluating to no_match.
 */
function parseDecisionContext(source: string): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw invalidInvocationError();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInvocationError();
  }
  return value as Readonly<Record<string, unknown>>;
}
