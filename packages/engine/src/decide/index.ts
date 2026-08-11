/**
 * lore decide engine: pure, deterministic evaluation of a knowledge pack's
 * decisions.yaml Decision Nodes. This module touches no filesystem or
 * process I/O.
 */
export { evaluateDecisions } from "./evaluate.js";
export { ConditionSyntaxError, evaluateCondition } from "./when.js";
export * from "./schema.js";
export {
  DecisionEvaluationError,
  decisionErrorCodes,
  type DecideResult,
  type DecisionContext,
  type DecisionErrorCode,
  type DecisionEvaluationInput,
  type DecisionRecommendation,
  type DecisionTraceEntry,
} from "./types.js";
