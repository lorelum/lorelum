/**
 * Decide evaluation contract: context shape, result envelopes, audit trace
 * entries, and the stable error codes shared by engine, CLI, and protocol
 * (ADR 0008).
 */
import type { DecisionNode } from "@lorelum/format";

/** Structured project context passed to the evaluator; dotted-path condition fields resolve from here. */
export type DecisionContext = Readonly<Record<string, unknown>>;

/** Aggregated result for one recommended Practice: the matched id plus all matched reasons. */
export type DecisionRecommendation = {
  /** Practice id referenced by the matched branch. */
  practiceId: string;
  /** Reasons given by each matched branch that recommends this Practice; merged across branches. */
  reasons: string[];
};

/** A single Decision Node visited along the evaluation path, for an auditable trace. */
export type DecisionTraceEntry = {
  /** id of the evaluated Decision Node. */
  decisionId: string;
  /** The node's question text. */
  question: string;
  /** The matched branch's when expression; null when no branch matched. */
  matchedWhen: string | null;
  /** Next Decision Node id chained by the matched branch; null at the end of the path. */
  nextDecision: string | null;
};

/** Successful result: at least one branch matched (recommendations may be empty; spec §2.2: not an error). */
export type MatchedDecisionResult = {
  /** Stable status marker distinguishing matched / no_match. */
  status: "matched";
  /** Entry Decision Node id passed by the caller. */
  entryDecision: string;
  /** Deduplicated, merged recommendation list along the path. */
  recommendations: DecisionRecommendation[];
  /** Full evaluation trace for audit and debugging. */
  trace: DecisionTraceEntry[];
};

/** Normal (non-error) termination: no branch matched the given context. */
export type NoMatchDecisionResult = {
  /** Stable status marker distinguishing matched / no_match. */
  status: "no_match";
  /** Entry Decision Node id passed by the caller. */
  entryDecision: string;
  /** Always empty under no_match. */
  recommendations: [];
  /** Evaluation trace up to the first unmatched node. */
  trace: DecisionTraceEntry[];
  /** Human-readable reason for no match, surfaced by the CLI. */
  noMatchReason: string;
};

/** Stable external result contract shared by the CLI and future MCP adapters. */
export type DecideResult = MatchedDecisionResult | NoMatchDecisionResult;

/** Input for a pure evaluation; no filesystem or process I/O, reusable by CLI and MCP. */
export interface DecisionEvaluationInput {
  /** Context snapshot used to evaluate when conditions. */
  context: DecisionContext;
  /** Decision Nodes to evaluate, usually from decisions.yaml. */
  decisions: readonly DecisionNode[];
  /** Decision Node id where evaluation starts. */
  entryDecision: string;
}

/**
 * Single source of truth for decide evaluation error codes (ADR 0008 §6).
 * The evaluator's typed failures, the CLI allowlist, and the protocol output
 * all reference these dotted strings so they cannot drift apart.
 */
export const decisionErrorCodes = Object.freeze({
  cycle: "decide.cycle",
  duplicateDecision: "decide.duplicate_decision",
  invalidCondition: "decide.invalid_condition",
  unknownDecision: "decide.unknown_decision",
} as const);

export type DecisionErrorCode = (typeof decisionErrorCodes)[keyof typeof decisionErrorCodes];

/** Typed evaluation failure; code is a stable protocol value mapped to CLI errorCodes. */
export class DecisionEvaluationError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DecisionEvaluationError";
  }
}
